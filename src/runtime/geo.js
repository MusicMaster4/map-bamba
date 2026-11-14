// Geometry helpers. Coordinates are always [lng, lat] (GeoJSON order).
const R = 6371.0088; // km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Initial compass bearing a → b in degrees. */
export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
export const mercX = (lng) => lng / 360 + 0.5;
export const mercY = (lat) => { const s = Math.sin(rad(Math.max(-85.0511, Math.min(85.0511, lat)))); return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI; };
export const unmercX = (x) => (x - 0.5) * 360;
export const unmercY = (y) => deg(2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2);

/** Make longitudes continuous so lines crossing the antimeridian don't wrap around the world. */
export function unwrap(coords) {
  const out = [coords[0].slice()];
  for (let i = 1; i < coords.length; i++) {
    let lng = coords[i][0];
    const prev = out[i - 1][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    out.push([lng, coords[i][1], ...coords[i].slice(2)]);
  }
  return out;
}

/** Great-circle path a → b as n+1 points (shortest way, longitudes unwrapped). */
export function greatCircle(a, b, n = 128) {
  const [l1, p1, l2, p2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [a.slice(0, 2), b.slice(0, 2)];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    pts.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return unwrap(pts);
}

/** Smooth curve through waypoints (centripetal Catmull-Rom). Use for hand-placed sea/air/historic routes. */
export function spline(points, perSegment = 24) {
  const P = unwrap(points);
  if (P.length < 3) return P;
  const out = [];
  const get = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
  for (let i = 0; i < P.length - 1; i++) {
    const [p0, p1, p2, p3] = [get(i - 1), get(i), get(i + 1), get(i + 2)];
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(P[P.length - 1].slice(0, 2));
  return out;
}

/** Extract a flat coordinate list from anything line-like: coords array, Feature, Geometry, LineEl. */
export function lineCoords(g) {
  if (!g) throw new Error('line: missing geometry');
  if (g.coords && g.metric) return g.coords; // LineEl
  if (Array.isArray(g)) return typeof g[0][0] === 'number' ? g : g.flat();
  if (g.type === 'Feature') return lineCoords(g.geometry);
  if (g.type === 'FeatureCollection') return g.features.flatMap((f) => lineCoords(f));
  if (g.type === 'LineString') return g.coordinates;
  if (g.type === 'MultiLineString') return g.coordinates.flat();
  if (g.type === 'Polygon') return g.coordinates[0];
  throw new Error('line: unsupported geometry ' + g.type);
}

/** Normalise anything area-like into a FeatureCollection. */
export function toFC(g) {
  if (!g) throw new Error('missing geometry');
  if (Array.isArray(g)) {
    if (g.length && g[0] && g[0].type) return { type: 'FeatureCollection', features: g.flatMap((x) => toFC(x).features) };
    if (typeof g[0][0] === 'number') return toFC({ type: 'Polygon', coordinates: [g] }); // ring of coords
    return toFC({ type: 'Polygon', coordinates: g });
  }
  if (g.type === 'FeatureCollection') return g;
  if (g.type === 'Feature') return { type: 'FeatureCollection', features: [g] };
  if (g.geojson) return toFC(g.geojson); // result of s.place()
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: g }] };
}

const isCoords = (a) => typeof a[0] === 'number' || (Array.isArray(a[0]) && isCoords(a[0]));
export function bbox(g) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(visit);
  };
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) { if (!x.length) return; if (isCoords(x)) visit(x); else x.forEach(walk); }
    else if (x.coords && x.metric) visit(x.coords);
    else if (x.type === 'FeatureCollection') x.features.forEach(walk);
    else if (x.type === 'Feature') walk(x.geometry);
    else if (x.type === 'GeometryCollection') x.geometries.forEach(walk);
    else if (x.coordinates) visit(x.coordinates);
    else if (x.geojson) walk(x.geojson);
    else if (x.bbox) { visit([x.bbox[0], x.bbox[1]]); visit([x.bbox[2], x.bbox[3]]); }
  };
  walk(g);
  if (!isFinite(w)) throw new Error('bbox: no coordinates found');
  return [w, s, e, n];
}

/**
 * Arc-length parameterisation of a path. Fractions are in real (geodesic) distance, so a mover
 * travelling 0 → 1 moves at constant ground speed.
 */
export class PathMetric {
  constructor(coords) {
    this.coords = unwrap(coords.map((c) => [c[0], c[1]]));
    const n = this.coords.length;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + haversine(this.coords[i - 1], this.coords[i]);
    this.km = this.cum[n - 1];
  }
  _locate(f) {
    const d = Math.max(0, Math.min(1, f)) * this.km;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    const seg = this.cum[hi] - this.cum[lo];
    return [lo, seg > 0 ? (d - this.cum[lo]) / seg : 0];
  }
  /** Point at fraction f (0..1). */
  at(f) {
    if (this.coords.length === 1) return this.coords[0];
    const [i, k] = this._locate(f);
    const a = this.coords[i], b = this.coords[Math.min(i + 1, this.coords.length - 1)];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  /** Coordinates of the sub-path between fractions f0..f1. */
  slice(f0, f1) {
    if (f1 <= f0) return [];
    const [i0] = this._locate(f0), [i1] = this._locate(f1);
    const out = [this.at(f0)];
    for (let i = i0 + 1; i <= i1; i++) out.push(this.coords[i]);
    out.push(this.at(f1));
    return out;
  }
  /** Compass heading at fraction f, averaged over a window (fraction of total length) to keep it stable. */
  heading(f, window = 0.01) {
    return bearing(this.at(Math.max(0, f - window / 2)), this.at(Math.min(1, f + window / 2)));
  }
}

/** Circle polygon around a point, radius in km. */
export function circle(center, km, steps = 96) {
  const ring = [];
  const lat = rad(center[1]), lng = rad(center[0]), d = km / R;
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI;
    const la = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
    const lo = lng + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(la));
    ring.push([deg(lo), deg(la)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [unwrap(ring)] } };
}

/** Graticule (meridians + parallels) as a MultiLineString feature. */
export function graticule(step = 15) {
  const lines = [];
  for (let lng = -180; lng < 180; lng += step) { const l = []; for (let lat = -84; lat <= 84; lat += 2) l.push([lng, lat]); lines.push(l); }
  for (let lat = -75; lat <= 75; lat += step) { const l = []; for (let lng = -180; lng <= 180; lng += 2) l.push([lng, lat]); lines.push(l); }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

/** Visual centre of a polygon feature (area-weighted centroid of its largest ring) — good for placing labels. */
export function centroid(g) {
  const fc = toFC(g);
  let best = null, bestA = -1;
  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const p of polys) {
      const r = p[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < r.length - 1; i++) { const k = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; a += k; cx += (r[i][0] + r[i + 1][0]) * k; cy += (r[i][1] + r[i + 1][1]) * k; }
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = a ? [cx / (3 * a), cy / (3 * a)] : r[0]; }
    }
  }
  if (!best) throw new Error('centroid: no polygon found');
  return best;
}

/** Is [lng, lat] inside a polygon / multipolygon / place? */
export function inside(pt, g) {
  const ring = (r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if (r[i][1] > pt[1] !== r[j][1] > pt[1] && pt[0] < ((r[j][0] - r[i][0]) * (pt[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
  const poly = (p) => ring(p[0]) && !p.slice(1).some(ring);
  return toFC(g).features.some((f) => (f.geometry.type === 'Polygon' ? poly(f.geometry.coordinates) : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.some(poly) : false));
}

/** Area of polygons in km² (spherical; holes subtracted). */
export function area(g) {
  const ring = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += rad(r[i + 1][0] - r[i][0]) * (2 + Math.sin(rad(r[i][1])) + Math.sin(rad(r[i + 1][1]))); return Math.abs((s * R * R) / 2); };
  const poly = (p) => ring(p[0]) - p.slice(1).reduce((a, h) => a + ring(h), 0);
  return toFC(g).features.reduce((a, f) => a + (f.geometry.type === 'Polygon' ? poly(f.geometry.coordinates) : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.reduce((b, p) => b + poly(p), 0) : 0), 0);
}
