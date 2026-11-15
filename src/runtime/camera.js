// Camera: a pure function of time. Moves are declared up front; state(t) folds them.
import { ease as getEase, prog, lerp, clamp, check } from './ease.js';

const VIEW = ['center', 'zoom', 'bearing', 'pitch', 'fit', 'padding', 'maxZoom', 'zoomOffset'];
import { mercX, mercY, unmercX, unmercY, bbox as bboxOf } from './geo.js';

const KEYS = ['zoom', 'bearing', 'pitch'];
const rel = (v, from) => (typeof v === 'string' ? from + parseFloat(v) : v);
const smooth = (p) => p * p * (3 - 2 * p);

export class Camera {
  constructor(scene) {
    this.scene = scene;
    this.base = { center: [0, 20], zoom: 1.6, bearing: 0, pitch: 0 };
    this.baseView = null;
    this.segs = [];
  }
  /** Starting view. view = { center, zoom, bearing, pitch } or { fit: geometry|[w,s,e,n], padding } */
  set(view) { check(view, VIEW, 'camera.set()', false); this.baseView = view; return this; }
  /**
   * Move to a view. Numbers are absolute; strings like '+40' / '-0.5' are relative to wherever the camera is.
   * o = { at, dur, ease, curve } — when both position and zoom change it flies (zooms out, then in); curve≈1.42.
   */
  to(view, o = {}, label = 'to') {
    check(view, VIEW, 'camera.to() view', false);
    check(o, ['at', 'dur', 'ease', 'curve'], 'camera.to() options', false);
    this.segs.push({ type: 'to', label, view, at: o.at ?? this.scene.t, dur: o.dur ?? 3, ease: getEase(o.ease || 'glide'), curve: o.curve ?? 1.42 });
    this._sort();
    return this;
  }
  /** Rotate around the current centre: o = { at, dur, by: degrees, ease }. */
  orbit(o = {}) { check(o, ['at', 'dur', 'by', 'ease'], 'camera.orbit()', false); return this.to({ bearing: (o.by ?? 360) >= 0 ? '+' + (o.by ?? 360) : String(o.by) }, { ease: o.ease ?? 'inOutSine', at: o.at, dur: o.dur }, 'orbit'); }
  /** Slow push/drift so a held shot never feels frozen: o = { at, dur, zoom: '+0.3', bearing: '+6' }. */
  drift(o = {}) { check(o, ['at', 'dur', 'ease', 'zoom', 'bearing', 'pitch'], 'camera.drift()', false); return this.to({ zoom: o.zoom ?? '+0.25', bearing: o.bearing ?? '+0', pitch: o.pitch ?? '+0' }, { ease: o.ease ?? 'linear', at: o.at, dur: o.dur }, 'drift'); }
  /**
   * Keep the camera on the head of a line while it draws.
   * o = { at, dur, zoom, pitch, bearing: number|'auto', settle: seconds to reach zoom/pitch, blend: seconds to catch the head }
   */
  follow(line, o = {}) {
    check(o, ['at', 'dur', 'ease', 'zoom', 'pitch', 'bearing', 'settle', 'blend', 'window', 'bearingOffset', 'ahead'], 'camera.follow()', false);
    if (!line || !line.metric) throw new Error('camera.follow(line, options): first argument must be a line created with s.line()');
    const d = line.drawSpan?.();
    this.segs.push({ type: 'follow', line, at: o.at ?? d?.at ?? this.scene.t, dur: o.dur ?? d?.dur ?? 5, o });
    this._sort();
    return this;
  }
  _sort() { this.segs.forEach((s, i) => (s._i ??= i)); this.segs.sort((a, b) => a.at - b.at || a._i - b._i); this.segs.forEach((s) => delete s._from); }

  _resolveView(view, from) {
    const map = this.scene.map;
    const out = {};
    if (view.fit) {
      const b = Array.isArray(view.fit) && typeof view.fit[0] === 'number' && view.fit.length === 4 ? view.fit : bboxOf(view.fit);
      const pad = view.padding ?? 140;
      const padding = typeof pad === 'number' ? { top: pad, bottom: pad, left: pad, right: pad } : { top: 0, bottom: 0, left: 0, right: 0, ...pad };
      const bearing = rel(view.bearing ?? from.bearing, from.bearing);
      const cam = map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding, bearing, maxZoom: view.maxZoom ?? 17 });
      if (!cam) throw new Error('camera: cannot fit bounds ' + JSON.stringify(b));
      out.center = [cam.center.lng, cam.center.lat];
      let z = cam.zoom;
      for (let i = 0; i < 4; i++) z = cam.zoom - this.scene.globeZoomFix(out.center[1], z); // actual → globe-normalised zoom
      out.zoom = z + (view.zoomOffset ?? 0);
    }
    if (view.center) out.center = [view.center[0], view.center[1]];
    for (const k of KEYS) if (view[k] !== undefined) out[k] = rel(view[k], from[k]);
    if (out.center) {
      // shortest way around the world
      let lng = out.center[0];
      while (lng - from.center[0] > 180) lng -= 360;
      while (lng - from.center[0] < -180) lng += 360;
      out.center = [lng, out.center[1]];
    }
    if (out.bearing !== undefined && typeof view.bearing !== 'string') {
      let d = ((out.bearing - from.bearing + 540) % 360) - 180;
      out.bearing = from.bearing + d;
    }
    return out;
  }

  resolve() {
    const zero = { center: [0, 20], zoom: 1.6, bearing: 0, pitch: 0 };
    this.base = { ...zero, ...(this.baseView ? this._resolveView(this.baseView, zero) : {}) };
    this.segs.forEach((s) => { delete s._from; delete s._target; });
  }

  _apply(seg, from, st, t) {
    const out = { ...st };
    if (seg.type === 'to') {
      const target = (seg._target ??= this._resolveView(seg.view, from));
      const p = seg.ease(prog(t, seg.at, seg.dur));
      if (target.center) {
        const z1 = target.zoom ?? from.zoom;
        const f = flyInterp(from.center, from.zoom, target.center, z1, seg.curve, this.scene.width, this.scene.height);
        const r = f(p);
        out.center = r.center;
        out.zoom = r.zoom;
      } else if (target.zoom !== undefined) out.zoom = lerp(from.zoom, target.zoom, p);
      if (target.center) { const fo = from.offset || [0, 0]; out.offset = [lerp(fo[0], 0, p), lerp(fo[1], 0, p)]; } // re-framing recentres
      if (target.bearing !== undefined) out.bearing = lerp(from.bearing, target.bearing, p);
      if (target.pitch !== undefined) out.pitch = lerp(from.pitch, target.pitch, p);
    } else if (seg.type === 'follow') {
      const o = seg.o, line = seg.line;
      const f = line.hasDraw ? line.range(t)[1] : getEase(o.ease || 'inOutSine')(prog(t, seg.at, seg.dur));
      const head = line.metric.at(f);
      const blend = smooth(prog(t, seg.at, o.blend ?? Math.min(1.5, seg.dur / 3)));
      let lng = head[0];
      while (lng - from.center[0] > 180) lng -= 360;
      while (lng - from.center[0] < -180) lng += 360;
      out.center = [lerp(from.center[0], lng, blend), lerp(from.center[1], head[1], blend)];
      const s = getEase('inOutCubic')(prog(t, seg.at, o.settle ?? Math.min(2.5, seg.dur / 2)));
      if (o.zoom !== undefined) out.zoom = lerp(from.zoom, rel(o.zoom, from.zoom), s);
      if (o.pitch !== undefined) out.pitch = lerp(from.pitch, rel(o.pitch, from.pitch), s);
      if (o.bearing === 'auto') {
        const h = line.metric.heading(f, o.window ?? 0.08) + (o.bearingOffset ?? 0);
        const d = ((h - from.bearing + 540) % 360) - 180;
        out.bearing = from.bearing + d * s;
      } else if (o.bearing !== undefined) out.bearing = lerp(from.bearing, rel(o.bearing, from.bearing), s);
      // keep the head below centre so the way ahead is in frame (only meaningful when the map turns with it)
      const ahead = o.ahead ?? (o.bearing === 'auto' ? 0.13 : 0);
      const fo = from.offset || [0, 0];
      out.offset = [lerp(fo[0], 0, s), lerp(fo[1], ahead * this.scene.height, s)];
    }
    return out;
  }
  _fold(t, n) {
    let st = { ...this.base, center: [...this.base.center] };
    for (let i = 0; i < n; i++) {
      const seg = this.segs[i];
      if (t < seg.at) continue;
      const from = (seg._from ??= this._fold(seg.at, i));
      st = this._apply(seg, from, st, t);
    }
    return st;
  }
  /** Camera state at time t: { center, zoom, bearing, pitch }. */
  state(t) { return this._fold(t, this.segs.length); }
}

/** van Wijk & Nuij smooth zoom-and-pan between two views (same maths as MapLibre flyTo). */
function flyInterp(c0, z0, c1, z1, rho, width, height) {
  const scale0 = 512 * 2 ** z0;
  const p0 = [mercX(c0[0]) * scale0, mercY(c0[1]) * scale0];
  const p1 = [mercX(c1[0]) * scale0, mercY(c1[1]) * scale0];
  const d = [p1[0] - p0[0], p1[1] - p0[1]];
  const u1 = Math.hypot(d[0], d[1]);
  const w0 = Math.max(width, height);
  const w1 = w0 / 2 ** (z1 - z0);
  const rho2 = rho * rho;
  const r = (i) => { const b = (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (i ? w1 : w0) * rho2 * u1); return Math.log(Math.sqrt(b * b + 1) - b); };
  let w, u, S;
  const r0 = u1 > 1e-6 ? r(0) : NaN;
  if (u1 < 1e-6 || !isFinite(r0) || !isFinite(r(1))) {
    const k = w1 < w0 ? -1 : 1;
    S = Math.abs(Math.log(w1 / w0)) / rho;
    u = () => (u1 < 1e-6 ? 0 : null);
    w = (s) => Math.exp(k * rho * s);
  } else {
    S = (r(1) - r0) / rho;
    w = (s) => Math.cosh(r0) / Math.cosh(r0 + rho * s);
    u = (s) => (w0 * ((Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2)) / u1;
  }
  return (k) => {
    if (k >= 1) return { center: c1, zoom: z1 };
    if (k <= 0) return { center: c0, zoom: z0 };
    const s = k * S;
    let uu = u(s);
    if (uu === null) uu = k;
    const x = (p0[0] + d[0] * uu) / scale0, y = (p0[1] + d[1] * uu) / scale0;
    const zoom = S === 0 ? lerp(z0, z1, k) : z0 + Math.log2(1 / w(s));
    return { center: [unmercX(x), unmercY(clamp(y, 0.0001, 0.9999))], zoom };
  };
}
