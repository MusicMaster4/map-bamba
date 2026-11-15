// Scene: the object a scene file receives as `s`. Everything is declared up front against a
// timeline; rendering is a pure function of time (seek(t)), so frames can be rendered in any
// order and in parallel.
import { Map as MapLibreMap, LngLat, MercatorCoordinate, setNow, getWorkerCount, setWorkerCount } from 'maplibre-gl';
import { EASE, ease as getEase, prog, clamp, lerp } from './ease.js';
import * as geo from './geo.js';
import * as color from './color.js';
import { buildStyle, resolveTheme, PALETTE, THEMES } from './style.js';
import { Camera } from './camera.js';
import { LineEl, AreaEl, PointsEl, ExtrudeEl } from './layers.js';
import { Overlay, TextEl, CounterEl, LegendEl, TimebarEl, PinEl, MoverEl, TEXT_IN, TEXT_OUT, ICONS } from './overlay.js';
import * as data from './data.js';
import { recipeFor } from '../recipes/index.js';

export const DEFAULTS = {
  duration: 20, fps: 30, size: [1920, 1080],
  theme: 'ink', lang: 'en', locale: 'en-US',
  labels: 'all', roads: true, rail: true, boundaries: true, landcover: true,
  buildings: '2d', hillshade: true, terrain: false, globe: false, graticule: false,
  scrim: true, credit: true, margin: 72,
};
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const proxied = (url) => (/^https?:/.test(url) && !url.startsWith(location.origin) ? location.origin + '/__fetch?url=' + encodeURIComponent(url) : url);

export class Scene {
  constructor(cfg = {}, sceneUrl = location.href) {
    this.cfg = { ...DEFAULTS };
    this.sceneUrl = sceneUrl;
    /** Colours: accents (signal, amber, ice, mint, rose, violet), neutrals (paper, dim) and theme (bg, fg, accent). */
    this.c = { ...PALETTE, mix: color.mix, alpha: color.rgba };
    this.configure(cfg);
    this.geo = geo;
    this.t = 0;
    this.camera = new Camera(this);
    this.mapEls = [];
    this.domEls = [];
    this.warnings = [];
    this._n = 0;
    this._bldg = null;
    this.stats = { seeks: 0, redraws: 0 };
  }
  /**
   * Change config from inside the scene function (same keys as `export const config`). Call it first,
   * before creating elements — they take their default colours from the theme at creation.
   */
  configure(cfg = {}) {
    if (this.mounted) throw new Error('s.configure() must be called before the scene is built');
    const unknown = Object.keys(cfg).filter((k) => !(k in DEFAULTS) && !['bg', 'fg', 'accent', 'post', 'atmosphere', 'fade'].includes(k));
    if (unknown.length) throw new Error(`Unknown config key(s): ${unknown.join(', ')}. Valid: ${Object.keys(DEFAULTS).join(', ')}, bg, fg, accent, post, fade`);
    for (const [k, v] of Object.entries(cfg)) if (v !== undefined) this.cfg[k] = v;
    this.duration = this.cfg.duration;
    this.fps = this.cfg.fps;
    [this.width, this.height] = this.cfg.size;
    const ov = {};
    for (const k of ['bg', 'fg', 'accent']) if (this.cfg[k]) ov[k] = this.cfg[k];
    this.theme = resolveTheme(this.cfg.theme, ov, { globe: !!this.cfg.globe });
    Object.assign(this.c, { bg: this.theme.bg, fg: this.theme.fg, accent: this.theme.accent });
    return this;
  }
  /** Apply the keys every brief shares (lang, accent, theme, bg, duration, size, credit) plus `extra` config. */
  brief(P = {}, extra = {}) {
    const lang = P.lang || 'en';
    const locale = P.locale || { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' }[lang] || 'en-US';
    const size = P.size === 'vertical' ? [1080, 1920] : P.size === 'square' ? [1080, 1080] : P.size;
    return this.configure({ ...extra, duration: P.duration ?? 20, lang, locale, theme: P.theme, bg: P.bg, fg: P.fg, accent: P.accent ? PALETTE[P.accent] || P.accent : undefined, size, credit: P.credit ?? extra.credit });
  }
  /** Run a recipe inside a scene, then add to it: const { line } = await s.recipe({ recipe: 'route', stops: [...] }) */
  recipe(P) { return recipeFor(P).default(this, P); }
  uid(p) { return `${p}-${++this._n}`; }
  /** Set the time cursor: calls that omit `at` start here. */
  at(t) { this.t = t; return this; }
  /** Advance the time cursor. */
  wait(d) { this.t += d; return this; }

  // ---- data (all cached on disk after the first run) ----
  geocode(q) { return data.geocode(q); }
  place(q, o) { return data.place(q, o); }
  route(points, o) { return data.route(points, o); }
  pois(o) { return data.pois(o); }
  countries(...codes) { return data.countries(...codes); }
  load(url) { return data.load(url, this.sceneUrl); }
  /** Great-circle path between two points (for flights, shipping lanes). */
  arc(a, b, n = 160) { return geo.greatCircle(a, b, n); }

  // ---- map-space elements ----
  _m(el) { this.mapEls.push(el); return el; }
  _d(el) { this.domEls.push(el); return el; }
  line(geom, o) { return this._m(new LineEl(this, geom, o)); }
  area(geom, o) { return this._m(new AreaEl(this, geom, o)); }
  points(items, o) { return this._m(new PointsEl(this, items, o)); }
  extrude(geom, o) { return this._m(new ExtrudeEl(this, geom, o)); }
  /** Grow the 3D buildings out of the ground (needs config.buildings = '3d'): { at, dur, ease }. */
  buildingsRise(o = {}) { this._bldg = { at: o.at ?? this.t, dur: o.dur ?? 2.5, ease: getEase(o.ease || 'outQuart') }; return this; }

  // ---- geo-anchored DOM ----
  pin(lnglat, text, o) { return this._d(new PinEl(this, lnglat, text, o)); }
  label(lnglat, text, o = {}) { return this._d(new PinEl(this, lnglat, text, { kind: 'none', side: 'center', style: 'place', ...o })); }
  mover(line, o) { return this._d(new MoverEl(this, line, o)); }

  // ---- screen-space DOM ----
  text(str, o) { return this._d(new TextEl(this, str, o)); }
  title(str, o = {}) { return this.text(str, { style: 'title', ...o }); }
  caption(str, o = {}) { return this.text(str, { style: 'caption', ...o }); }
  note(str, o = {}) { return this.text(str, { style: 'note', in: 'fade', ...o }); }
  counter(o) { return this._d(new CounterEl(this, o)); }
  /** Any value that changes with time: s.ticker({ value: (t) => string|number, … }) */
  ticker(o) { return this.counter(o); }
  /** Date readout running from → to: { from, to, at, dur, format: Intl options | (date) => string, pos } */
  date(o = {}) {
    if (o.from == null || o.to == null) throw new Error('s.date(): pass { from, to } (dates or ISO strings)');
    const a = +new Date(o.from), b = +new Date(o.to);
    const f = typeof o.format === 'function' ? o.format : ((fmt) => (d) => fmt.format(d))(new Intl.DateTimeFormat(this.cfg.locale, { timeZone: 'UTC', ...(o.format || { month: 'short', year: 'numeric' }) }));
    const e = getEase(o.ease || 'linear'), at = o.at ?? this.t, dur = o.dur ?? 10;
    const { from: _f, to: _t, format: _fmt, ease: _e, ...rest } = o;
    return this.counter({ size: 64, ...rest, at, value: (t) => f(new Date(lerp(a, b, e(prog(t, at, dur))))) });
  }
  legend(items, o) { return this._d(new LegendEl(this, items, o)); }
  timebar(o) { return this._d(new TimebarEl(this, o)); }

  /** Screen position of a coordinate: { x, y, visible }. `alt` (metres) lifts the point off the ground (flat maps only). */
  project(lnglat, alt = 0) {
    if (alt && !this.cfg.globe) {
      const m = this._tr().getProjectionDataForCustomLayer(false).mainMatrix;
      const c = MercatorCoordinate.fromLngLat({ lng: lnglat[0], lat: lnglat[1] }, alt);
      const w = m[3] * c.x + m[7] * c.y + m[11] * c.z + m[15];
      const x = ((m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12]) / w * 0.5 + 0.5) * this.width;
      const y = (0.5 - (m[1] * c.x + m[5] * c.y + m[9] * c.z + m[13]) / w * 0.5) * this.height;
      return { x, y, visible: w > 0 && x > -200 && y > -200 && x < this.width + 200 && y < this.height + 200 };
    }
    let lng = lnglat[0];
    if (!this.cfg.globe) { const c = this.map.getCenter().lng; while (lng - c > 180) lng -= 360; while (lng - c < -180) lng += 360; } // nearest world copy
    const p = this.map.project([lng, lnglat[1]]);
    let visible = p.x > -200 && p.y > -200 && p.x < this.width + 200 && p.y < this.height + 200;
    if (visible && this.cfg.globe) {
      const tr = this._tr();
      if (tr?.isLocationOccluded) visible = !tr.isLocationOccluded(new LngLat(lnglat[0], lnglat[1]));
      else this.warn('globe occlusion test unavailable in this MapLibre build');
    }
    return { x: p.x, y: p.y, visible };
  }

  globeZoomFix(lat, zoom) { return this.cfg.globe ? Math.log2(Math.cos((lat * Math.PI) / 180)) * clamp((7 - zoom) / 2.5) : 0; }
  _tr() { return this.map._camera?._transform || this.map.transform; }

  // ---- lifecycle ----
  async mount(stage) {
    const cfg = this.cfg, th = this.theme;
    stage.style.width = this.width + 'px';
    stage.style.height = this.height + 'px';
    this.overlay = new Overlay(this, stage);
    const tj = await (await fetch(proxied(TILEJSON))).json();
    const style = buildStyle(th, cfg, tj.tiles[0]);
    style.state = { bldg: { default: 1 } };
    if (cfg.globe) {
      style.projection = { type: 'globe' };
      const atm = cfg.atmosphere ?? 0;
      style.sky['atmosphere-blend'] = ['interpolate', ['linear'], ['zoom'], 0, atm, 5, atm, 7, 0];
    }
    if (cfg.terrain) style.terrain = { source: 'dem', exaggeration: cfg.terrain === true ? 1.3 : cfg.terrain };
    // tiles entering the view usually arrive several at a time: parse them in parallel
    const wc = +new URLSearchParams(location.search).get('mlw') || 4;
    this.stats.mlWorkersBefore = getWorkerCount();
    if (getWorkerCount() < wc) setWorkerCount(wc);
    const map = (this.map = new MapLibreMap({
      container: stage.querySelector('#map'), style, interactive: false, attributionControl: false,
      center: [0, 20], zoom: 1.6, maxPitch: 85, fadeDuration: 250, renderWorldCopies: true,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).get('pdb') !== '0', powerPreference: 'high-performance' },
      transformRequest: (url) => ({ url: proxied(url) }),
      maxTileCacheZoomLevels: 8, pixelRatio: window.devicePixelRatio,
    }));
    map.on('error', (e) => { const m = String(e?.error?.message || e?.error || e); if (!/404|AbortError/.test(m)) this.warn('map: ' + m); });
    await new Promise((res, rej) => { map.once('load', res); setTimeout(() => rej(new Error('Map did not load within 60s.' + (this.warnings.length ? ' Problems: ' + this.warnings.join(' | ') : ' Check network access to tiles.openfreemap.org.'))), 60000); });
    // We drive every frame with map.redraw(); MapLibre's own requestAnimationFrame renders would only
    // repeat work on the GPU. Its repaint requests become a wake-up signal for seek() instead.
    map.triggerRepaint = () => { if (this._drawing) return; const w = this._wake; if (w) { this._wake = null; w(); } };
    if (cfg.graticule) {
      map.addSource('graticule', { type: 'geojson', data: geo.graticule(cfg.graticule === true ? 15 : cfg.graticule) });
      map.addLayer({ id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': th.k(th.dark ? 0.3 : 0.4), 'line-width': 0.7, 'line-opacity': 0.5 } }, '@mid');
    }
    for (const el of this.mapEls) el.mount(map);
    this.camera.resolve();
    for (const el of this.domEls) el.mount();
    this.overlay.finish();
    await Promise.all(['500 20px Archivo', '400 20px Newsreader', 'italic 400 20px Newsreader', '500 20px "JetBrains Mono"'].map((f) => document.fonts.load(f, 'Aáç0')));
    await document.fonts.ready;
    this.mounted = true;
    this.layout();
  }

  /** Rectangles (stage px) of the screen-anchored elements visible at time t. */
  _screenBoxes(t) {
    const o = this.overlay.root.getBoundingClientRect(), k = this.width / (o.width || this.width), out = [];
    for (const el of this.domEls) if (el.place && el.el) el.update(t);
    for (const el of this.domEls) {
      if (!el.place || !el.el) continue;
      if (el.el.style.display === 'none') continue;
      const r = el.el.getBoundingClientRect();
      if (r.width) out.push({ el, box: [(r.left - o.left) * k, (r.top - o.top) * k, (r.right - o.left) * k, (r.bottom - o.top) * k] });
    }
    return out;
  }
  /**
   * Automatic label placement: every pin created without `side` gets the side where its label
   * overlaps the least — other labels, on-screen text, the frame edge — at the moment it appears.
   */
  layout() {
    const pins = this.domEls.filter((e) => e.autoSide && e.lab).sort((a, b) => a.at - b.at);
    if (!pins.length) return;
    const k = this.width / (this.overlay.root.getBoundingClientRect().width || this.width);
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const placed = [];
    for (const pin of pins) {
      const T = Math.min(this.duration, pin.at + pin.dur);
      this._applyCamera(T);
      const p = this.project(pin.lnglat, pin.o.alt || 0);
      pin.el.style.display = '';
      const r = pin.inner.getBoundingClientRect(), w = r.width * k, hh = r.height * k;
      const others = placed.filter((q) => q.at <= T && (q.end === null || q.end > T)).map((q) => { const c = this.project(q.lnglat, q.o.alt || 0), b = q.box(q.sideName, q._w, q._h); return [c.x + b[0] - 6, c.y + b[1] - 4, c.x + b[2] + 6, c.y + b[3] + 4]; });
      const dots = this.domEls.filter((q) => q !== pin && q.lnglat && q.at <= T && (q.end === null || q.end > T)).map((q) => { const c = this.project(q.lnglat, q.o.alt || 0); return [c.x - 14, c.y - 14, c.x + 14, c.y + 14]; });
      const screen = this._screenBoxes(T).map((b) => b.box);
      let best = 'right', bestScore = Infinity;
      ['right', 'left', 'top', 'bottom'].forEach((side, i) => {
        const b = pin.box(side, w, hh), box = [p.x + b[0], p.y + b[1], p.x + b[2], p.y + b[3]];
        const off = w * hh - inter(box, [24, 24, this.width - 24, this.height - 24]);
        const score = off * 6 + [...others, ...screen].reduce((a, o) => a + inter(box, o), 0) * 3 + dots.reduce((a, o) => a + inter(box, o), 0) * 2 + i * 0.5;
        if (score < bestScore) { bestScore = score; best = side; }
      });
      pin.setSide(best);
      pin._w = w; pin._h = hh;
      placed.push(pin);
    }
  }
  /** n moments worth looking at: evenly spread, each snapped to where something has just finished arriving. */
  keyTimes(n = 9) {
    const D = this.duration, ev = [];
    for (const el of [...this.domEls, ...this.mapEls]) {
      if (typeof el.at === 'number') ev.push(el.at + (el.dur || 0) + 0.15);
      const d = el.drawSpan?.();
      if (d) ev.push(d.at + d.dur * 0.5, d.at + d.dur + 0.1);
    }
    for (const sg of this.camera.segs) ev.push(sg.at + sg.dur);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * D, b = ((i + 1) / n) * D, mid = (a + b) / 2;
      const inSlot = ev.filter((t) => t >= a + 0.05 && t < b - 0.05).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid));
      out.push(+Math.min(D - 0.05, inSlot.length ? inSlot[0] : mid).toFixed(2));
    }
    return out;
  }
  /**
   * Machine check of the scene, no pixels needed: text that leaves the frame or collides, pins that
   * are off-screen when they appear, lines drawn outside the shot. Returns { issues, timeline }.
   */
  audit() {
    const D = this.duration, W = this.width, H = this.height, found = new Map();
    const note = (key, msg, t) => { const f = found.get(key) || { msg, a: t, b: t }; f.b = t; found.set(key, f); };
    const name = (el) => {
      const kind = el.constructor.name.replace('El', '').toLowerCase();
      if (kind === 'mover') return `mover (${String(el.o.icon).slice(0, 12)})`;
      const text = [el.text ?? el.o?.label, el.o?.sub, kind === 'counter' ? el.o?.unit : null].filter((x) => x != null && x !== '').join(' · ');
      return `${kind} "${String(text).replace(/\n/g, ' ').slice(0, 44)}"`;
    };
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    const pins = this.domEls.filter((e) => e.lnglat);
    for (let t = 0.25; t < D; t += 0.5) {
      this._applyCamera(t);
      const boxes = this._screenBoxes(t);
      for (const { el, box } of boxes) {
        const over = Math.max(-box[0], -box[1], box[2] - W, box[3] - H);
        if (over > 2) note('off:' + this.domEls.indexOf(el), `${name(el)} runs ${Math.round(over)}px off the frame — shorten it, set width, or move it`, t);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        if (inter(boxes[i].box, boxes[j].box) > 0.05 * Math.min(area(boxes[i].box), area(boxes[j].box))) note(`ov:${i}:${j}`, `${name(boxes[i].el)} overlaps ${name(boxes[j].el)} — give one of them another pos or end time`, t);
      }
      for (const pin of pins) {
        if (!pin.lab || t < pin.at + pin.dur || (pin.end !== null && t > pin.end)) continue;
        const c = this.project(pin.lnglat, pin.o.alt || 0);
        if (!c.visible || c.x < 0 || c.y < 0 || c.x > W || c.y > H) continue;
        const r = pin.inner.getBoundingClientRect(), o = this.overlay.root.getBoundingClientRect(), k = W / (o.width || W);
        pin.update(t);
        const r2 = pin.inner.getBoundingClientRect();
        const box = [(r2.left - o.left) * k, (r2.top - o.top) * k, (r2.right - o.left) * k, (r2.bottom - o.top) * k];
        if (!r2.width) continue;
        for (const b of boxes) if (inter(box, b.box) > 0.3 * area(box)) note('pin:' + this.domEls.indexOf(pin) + ':' + this.domEls.indexOf(b.el), `label "${pin.text}" sits under ${name(b.el)} — move that text to another corner`, t);
      }
    }
    for (const pin of pins) {
      const t = Math.min(D - 0.01, pin.at + pin.dur);
      this._applyCamera(t);
      const c = this.project(pin.lnglat, pin.o.alt || 0);
      if (c.x < 0 || c.y < 0 || c.x > W || c.y > H) note('pinoff:' + this.domEls.indexOf(pin), `pin "${pin.text ?? ''}" appears at ${pin.at.toFixed(1)}s outside the frame — the camera is elsewhere then`, t);
    }
    for (const line of this.mapEls) {
      const d = line.drawSpan?.();
      if (!d) continue;
      let out = 0, n = 0;
      for (let t = d.at + 0.2; t < d.at + d.dur; t += 0.4) { this._applyCamera(t); const c = this.project(line.headAt(t)); n++; if (c.x < 0 || c.y < 0 || c.x > W || c.y > H) out++; }
      if (n && out / n > 0.25) note('line:' + line.id, `a line draws outside the frame for ${Math.round((out / n) * 100)}% of its time (${d.at.toFixed(1)}–${(d.at + d.dur).toFixed(1)}s) — fit the camera to it or follow it`, d.at);
    }
    for (const el of this.domEls) if (el.text && el.place && String(el.text).replace(/\n.*/s, '').length > 52) note('long:' + this.domEls.indexOf(el), `${name(el)} is long (${String(el.text).length} chars) — on-screen text reads best under ~40`, el.at);
    const issues = [...found.values()].map((f) => (f.b > f.a ? `${f.a.toFixed(1)}–${f.b.toFixed(1)}s  ` : `${f.a.toFixed(1)}s  `) + f.msg);
    const timeline = [];
    for (const el of this.domEls) timeline.push([el.at, `${el.at.toFixed(1)}${el.end != null ? '–' + el.end.toFixed(1) : ''}  ${name(el)}`]);
    for (const el of this.mapEls) { const d = el.drawSpan?.(); timeline.push([d ? d.at : el.at, d ? `${d.at.toFixed(1)}–${(d.at + d.dur).toFixed(1)}  line draws${el.km ? ' ' + Math.round(el.km) + ' km' : ''}` : `${el.at.toFixed(1)}${el.end != null ? '–' + el.end.toFixed(1) : ''}  ${el.constructor.name.replace('El', '').toLowerCase()}`]); }
    for (const sg of this.camera.segs) timeline.push([sg.at, `${sg.at.toFixed(1)}–${(sg.at + sg.dur).toFixed(1)}  camera ${sg.label || sg.type}`]);
    timeline.sort((a, b) => a[0] - b[0]);
    return { issues, timeline: timeline.map((x) => x[1]), places: data.resolved.map((p) => `"${p.q}" → ${p.name} [${p.lng}, ${p.lat}]`) };
  }
  warn(msg) { if (!this.warnings.includes(msg)) { this.warnings.push(msg); console.warn('[bamba] ' + msg); } }

  _applyCamera(t) {
    const st = this.camera.state(t);
    // MapLibre's globe grows by 1/cos(lat) as the centre moves away from the equator; cancel that so
    // `zoom` means one globe size everywhere (fades out as the globe flattens into mercator).
    const zoom = st.zoom + this.globeZoomFix(st.center[1], st.zoom);
    // `ahead` pushes the subject off-centre (e.g. a followed head sits low, showing the road in front)
    const [ox, oy] = st.offset || [0, 0];
    const padding = { left: Math.max(0, 2 * ox), right: Math.max(0, -2 * ox), top: Math.max(0, 2 * oy), bottom: Math.max(0, -2 * oy) };
    this.map.jumpTo({ center: st.center, zoom, bearing: st.bearing, pitch: clamp(st.pitch, 0, 85), padding });
    return st;
  }
  /**
   * Jump to time t from anywhere: renders it a few times while only the label clock advances, so map
   * labels are fully placed and faded in (use before stills, and before the first frame of a segment).
   */
  async settle(t) {
    for (const back of [0.9, 0.6, 0.3]) await this.seek(t, t - back);
    await this.seek(t);
  }
  /** Render the scene at time t (seconds). Resolves when every tile and source for that frame is drawn. */
  async seek(t, clock = t) {
    const map = this.map, st = this.stats, now = () => performance.now();
    let m = now();
    const lap = (k) => { const n = now(); st[k] = (st[k] || 0) + n - m; m = n; };
    setNow(100000 + clock * 1000); // MapLibre's clock: drives label fades and collision updates
    this._applyCamera(t);
    if (this._bldg) {
      const v = Math.max(0.001, this._bldg.ease(prog(t, this._bldg.at, this._bldg.dur)));
      if (v !== this._bldgV) { map.setGlobalStateProperty('bldg', v); this._bldgV = v; } // re-buckets every building: only when it moves
    }
    for (const el of this.mapEls) el.update(t, map);
    lap('update');
    const t0 = performance.now();
    for (;;) {
      // Draw, then ask whether that draw had everything: tile and source loads only complete between
      // tasks, so "all loaded" right after a synchronous redraw means the frame is whole.
      // (map.loaded() is unusable here: label fades keep the style "dirty" while the clock is frozen.)
      this._drawing = true; // repaint requests made by the draw itself are not news
      map.redraw();
      this._drawing = false;
      this.stats.redraws++;
      lap('draw');
      if (map.isStyleLoaded() && map.areTilesLoaded()) break;
      if (performance.now() - t0 > 45000) { this.warn(`frame at ${t.toFixed(2)}s: tiles still loading after 45s (network?)`); break; }
      // Wait for the loads WITHOUT drawing: a draw while a GeoJSON source is re-tiling restarts its
      // tiles, so drawing on every event never converges. MapLibre's repaint requests wake us to
      // re-check; draw again only when everything is in (or after 250 ms, in case a draw is needed).
      const w0 = performance.now();
      while (!(map.isStyleLoaded() && map.areTilesLoaded()) && performance.now() - w0 < 250) await new Promise((r) => { this._wake = r; setTimeout(r, 8); });
      lap('wait');
    }
    this.stats.seeks++;
    for (const el of this.mapEls) el.dom?.(t);
    for (const el of this.domEls) el.update(t);
    if (this.cfg.globe) this.overlay.globe(this._tr(), this.camera.state(t));
    this.overlay.frame(Math.round(t * this.fps));
    this.overlay.time = t;
    lap('dom');
    await this.overlay.compose();
    lap('compose');
  }
  /** Render time t and POST its raw RGBA pixels to `url` (fast capture path used by the renderer). */
  async frame(t, settle, url, blur = 1, dt = 1 / 30) {
    if (settle) await this.settle(t); else await this.seek(t);
    // motion blur: average `blur` sub-frames spread over 0.4 of a frame (a 144° shutter)
    for (let k = 1; k < blur; k++) { this.overlay.accumulate(k); await this.seek(t + (k / blur) * dt * 0.4); }
    if (blur > 1) this.overlay.accumulate(blur, true);
    const st = this.stats, a = performance.now();
    const px = this.overlay.pixels();
    const b = performance.now();
    const body = new Blob([px]); // a Blob body uploads ~5× faster than a typed array
    let res = null;
    for (let attempt = 0; attempt < 3 && !(res && res.ok); attempt++) res = await fetch(url, { method: 'POST', body }).catch(() => null); // the server only accepts whole frames, so a retry is safe
    if (!res) throw new Error('frame upload failed: connection lost');
    st.pixels = (st.pixels || 0) + b - a;
    st.post = (st.post || 0) + performance.now() - b;
    st.frames = (st.frames || 0) + 1;
    if (!res.ok) throw new Error('frame upload failed: ' + res.status);
  }
}

export { EASE, PALETTE, THEMES, TEXT_IN, TEXT_OUT, ICONS, geo, color };
