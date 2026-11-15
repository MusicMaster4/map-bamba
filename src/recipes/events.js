// recipe: events — dated points (earthquakes, launches, openings, sightings…) appearing in time order.
export const about = 'Dated points appearing in time order with a running date and count (earthquakes, openings, launches…).';
export const params = {
  data: 'REQUIRED. URL of JSON/GeoJSON, or an array of items',
  fields: '{ lng, lat, time, size, label } — paths into each item, e.g. { lng: "geometry.coordinates.0", lat: "geometry.coordinates.1", time: "properties.time", size: "properties.mag" }. Defaults fit GeoJSON points and plain {lng, lat, time} objects',
  sizes: '[min, max] of the size field mapped to dot radius 2…14 px (default: data range)',
  view: '{ center: [lng, lat], zoom } (default: frames the points)',
  unit: 'words after the count', format: 'Intl date options, default { year: "numeric" }',
  title: 'caption', sub: 'second line under the title',
};
export const example = { recipe: 'events', unit: 'terremotos de magnitude 7+', lang: 'pt', credit: 'Dados: USGS', view: { center: [-168, 8], zoom: 2.05 },
  data: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2000-01-01&endtime=2026-01-01&minmagnitude=7&orderby=time-asc',
  fields: { time: 'properties.time', size: 'properties.mag' } };

export default async (s, P) => {
  const D = P.duration ?? 20;
  s.brief(P, { labels: P.labels ?? 'none', roads: false, rail: false, boundaries: P.boundaries ?? false });
  const raw = typeof P.data === 'string' ? await s.load(P.data) : P.data;
  const list = Array.isArray(raw) ? raw : raw.features;
  if (!Array.isArray(list) || !list.length) throw new Error('events: data must be an array of items or a GeoJSON FeatureCollection');
  const f = { lng: list[0].geometry ? 'geometry.coordinates.0' : 'lng', lat: list[0].geometry ? 'geometry.coordinates.1' : 'lat', time: list[0].properties ? 'properties.time' : 'time', ...(P.fields || {}) };
  const get = (o, p) => p.split('.').reduce((v, k) => v?.[k], o);
  const items = list.map((d) => ({ lng: +get(d, f.lng), lat: +get(d, f.lat), time: +new Date(get(d, f.time)), size: f.size ? +get(d, f.size) : null, name: f.label ? get(d, f.label) : '' }))
    .filter((d) => isFinite(d.lng) && isFinite(d.lat) && isFinite(d.time)).sort((a, b) => a.time - b.time);
  if (!items.length) throw new Error('events: no item had a readable lng / lat / time — check `fields`');

  const from = items[0].time, to = items.at(-1).time, t0 = D * 0.1, t1 = D * 0.9;
  const when = (ms) => t0 + ((ms - from) / Math.max(1, to - from)) * (t1 - t0);
  const sized = items.filter((d) => d.size != null).map((d) => d.size);
  const [lo, hi] = P.sizes || (sized.length ? [Math.min(...sized), Math.max(...sized)] : [0, 1]);
  const k = (d) => (d.size == null ? 0.25 : Math.max(0, Math.min(1, (d.size - lo) / Math.max(1e-9, hi - lo))));

  if (P.view) s.camera.set(P.view); else s.camera.set({ fit: items.map((d) => [d.lng, d.lat]), padding: 170 });
  s.camera.drift({ at: 0, dur: D, zoom: '+0.14' });
  // small events stay in the accent colour, the biggest turn pale so they read over the crowd
  s.points(items, { at: (d) => when(d.time), dur: 0.5, pulse: 1.6, glow: 0.9, stroke: false, opacity: 0.85, size: (d) => 2 + k(d) ** 1.6 * 12, color: (d) => (k(d) > 0.75 ? s.c.paper : k(d) > 0.4 ? s.c.amber : s.c.accent), ...(f.label ? { label: 'name' } : {}) });
  s.date({ from, to, at: t0, dur: t1 - t0, format: P.format || { year: 'numeric' }, pos: 'tl', size: 110 });
  s.ticker({ value: (t) => items.filter((d) => when(d.time) <= t).length, at: t0, pos: 'bl', size: 64, unit: P.unit });
  if (P.title) s.caption(P.title, { at: 0.5, sub: P.sub, pos: 'br' });
  return { items };
};
