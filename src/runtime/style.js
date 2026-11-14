// Base-map style builder. Every colour is derived from two inputs — background and ink —
// so any background colour yields a coherent map. Data: OpenFreeMap (OpenMapTiles schema).
import { mix, luminance, rgba } from './color.js';

export const THEMES = {
  // The default: near-black canvas, the map is drawn on top of it in soft graphite.
  ink: { bg: '#151515', fg: '#ECE7DD', accent: '#FF5A36', green: '#5F8F6B', blue: '#151515' },
  // Warm light paper.
  paper: { bg: '#F1EDE4', fg: '#1B1A18', accent: '#D8421F', green: '#7FA26E', blue: '#D9E1E2' },
  // Deep navy night.
  night: { bg: '#0B1220', fg: '#DCE6F5', accent: '#FFB627', green: '#3F7F78', blue: '#0B1220' },
  // Blueprint.
  blueprint: { bg: '#0F2A47', fg: '#E6F0FA', accent: '#FFD166', green: '#5FA8A0', blue: '#0F2A47' },
};

/** Accent palette for foreground drawing. Use one accent per scene, plus `paper`/`dim` neutrals. */
export const PALETTE = {
  signal: '#FF5A36', amber: '#FFB627', ice: '#7CC7FF', mint: '#58D6A3', rose: '#FF6F91', violet: '#A893FF',
  paper: '#ECE7DD', dim: '#8C8A85', ukraine: '#F2C94C', black: '#0B0B0B', white: '#FFFFFF',
};

export function resolveTheme(theme, overrides = {}, flags = {}) {
  const base = typeof theme === 'string' ? THEMES[theme] : theme;
  if (!base) throw new Error(`Unknown theme "${theme}". Valid: ${Object.keys(THEMES).join(', ')} or {bg, fg, accent}`);
  const t = { ...THEMES.ink, ...base, ...overrides };
  if (overrides.bg && !overrides.fg && !(typeof theme === 'object' && theme.fg)) t.fg = luminance(t.bg) > 0.4 ? '#1B1A18' : '#ECE7DD';
  if (overrides.bg && !overrides.blue) t.blue = luminance(t.bg) > 0.4 ? mix(t.bg, '#9DB7C4', 0.35) : t.bg;
  t.dark = luminance(t.bg) < 0.4;
  const k = (p) => mix(t.bg, t.fg, p);
  t.k = k;
  // Water is the canvas itself on dark themes; land is "drawn" one step lighter.
  t.water = t.dark ? t.bg : t.blue;
  t.land = t.dark ? k(0.085) : t.bg;
  // On a globe the sphere has to read against empty space, so the ocean lifts off the canvas a little.
  if (flags.globe && t.dark) { t.water = k(0.035); t.land = k(0.1); }
  t.shore = k(t.dark ? 0.2 : 0.22);
  t.wood = mix(t.land, t.green, t.dark ? 0.1 : 0.22);
  t.grass = mix(t.land, t.green, t.dark ? 0.07 : 0.16);
  t.ice = k(t.dark ? 0.12 : 0.0);
  t.sand = mix(t.land, '#C9B38A', t.dark ? 0.04 : 0.18);
  t.building = k(t.dark ? 0.125 : 0.1);
  t.buildingLine = k(t.dark ? 0.19 : 0.18);
  t.building3d = k(t.dark ? 0.3 : 0.06);
  t.road = [k(0.16), k(0.2), k(0.25), k(0.31), k(0.38)]; // minor, tertiary, secondary, primary/trunk, motorway
  if (!t.dark) t.road = [k(0.0), k(0.0), k(0.0), k(0.0), k(0.0)].map((c, i) => mix('#FFFFFF', t.fg, [0.0, 0.0, 0.02, 0.05, 0.1][i]));
  t.roadCase = t.dark ? t.land : k(0.16);
  t.rail = k(0.2);
  t.border = [k(0.42), k(0.24)]; // country, state
  t.label = { country: k(0.62), state: k(0.48), city: k(0.8), town: k(0.56), hood: k(0.38), street: k(0.56), water: k(t.dark ? 0.34 : 0.45), poi: k(0.5) };
  t.halo = t.land;
  return t;
}

const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const exp = (base, ...stops) => ['interpolate', ['exponential', base], ['zoom'], ...stops];
const lin = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];

/**
 * opts: { labels: 'all'|'places'|'none' | {countries, states, cities, hoods, streets, water, pois},
 *         roads, rail, boundaries, landcover, buildings: false|'2d'|'3d', hillshade, lang, tiles }
 */
export function buildStyle(t, opts = {}, tilesUrl) {
  const o = { labels: 'all', roads: true, rail: true, boundaries: true, landcover: true, buildings: '2d', hillshade: false, lang: 'en', ...opts };
  const L = typeof o.labels === 'object'
    ? { ...o.labels }
    : o.labels === 'none' || o.labels === false
      ? {}
      : o.labels === 'places'
        ? { countries: true, cities: true, water: true }
        : { countries: true, states: true, cities: true, hoods: true, streets: true, water: true, pois: o.labels === 'pois' };
  const name = ['coalesce', ['get', `name:${o.lang}`], ['get', 'name:latin'], ['get', 'name']];
  const F = { reg: ['Bamba Sans'], med: ['Bamba Sans Medium'], cond: ['Bamba Condensed'], ital: ['Bamba Serif Italic'] };
  const halo = { 'text-halo-color': t.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.6 };
  const layers = [];
  const add = (l) => layers.push({ source: 'omt', ...l });

  layers.push({ id: 'background', type: 'background', paint: { 'background-color': t.land } });

  if (o.landcover) {
    add({ id: 'landcover-ice', type: 'fill', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'ice'], paint: { 'fill-color': t.ice, 'fill-opacity': 0.6, 'fill-antialias': false } });
    add({ id: 'landcover-wood', type: 'fill', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': t.wood, 'fill-opacity': lin(4, 0.5, 10, 0.9), 'fill-antialias': false } });
    add({ id: 'landcover-grass', type: 'fill', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wetland']]], paint: { 'fill-color': t.grass, 'fill-opacity': 0.9, 'fill-antialias': false } });
    add({ id: 'landcover-sand', type: 'fill', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'sand'], paint: { 'fill-color': t.sand, 'fill-antialias': false } });
    add({ id: 'park', type: 'fill', 'source-layer': 'park', paint: { 'fill-color': t.grass, 'fill-opacity': 0.6, 'fill-antialias': false } });
    add({ id: 'landuse-green', type: 'fill', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'pitch', 'stadium', 'playground', 'garden']]], paint: { 'fill-color': t.grass, 'fill-opacity': 0.8, 'fill-antialias': false } });
  }
  if (o.hillshade) {
    const h = typeof o.hillshade === 'number' ? o.hillshade : 0.5;
    layers.push({
      id: 'hillshade', type: 'hillshade', source: 'dem',
      paint: {
        // default strength eases off at street level, where the elevation data is coarser than the map
        'hillshade-exaggeration': typeof o.hillshade === 'number' ? h : lin(3, h * 0.75, 7, h, 10, h, 12.5, h * 0.45, 15, h * 0.2), 'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': t.dark ? '#050505' : mix(t.bg, t.fg, 0.75),
        'hillshade-highlight-color': t.dark ? mix(t.bg, t.fg, 0.42) : '#FFFFFF',
        'hillshade-accent-color': t.dark ? '#000000' : mix(t.bg, t.fg, 0.5),
      },
    });
  }
  layers.push({ id: '@low', type: 'background', layout: { visibility: 'none' }, paint: {} });

  add({ id: 'water', type: 'fill', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': t.water } });
  add({ id: 'water-shore', type: 'line', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'line-color': t.shore, 'line-width': lin(0, 0.5, 6, 0.7, 12, 0.9, 16, 1.2), 'line-opacity': t.dark ? 0.85 : 0.5 } });
  add({ id: 'waterway', type: 'line', 'source-layer': 'waterway', filter: ['!=', ['get', 'brunnel'], 'tunnel'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': t.dark ? t.shore : t.water, 'line-opacity': t.dark ? 0.55 : 1, 'line-width': exp(1.4, 6, 0.4, 12, 1.2, 16, 4) } });

  if (o.roads) {
    add({ id: 'aeroway', type: 'line', 'source-layer': 'aeroway', minzoom: 10, filter: ['in', ['get', 'class'], ['literal', ['runway', 'taxiway']]], paint: { 'line-color': t.road[1], 'line-width': exp(1.5, 10, ['match', ['get', 'class'], 'runway', 2, 0.5], 14, ['match', ['get', 'class'], 'runway', 16, 4], 18, ['match', ['get', 'class'], 'runway', 80, 20]) } });
    const roadLayer = (id, filter, color, width, extra = {}) => {
      add({ id, type: 'line', 'source-layer': 'transportation', filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width, ...extra.paint }, ...(extra.minzoom ? { minzoom: extra.minzoom } : {}) });
    };
    const cls = (...c) => ['in', ['get', 'class'], ['literal', c]];
    const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
    roadLayer('road-tunnel', ['all', ['==', ['get', 'brunnel'], 'tunnel'], cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor')], t.road[0], exp(1.5, 10, 0.4, 14, 2, 18, 12), { paint: { 'line-opacity': 0.5 } });
    roadLayer('road-path', ['all', notTunnel, cls('path', 'track')], t.road[0], exp(1.5, 14, 0.5, 18, 2.5), { minzoom: 14, paint: { 'line-dasharray': [1.5, 1.5] } });
    roadLayer('road-minor', ['all', notTunnel, cls('minor', 'service')], t.road[0], exp(1.5, 12, 0.3, 14, 1.3, 16, 4, 18, 11), { minzoom: 12 });
    roadLayer('road-tertiary', ['all', notTunnel, cls('tertiary')], t.road[1], exp(1.5, 10, 0.3, 14, 2.2, 16, 6, 18, 14), { minzoom: 10 });
    roadLayer('road-secondary', ['all', notTunnel, cls('secondary')], t.road[2], exp(1.5, 8, 0.3, 14, 2.8, 16, 7, 18, 16), { minzoom: 8 });
    roadLayer('road-primary', ['all', notTunnel, cls('primary', 'trunk')], t.road[3], exp(1.5, 6, 0.35, 10, 1.1, 14, 3.4, 16, 8, 18, 18), { minzoom: 6 });
    roadLayer('road-motorway', ['all', notTunnel, cls('motorway')], t.road[4], exp(1.5, 5, 0.4, 10, 1.6, 14, 4.2, 16, 9, 18, 20), { minzoom: 5 });
  }
  if (o.rail) {
    add({ id: 'rail', type: 'line', 'source-layer': 'transportation', minzoom: 9, filter: ['all', ['in', ['get', 'class'], ['literal', ['rail', 'transit']]], ['!=', ['get', 'brunnel'], 'tunnel']], paint: { 'line-color': t.rail, 'line-width': exp(1.4, 9, 0.4, 14, 1, 18, 3), 'line-dasharray': [4, 2] } });
  }
  layers.push({ id: '@mid', type: 'background', layout: { visibility: 'none' }, paint: {} });

  if (o.buildings) {
    add({ id: 'building', type: 'fill', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': t.building, 'fill-outline-color': t.buildingLine, 'fill-opacity': o.buildings === '3d' ? lin(13, 0.6, 15, 0) : lin(13, 0.5, 15, 1) } });
    if (o.buildings === '3d') {
      add({
        id: 'building-3d', type: 'fill-extrusion', 'source-layer': 'building', minzoom: 13.5,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, t.k(t.dark ? 0.17 : 0.1), 25, t.k(t.dark ? 0.24 : 0.07), 120, t.k(t.dark ? 0.38 : 0.03)], 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-height': ['*', ['coalesce', ['get', 'render_height'], 6], ['coalesce', ['global-state', 'bldg'], 1]],
          'fill-extrusion-base': ['*', ['coalesce', ['get', 'render_min_height'], 0], ['coalesce', ['global-state', 'bldg'], 1]],
        },
      });
    }
  }
  if (o.boundaries) {
    const land = ['!=', ['get', 'maritime'], 1];
    add({ id: 'boundary-state', type: 'line', 'source-layer': 'boundary', minzoom: 3, filter: ['all', ['==', ['get', 'admin_level'], 4], land], layout: { 'line-join': 'round' }, paint: { 'line-color': t.border[1], 'line-width': lin(3, 0.4, 8, 0.9, 12, 1.4), 'line-dasharray': [3, 2] } });
    add({ id: 'boundary-country', type: 'line', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], land, ['!=', ['get', 'disputed'], 1]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': t.border[0], 'line-width': lin(0, 0.45, 4, 0.8, 8, 1.4, 12, 2.2) } });
    add({ id: 'boundary-disputed', type: 'line', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], land, ['==', ['get', 'disputed'], 1]], paint: { 'line-color': t.border[0], 'line-width': lin(0, 0.45, 4, 0.8, 8, 1.4), 'line-dasharray': [2, 2] } });
  }
  layers.push({ id: '@top', type: 'background', layout: { visibility: 'none' }, paint: {} });

  // ---- labels -------------------------------------------------------------------
  const sym = (id, sl, filter, layout, paint, extra = {}) => add({ id, type: 'symbol', 'source-layer': sl, filter, layout: { 'text-field': name, 'text-padding': 4, ...layout }, paint: { ...halo, ...paint }, ...extra });
  if (L.water) {
    sym('label-ocean', 'water_name', ['in', ['get', 'class'], ['literal', ['ocean', 'sea']]], { 'text-font': F.ital, 'text-size': lin(1, 13, 5, 19), 'text-letter-spacing': 0.18, 'text-max-width': 6, 'text-line-height': 1.15 }, { 'text-color': t.label.water, 'text-halo-width': 0 });
    sym('label-lake', 'water_name', ['all', ['!', ['in', ['get', 'class'], ['literal', ['ocean', 'sea']]]], ['==', ['geometry-type'], 'Point']], { 'text-font': F.ital, 'text-size': lin(6, 11, 12, 15), 'text-letter-spacing': 0.06, 'text-max-width': 6 }, { 'text-color': t.label.water, 'text-halo-width': 0 }, { minzoom: 6 });
    sym('label-waterway', 'waterway', ['==', ['geometry-type'], 'LineString'], { 'text-font': F.ital, 'text-size': 13, 'symbol-placement': 'line', 'symbol-spacing': 500, 'text-letter-spacing': 0.08 }, { 'text-color': t.label.water }, { minzoom: 12 });
  }
  if (L.streets) {
    sym('label-street', 'transportation_name', ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']]],
      { 'text-font': F.reg, 'symbol-placement': 'line', 'text-size': lin(13, 10.5, 16, 12.5, 18, 15), 'symbol-spacing': 420, 'text-letter-spacing': 0.04, 'text-max-angle': 28, 'text-padding': 8 },
      { 'text-color': t.label.street }, { minzoom: 13.5 });
  }
  if (L.pois) {
    sym('label-poi', 'poi', ['<=', ['get', 'rank'], 14], { 'text-font': F.reg, 'text-size': 11.5, 'text-max-width': 7, 'text-padding': 10, 'text-anchor': 'top', 'text-offset': [0, 0.5] }, { 'text-color': t.label.poi }, { minzoom: 15 });
    add({ id: 'poi-dot', type: 'circle', 'source-layer': 'poi', minzoom: 15, filter: ['<=', ['get', 'rank'], 14], paint: { 'circle-radius': 2.2, 'circle-color': t.label.poi, 'circle-opacity': 0.8 } });
  }
  if (L.hoods) {
    sym('label-hood', 'place', ['in', ['get', 'class'], ['literal', ['suburb', 'quarter', 'neighbourhood']]],
      { 'text-font': F.cond, 'text-size': lin(11, 10.5, 15, 14), 'text-transform': 'uppercase', 'text-letter-spacing': 0.14, 'text-max-width': 7, 'text-padding': 12 },
      { 'text-color': t.label.hood }, { minzoom: 11.5 });
  }
  if (L.cities) {
    sym('label-village', 'place', ['in', ['get', 'class'], ['literal', ['village', 'hamlet']]], { 'text-font': F.reg, 'text-size': lin(10, 10.5, 14, 13), 'text-max-width': 7 }, { 'text-color': t.label.town }, { minzoom: 10.5 });
    sym('label-town', 'place', ['==', ['get', 'class'], 'town'], { 'text-font': F.reg, 'text-size': lin(7, 11, 12, 15), 'text-max-width': 7 }, { 'text-color': t.label.town }, { minzoom: 7 });
    sym('label-city', 'place', ['==', ['get', 'class'], 'city'],
      { 'text-font': F.med, 'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['step', ['get', 'rank'], 13, 3, 11.5, 6, 10.5], 8, ['step', ['get', 'rank'], 19, 3, 16, 6, 14], 13, 22], 'text-max-width': 7, 'symbol-sort-key': ['get', 'rank'], 'text-padding': 6 },
      { 'text-color': t.label.city }, { minzoom: 3, maxzoom: 14.5 });
  }
  if (L.states) {
    sym('label-state', 'place', ['in', ['get', 'class'], ['literal', ['state', 'province']]], { 'text-font': F.cond, 'text-size': lin(4, 10, 8, 13), 'text-transform': 'uppercase', 'text-letter-spacing': 0.16, 'text-max-width': 6 }, { 'text-color': t.label.state }, { minzoom: 4.2, maxzoom: 9.5 });
  }
  if (L.countries) {
    sym('label-country', 'place', ['==', ['get', 'class'], 'country'],
      { 'text-font': F.cond, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['step', ['get', 'rank'], 12, 2, 10.5, 4, 9.5], 5, ['step', ['get', 'rank'], 20, 2, 16, 4, 13]], 'text-transform': 'uppercase', 'text-letter-spacing': 0.2, 'text-max-width': 6.5, 'symbol-sort-key': ['get', 'rank'], 'text-padding': 8 },
      { 'text-color': t.label.country }, { minzoom: 1, maxzoom: 7.5 });
  }

  const style = {
    version: 8,
    name: 'bamba',
    transition: { duration: 0, delay: 0 },
    glyphs: '/bamba/assets/glyphs/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', tiles: [tilesUrl], minzoom: 0, maxzoom: 14, attribution: '© OpenStreetMap' },
      dem: { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 256, maxzoom: 13, encoding: 'terrarium' },
    },
    layers,
    sky: {
      'sky-color': t.bg, 'horizon-color': mix(t.bg, t.fg, t.dark ? 0.1 : 0.0), 'fog-color': t.bg,
      'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.6, 'sky-horizon-blend': 0.7, 'atmosphere-blend': 0,
    },
    light: { anchor: 'viewport', color: '#ffffff', intensity: t.dark ? 0.62 : 0.3, position: [1.3, 215, 42] },
  };
  return style;
}
export { rgba };
