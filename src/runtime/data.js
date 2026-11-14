// Real-world data, fetched once through the local caching proxy (see src/node/server.js).
import { bbox as bboxOf, haversine, inside } from './geo.js';

const via = (url) => '/__fetch?url=' + encodeURIComponent(url);
async function getJSON(url, init) {
  const res = await fetch(via(url), init);
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}\n${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Fetch JSON/GeoJSON/text. Remote URLs are cached on disk; relative paths resolve against the scene file. */
export async function load(url, base) {
  const remote = /^https?:/.test(url);
  const res = await fetch(remote ? via(url) : new URL(url, base).href);
  if (!res.ok) throw new Error(`load: ${res.status} for ${url}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function nominatim(q, extra = '') {
  const r = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}${extra}`);
  if (!r.length) throw new Error(`geocode: nothing found for "${q}". Try a more specific query ("Praça de Casa Forte, Recife") or pass [lng, lat].`);
  return r[0];
}

/** "Praça de Casa Forte, Recife" → [lng, lat] (with .name and .bbox attached). Arrays in → arrays out. */
export async function geocode(q) {
  if (Array.isArray(q) && typeof q[0] === 'number') return q;
  if (Array.isArray(q)) { const out = []; for (const x of q) out.push(await geocode(x)); return out; }
  const r = await nominatim(q);
  const pt = [parseFloat(r.lon), parseFloat(r.lat)];
  pt.name = r.name || q;
  pt.bbox = [+r.boundingbox[2], +r.boundingbox[0], +r.boundingbox[3], +r.boundingbox[1]];
  return pt;
}

/** A named place with its real outline: { center, bbox, geojson (Feature), name }. Works for countries, states, cities, neighbourhoods, parks, buildings. */
export async function place(q, o = {}) {
  const r = await nominatim(q, `&polygon_geojson=1&polygon_threshold=${o.simplify ?? 0.0005}`);
  const feature = { type: 'Feature', properties: { name: r.name }, geometry: r.geojson };
  return { name: r.name || q, center: [parseFloat(r.lon), parseFloat(r.lat)], bbox: [+r.boundingbox[2], +r.boundingbox[0], +r.boundingbox[3], +r.boundingbox[1]], geojson: feature, type: 'Feature', properties: feature.properties, geometry: r.geojson };
}

const OSRM = {
  car: 'https://router.project-osrm.org/route/v1/driving/',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/',
};
/** Real route along real streets. points: [[lng,lat] | "address", …] (2 or more). Returns a LineString Feature with .km and .minutes. */
export async function route(points, o = {}) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('s.route(points): pass an array of 2+ points ([lng, lat] or address strings)');
  const profile = o.profile || 'car';
  if (!OSRM[profile]) throw new Error(`route: unknown profile "${profile}". Valid: car, bike, foot`);
  const pts = await geocode(points);
  const r = await getJSON(`${OSRM[profile]}${pts.map((p) => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(';')}?overview=full&geometries=geojson&continue_straight=false`);
  if (r.code !== 'Ok' || !r.routes?.length) throw new Error('route: no route found (' + r.code + ')');
  const rt = r.routes[0];
  const f = { type: 'Feature', properties: { km: rt.distance / 1000, minutes: rt.duration / 60 }, geometry: rt.geometry };
  f.km = rt.distance / 1000;
  f.minutes = rt.duration / 60;
  f.stops = pts;
  return f;
}

/**
 * Real places from OpenStreetMap (Overpass). Returns [{ lng, lat, name, tags }].
 * o = { tags: 'amenity=cafe' | ['amenity=cafe', 'amenity=bar'] | 'tourism', around: [lng,lat] + radius (m) | within: bbox/geometry/place, named: true, limit }
 */
export async function pois(o = {}) {
  const tags = [].concat(o.tags || o.tag || []);
  if (!tags.length) throw new Error('pois: pass tags, e.g. { tags: "amenity=cafe", around: [lng, lat], radius: 800 }');
  let area;
  if (o.around) { const c = await geocode(o.around); area = `(around:${o.radius ?? 1000},${c[1]},${c[0]})`; }
  else if (o.within) { const b = Array.isArray(o.within) && o.within.length === 4 && typeof o.within[0] === 'number' ? o.within : bboxOf(o.within); area = `(${b[1]},${b[0]},${b[3]},${b[2]})`; }
  else throw new Error('pois: pass `around: [lng,lat]` (+ radius in metres) or `within: bbox | geometry`');
  const sel = tags.map((t) => { const [k, v] = t.split('='); return `nwr[${JSON.stringify(k)}${v ? '=' + JSON.stringify(v) : ''}]${o.named === false ? '' : '["name"]'}${area};`; }).join('');
  const body = 'data=' + encodeURIComponent(`[out:json][timeout:60];(${sel});out center tags ${o.limit ?? 2000};`);
  const r = await getJSON('https://overpass-api.de/api/interpreter', { method: 'POST', body });
  const seen = new Set();
  const out = [];
  for (const e of r.elements || []) {
    const lng = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (lng == null) continue;
    const key = (e.tags?.name || '') + '|' + lng.toFixed(4) + '|' + lat.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lng, lat, name: e.tags?.name || '', tags: e.tags || {}, id: e.type + '/' + e.id });
  }
  if (o.within && !(Array.isArray(o.within) && typeof o.within[0] === 'number')) { const keep = out.filter((p) => inside([p.lng, p.lat], o.within)); out.length = 0; out.push(...keep); } // exact outline, not just its bbox
  if (o.around) { const c = await geocode(o.around); out.sort((a, b) => haversine(c, [a.lng, a.lat]) - haversine(c, [b.lng, b.lat])); }
  return out;
}

let _countries;
/** Country outlines (Natural Earth 1:50m). countries('BR', 'Argentina', 'FRA') → Feature[]; countries() → all. */
export async function countries(...codes) {
  _countries ??= await (await fetch('/bamba/assets/countries.json')).json();
  const list = codes.flat();
  if (!list.length) return _countries.features;
  return list.map((c) => {
    const q = String(c).toLowerCase();
    const f = _countries.features.find((f) => { const p = f.properties; return p.iso2.toLowerCase() === q || p.iso3.toLowerCase() === q || p.name.toLowerCase() === q || (p.name_pt || '').toLowerCase() === q; });
    if (!f) throw new Error(`countries: "${c}" not found. Use ISO codes (BR, BRA) or English names.`);
    return f;
  });
}
