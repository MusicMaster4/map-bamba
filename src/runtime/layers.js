// Map-space elements: they live inside the map (drape on terrain/globe, sit under labels).
import { ease as getEase, prog, clamp } from './ease.js';
import { PathMetric, unwrap, toFC, bbox } from './geo.js';
import { rgba, mix } from './color.js';

const SLOT = { low: '@low', mid: '@mid', top: '@top', over: undefined };
const slotId = (s) => { if (!(s in SLOT)) throw new Error(`Unknown slot "${s}". Valid: low (under water & roads), mid (over roads), top (under labels), over (above everything)`); return SLOT[s]; };

/** Shared fade timing: appears at `at` over `dur`, leaves at `end` over `outDur`. */
export class Timed {
  constructor(scene, o, defaults = {}) {
    this.scene = scene;
    this.at = o.at ?? defaults.at ?? scene.t;
    this.dur = o.dur ?? defaults.dur ?? 0.8;
    this.end = o.end ?? null;
    this.outDur = o.outDur ?? 0.6;
    this.easeIn = getEase(o.ease || defaults.ease || 'outCubic');
  }
  /** 0..1 presence (eased in × eased out). */
  vis(t) {
    let v = this.easeIn(prog(t, this.at, this.dur));
    if (this.end !== null) v *= 1 - getEase('inOutCubic')(prog(t, this.end, this.outDur));
    return v;
  }
  /** Change when it leaves. */
  out(o = {}) { this.end = typeof o === 'number' ? o : o.at ?? this.scene.t; if (o.dur) this.outDur = o.dur; return this; }
}

function partsOf(g) {
  if (g && g.parts && g.metric) return g.parts.map((p) => p.coords);
  if (Array.isArray(g)) return typeof g[0][0] === 'number' ? [g] : typeof g[0][0][0] === 'number' ? g : g.flatMap(partsOf);
  if (g.type === 'Feature') return partsOf(g.geometry);
  if (g.type === 'FeatureCollection') return g.features.flatMap(partsOf);
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  throw new Error('line: unsupported geometry ' + (g.type || typeof g));
}

/** A path on the map that can draw itself. */
export class LineEl extends Timed {
  constructor(scene, geom, o = {}) {
    super(scene, o, { dur: 0.01 });
    this.o = { color: scene.theme.accent, width: 5, opacity: 1, glow: 0, casing: true, dash: null, slot: 'top', ...o };
    this.parts = partsOf(geom).filter((c) => c.length > 1).map((c) => new PathMetric(c));
    if (!this.parts.length) throw new Error('line: geometry has no segments');
    this.metric = this.parts[0];
    this.coords = this.parts.flatMap((p) => p.coords);
    this.km = this.parts.reduce((a, p) => a + p.km, 0);
    this.tracks = [];
    this.hasDraw = false;
    this.id = scene.uid('line');
  }
  /** Draw the line from its start: o = { at, dur, ease, to: 0..1 }. Call again to continue from where it stopped. */
  draw(o = {}) {
    this.tracks.push({ k: 'head', at: o.at ?? this.scene.t, dur: o.dur ?? 3, ease: getEase(o.ease || 'inOutSine'), to: o.to ?? 1 });
    this.hasDraw = true;
    return this;
  }
  /** Retract the line from its start (the tail chases the head): o = { at, dur, ease, to }. */
  erase(o = {}) { this.tracks.push({ k: 'tail', at: o.at ?? this.scene.t, dur: o.dur ?? 2, ease: getEase(o.ease || 'inOutSine'), to: o.to ?? 1 }); return this; }
  drawSpan() { const d = this.tracks.filter((x) => x.k === 'head'); return d.length ? { at: d[0].at, dur: d[d.length - 1].at + d[d.length - 1].dur - d[0].at } : null; }
  /** [tail, head] fractions visible at time t. */
  range(t) {
    let head = this.hasDraw ? 0 : 1, tail = 0;
    for (const k of ['head', 'tail']) {
      let v = k === 'head' ? head : 0;
      for (const tr of this.tracks.filter((x) => x.k === k).sort((a, b) => a.at - b.at)) {
        if (t < tr.at) break;
        v = v + (tr.to - v) * tr.ease(prog(t, tr.at, tr.dur));
        if (t < tr.at + tr.dur) break;
      }
      if (k === 'head') head = v; else tail = v;
    }
    return [Math.min(tail, head), head];
  }
  /** Fraction drawn at time t (0..1). */
  progress(t) { return this.range(t)[1]; }
  /** [lng, lat] of the drawing head at time t. */
  headAt(t) { return this.metric.at(this.range(t)[1]); }
  _data(a, b) {
    const lines = b - a <= 1e-9 ? [] : this.parts.map((p) => (a <= 0 && b >= 1 ? p.coords : p.slice(a, b))).filter((c) => c.length > 1);
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
  }
  mount(map) {
    const o = this.o, th = this.scene.theme;
    map.addSource(this.id, { type: 'geojson', data: this._data(0, this.hasDraw ? 0 : 1), tolerance: 0.2, buffer: 64 });
    const before = slotId(o.slot);
    const layout = { 'line-cap': o.dash ? 'butt' : 'round', 'line-join': 'round' };
    this.layers = [];
    const add = (suffix, paint, base) => { const id = this.id + suffix; map.addLayer({ id, type: 'line', source: this.id, layout: suffix === '' ? layout : { 'line-cap': 'round', 'line-join': 'round' }, paint }, before); this.layers.push({ id, base }); };
    if (o.glow) add('-glow', { 'line-color': o.glowColor || o.color, 'line-width': o.width * 5, 'line-blur': o.width * 4, 'line-opacity': 0 }, 0.42 * (o.glow === true ? 1 : o.glow));
    if (o.casing) add('-case', { 'line-color': typeof o.casing === 'string' ? o.casing : th.dark ? '#0d0d0d' : th.bg, 'line-width': o.width + 3.5, 'line-opacity': 0 }, th.dark ? 0.6 : 0.85);
    add('', { 'line-color': o.color, 'line-width': o.width, 'line-opacity': 0, ...(o.dash ? { 'line-dasharray': o.dash } : {}) }, o.opacity);
    this._last = null;
  }
  update(t, map) {
    const [a, b] = this.range(t);
    const key = a.toFixed(6) + ':' + b.toFixed(6);
    if (key !== this._last) { map.getSource(this.id).setData(this._data(a, b)); this._last = key; }
    const v = this.vis(t);
    for (const l of this.layers) map.setPaintProperty(l.id, 'line-opacity', +(l.base * v).toFixed(4));
  }
}

/** Filled region (country, neighbourhood, front line…). Data can be swapped over time with frames(). */
export class AreaEl extends Timed {
  constructor(scene, geom, o = {}) {
    super(scene, o, { dur: 1 });
    this.o = { color: scene.theme.accent, fill: 0.28, stroke: true, strokeWidth: 1.6, hatch: false, glow: 0, slot: 'low', ...o };
    this.data = toFC(geom);
    this.keyframes = null;
    this.id = scene.uid('area');
  }
  /** Time-varying geometry: frames = [{ at: seconds, data: geojson }, …] (sorted by `at`). */
  frames(frames) { this.keyframes = frames.map((f) => ({ at: f.at, data: toFC(f.data) })).sort((a, b) => a.at - b.at); return this; }
  mount(map) {
    const o = this.o, before = slotId(o.slot);
    map.addSource(this.id, { type: 'geojson', data: this.keyframes ? this.keyframes[0].data : this.data, tolerance: 0.25 });
    this.layers = [];
    const add = (suffix, type, paint, prop, base, layout = {}) => { const id = this.id + suffix; map.addLayer({ id, type, source: this.id, layout, paint: { ...paint, [prop]: 0 } }, before); this.layers.push({ id, prop, base }); };
    if (o.fill) add('-fill', 'fill', { 'fill-color': o.color, 'fill-antialias': true }, 'fill-opacity', o.fill);
    if (o.hatch) {
      const h = typeof o.hatch === 'object' ? o.hatch : {};
      const img = this.id + '-hatch';
      map.addImage(img, hatchImage(h.color || o.color, h.spacing ?? 9, h.width ?? 1.6), { pixelRatio: 2 });
      add('-hatch', 'fill', { 'fill-pattern': img }, 'fill-opacity', h.opacity ?? 0.55);
    }
    const sc = o.stroke === true ? o.color : o.stroke;
    if (o.glow && sc) add('-glow', 'line', { 'line-color': sc, 'line-width': o.strokeWidth * 7, 'line-blur': o.strokeWidth * 6 }, 'line-opacity', 0.4 * (o.glow === true ? 1 : o.glow), { 'line-join': 'round' });
    if (sc) add('-line', 'line', { 'line-color': sc, 'line-width': o.strokeWidth, ...(o.dash ? { 'line-dasharray': o.dash } : {}) }, 'line-opacity', o.strokeOpacity ?? 0.95, { 'line-join': 'round' });
    this._cur = 0;
  }
  update(t, map) {
    if (this.keyframes) {
      let i = 0;
      for (let j = 0; j < this.keyframes.length; j++) if (this.keyframes[j].at <= t) i = j;
      if (i !== this._cur) { map.getSource(this.id).setData(this.keyframes[i].data); this._cur = i; }
    }
    const v = this.vis(t);
    for (const l of this.layers) map.setPaintProperty(l.id, l.prop, +(l.base * v).toFixed(4));
  }
}

function hatchImage(color, spacing, width) {
  const s = Math.round(spacing * 2) * 2; // 2x pixel ratio, even size for seamless tiling
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.strokeStyle = color;
  x.lineWidth = width * 2;
  x.lineCap = 'square';
  for (const off of [-s, 0, s]) { x.beginPath(); x.moveTo(off - 2, s + 2); x.lineTo(off + s + 2, -2); x.stroke(); }
  const d = x.getImageData(0, 0, s, s);
  return { width: s, height: s, data: new Uint8Array(d.data.buffer) };
}

/**
 * Many points (cities, cafés, earthquakes…) as map circles that pop in over time.
 * items: [[lng,lat], …] | [{lng, lat, …}] | GeoJSON points.
 * o: { color, size, at, stagger, pulse, label, opacity, stroke } — color/size/at/label may be functions (item, index) => value.
 */
export class PointsEl extends Timed {
  constructor(scene, items, o = {}) {
    super(scene, o, { dur: 0.5, ease: 'linear' });
    this.o = { color: scene.theme.accent, size: 5, opacity: 0.95, stagger: 0, pulse: false, label: null, slot: 'top', stroke: true, blur: 0, labelSize: 13, ...o };
    const list = items.type === 'FeatureCollection' ? items.features : items;
    const fn = (v) => (typeof v === 'function' ? v : () => v);
    const [col, siz, lab, atf] = [fn(this.o.color), fn(this.o.size), fn(this.o.label), fn(o.at ?? this.at)];
    this.features = list.map((it, i) => {
      const d = it.type === 'Feature' ? { ...it.properties, lng: it.geometry.coordinates[0], lat: it.geometry.coordinates[1] } : Array.isArray(it) ? { lng: it[0], lat: it[1], name: it.name } : it;
      if (typeof d.lng !== 'number' || typeof d.lat !== 'number') throw new Error('points: item ' + i + ' has no lng/lat');
      const key = this.o.label;
      const name = key == null ? '' : typeof key === 'function' ? lab(d, i) : (d[key] ?? '');
      return { type: 'Feature', id: i, properties: { _c: col(d, i), _r: siz(d, i), _n: name || '' }, geometry: { type: 'Point', coordinates: [d.lng, d.lat] }, _t: atf(d, i) + i * this.o.stagger };
    });
    this.id = scene.uid('pts');
  }
  mount(map) {
    const o = this.o, th = this.scene.theme, before = slotId(o.slot);
    map.addSource(this.id, { type: 'geojson', data: { type: 'FeatureCollection', features: this.features.map(({ _t, ...f }) => f) } });
    const k = ['coalesce', ['feature-state', 'k'], 0], q = ['coalesce', ['feature-state', 'q'], 0], a = ['coalesce', ['feature-state', 'a'], 0];
    if (o.pulse) map.addLayer({ id: this.id + '-pulse', type: 'circle', source: this.id, paint: { 'circle-radius': ['*', ['get', '_r'], ['+', 1, ['*', 3.2, q]]], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', '_c'], 'circle-stroke-width': 1.4, 'circle-stroke-opacity': ['*', ['-', 1, q], ['-', 1, q], a, 0.9] } }, before);
    if (o.glow) map.addLayer({ id: this.id + '-glow', type: 'circle', source: this.id, paint: { 'circle-radius': ['*', ['get', '_r'], 3.4, k], 'circle-color': ['get', '_c'], 'circle-blur': 1, 'circle-opacity': ['*', a, 0.35 * (o.glow === true ? 1 : o.glow)] } }, before);
    map.addLayer({ id: this.id, type: 'circle', source: this.id, paint: { 'circle-radius': ['*', ['get', '_r'], k], 'circle-color': ['get', '_c'], 'circle-opacity': ['*', a, o.opacity], 'circle-blur': o.blur, 'circle-stroke-color': th.dark ? '#0d0d0d' : th.bg, 'circle-stroke-width': o.stroke ? 1.2 : 0, 'circle-stroke-opacity': ['*', a, 0.7] } }, before);
    if (o.label != null) {
      map.addLayer({
        id: this.id + '-label', type: 'symbol', source: this.id, minzoom: o.labelMinZoom ?? 0,
        layout: { 'text-field': ['get', '_n'], 'text-font': ['Bamba Sans Medium'], 'text-size': o.labelSize, 'text-anchor': 'left', 'text-offset': [0.75, 0], 'text-max-width': 9, 'text-padding': 3, 'text-optional': true, 'text-justify': 'left', 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.7 },
        paint: { 'text-color': o.labelColor || th.k(0.86), 'text-halo-color': th.halo, 'text-halo-width': 1.6, 'text-opacity': a },
      });
    }
    this._state = new Float32Array(this.features.length).fill(-1);
  }
  update(t, map) {
    const pop = getEase('spring'), dur = Math.max(0.05, this.dur), fadeOut = this.end !== null ? 1 - prog(t, this.end, this.outDur) : 1;
    for (let i = 0; i < this.features.length; i++) {
      const p = prog(t, this.features[i]._t, dur);
      const sig = p * 1000 + fadeOut;
      if (this._state[i] === sig && (p === 0 || p === 1) && !this.o.pulse) continue;
      this._state[i] = sig;
      const q = this.o.pulse ? clamp((t - this.features[i]._t) / (typeof this.o.pulse === 'number' ? this.o.pulse : 1.4)) : 0;
      map.setFeatureState({ source: this.id, id: i }, { k: p <= 0 ? 0 : pop(p), a: Math.min(1, p * 2.5) * fadeOut, q });
    }
  }
}

/** Extruded shape (a highlighted building, a bar on the map). Height grows in on `at`. */
export class ExtrudeEl extends Timed {
  constructor(scene, geom, o = {}) {
    super(scene, o, { dur: 1.2, ease: 'outCubic' });
    this.o = { color: scene.theme.accent, height: 100, base: 0, opacity: 0.92, ...o };
    this.data = toFC(geom);
    this.id = scene.uid('ext');
  }
  mount(map) {
    map.addSource(this.id, { type: 'geojson', data: this.data });
    map.addLayer({ id: this.id, type: 'fill-extrusion', source: this.id, paint: { 'fill-extrusion-color': this.o.color, 'fill-extrusion-height': 0, 'fill-extrusion-base': this.o.base, 'fill-extrusion-opacity': this.o.opacity, 'fill-extrusion-vertical-gradient': true } });
  }
  update(t, map) {
    const v = this.vis(t);
    map.setPaintProperty(this.id, 'fill-extrusion-height', this.o.base + (this.o.height - this.o.base) * v);
    map.setLayoutProperty(this.id, 'visibility', v > 0.001 ? 'visible' : 'none');
  }
}
export { bbox, mix, rgba, unwrap };
