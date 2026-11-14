// Scene: the object a scene file receives as `s`. Everything is declared up front against a
// timeline; rendering is a pure function of time (seek(t)), so frames can be rendered in any
// order and in parallel.
import { Map as MapLibreMap, LngLat, MercatorCoordinate, setNow } from 'maplibre-gl';
import { EASE, ease as getEase, prog, clamp, lerp } from './ease.js';
import * as geo from './geo.js';
import * as color from './color.js';
import { buildStyle, resolveTheme, PALETTE, THEMES } from './style.js';
import { Camera } from './camera.js';
import { LineEl, AreaEl, PointsEl, ExtrudeEl } from './layers.js';
import { Overlay, TextEl, CounterEl, LegendEl, TimebarEl, PinEl, MoverEl, TEXT_IN, TEXT_OUT, ICONS } from './overlay.js';
import * as data from './data.js';

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
    const unknown = Object.keys(cfg).filter((k) => !(k in DEFAULTS) && !['bg', 'fg', 'accent', 'post', 'atmosphere'].includes(k));
    if (unknown.length) throw new Error(`Unknown config key(s): ${unknown.join(', ')}. Valid: ${Object.keys(DEFAULTS).join(', ')}, bg, fg, accent, post`);
    this.cfg = { ...DEFAULTS, ...cfg };
    this.sceneUrl = sceneUrl;
    this.duration = this.cfg.duration;
    this.fps = this.cfg.fps;
    [this.width, this.height] = this.cfg.size;
    const ov = {};
    for (const k of ['bg', 'fg', 'accent']) if (cfg[k]) ov[k] = cfg[k];
    this.theme = resolveTheme(this.cfg.theme, ov, { globe: !!this.cfg.globe });
    /** Colours: accents (signal, amber, ice, mint, rose, violet), neutrals (paper, dim) and theme (bg, fg, accent). */
    this.c = { ...PALETTE, bg: this.theme.bg, fg: this.theme.fg, accent: this.theme.accent, mix: color.mix, alpha: color.rgba };
    this.geo = geo;
    this.t = 0;
    this.camera = new Camera(this);
    this.mapEls = [];
    this.domEls = [];
    this.warnings = [];
    this._n = 0;
    this._bldg = null;
  }
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
    const a = +new Date(o.from), b = +new Date(o.to);
    const f = typeof o.format === 'function' ? o.format : ((fmt) => (d) => fmt.format(d))(new Intl.DateTimeFormat(this.cfg.locale, { timeZone: 'UTC', ...(o.format || { month: 'short', year: 'numeric' }) }));
    const e = getEase(o.ease || 'linear'), at = o.at ?? this.t, dur = o.dur ?? 10;
    return this.counter({ size: 64, ...o, at, value: (t) => f(new Date(lerp(a, b, e(prog(t, at, dur))))) });
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
    const map = (this.map = new MapLibreMap({
      container: stage.querySelector('#map'), style, interactive: false, attributionControl: false,
      center: [0, 20], zoom: 1.6, maxPitch: 85, fadeDuration: 250, renderWorldCopies: true,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' },
      transformRequest: (url) => ({ url: proxied(url) }),
      maxTileCacheZoomLevels: 8, pixelRatio: window.devicePixelRatio,
    }));
    map.on('error', (e) => { const m = String(e?.error?.message || e?.error || e); if (!/404|AbortError/.test(m)) this.warn('map: ' + m); });
    await new Promise((res, rej) => { map.once('load', res); setTimeout(() => rej(new Error('Map did not load within 60s.' + (this.warnings.length ? ' Problems: ' + this.warnings.join(' | ') : ' Check network access to tiles.openfreemap.org.'))), 60000); });
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
  }
  warn(msg) { if (!this.warnings.includes(msg)) { this.warnings.push(msg); console.warn('[bamba] ' + msg); } }

  _applyCamera(t) {
    const st = this.camera.state(t);
    // MapLibre's globe grows by 1/cos(lat) as the centre moves away from the equator; cancel that so
    // `zoom` means one globe size everywhere (fades out as the globe flattens into mercator).
    const zoom = st.zoom + this.globeZoomFix(st.center[1], st.zoom);
    this.map.jumpTo({ center: st.center, zoom, bearing: st.bearing, pitch: clamp(st.pitch, 0, 85) });
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
    const map = this.map;
    setNow(100000 + clock * 1000); // MapLibre's clock: drives label fades and collision updates
    this._applyCamera(t);
    if (this._bldg) map.setGlobalStateProperty('bldg', Math.max(0.001, this._bldg.ease(prog(t, this._bldg.at, this._bldg.dur))));
    for (const el of this.mapEls) el.update(t, map);
    const t0 = performance.now();
    let stable = 0;
    for (;;) {
      map.redraw();
      // (map.loaded() is unusable here: label fades keep the style "dirty" while the clock is frozen)
      if (map.isStyleLoaded() && map.areTilesLoaded() && !map._sourcesDirty) { if (++stable >= 2) break; } else stable = 0;
      if (performance.now() - t0 > 45000) { this.warn(`frame at ${t.toFixed(2)}s: tiles still loading after 45s (network?)`); break; }
      await new Promise((r) => setTimeout(r, stable ? 0 : 6));
    }
    for (const el of this.domEls) el.update(t);
    if (this.cfg.globe) this.overlay.globe(this._tr(), this.camera.state(t));
    this.overlay.frame(Math.round(t * this.fps));
  }
}

export { EASE, PALETTE, THEMES, TEXT_IN, TEXT_OUT, ICONS, geo, color };
