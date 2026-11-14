// Builds examples/data/ukraine.json: the front line every ~10 days since April 2022,
// from DeepStateMap's public history (https://deepstatemap.live). Polygons are simplified
// (~300 m) so the whole war fits in a couple of MB.
// Run: node examples/data/prepare-ukraine.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ukraine.json');
const API = 'https://deepstatemap.live/api/history';
const STEP_DAYS = 10, TOL = 0.004;
const RAW = path.join(process.cwd(), '.bamba-cache', 'deepstate');
fs.mkdirSync(RAW, { recursive: true });
const get = async (url) => {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (map-bamba example data)' }, signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error('failed: ' + url);
};

const OCC = new Set(['#a52714']);
const LIB = new Set(['#0288d1', '#0f9d58', '#01579b']);
const isPre = (p) => /ОРДЛО|Крим|Crimea|CADR|Тузла/i.test(p.name || '');

// Douglas–Peucker on a ring
function simplify(ring, tol) {
  if (ring.length < 6) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol * tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const area = (ring) => { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return Math.abs(s / 2); };
function polys(geom, out = []) {
  if (!geom) return out;
  if (geom.type === 'Polygon') out.push(geom.coordinates);
  else if (geom.type === 'MultiPolygon') out.push(...geom.coordinates);
  else if (geom.type === 'GeometryCollection') geom.geometries.forEach((g) => polys(g, out));
  return out;
}
const clean = (list) => list
  .map((poly) => poly.map((ring) => simplify(ring.map((c) => [+c[0].toFixed(3), +c[1].toFixed(3)]), TOL)).filter((r) => r.length >= 4))
  .filter((poly) => poly.length && area(poly[0]) > 2e-5);

const history = await get(API + '/public');
const picked = [];
let last = -Infinity;
for (const h of history) {
  const t = +new Date(h.createdAt);
  if (t - last >= STEP_DAYS * 864e5) { picked.push(h); last = t; }
}
if (picked[picked.length - 1].id !== history[history.length - 1].id) picked.push(history[history.length - 1]);
console.log(`${history.length} snapshots → ${picked.length} frames`);

// Most polygons never change between snapshots, so frames store indices into a shared pool.
const pool = [], seen = new Map();
const intern = (poly) => { const k = JSON.stringify(poly); if (!seen.has(k)) { seen.set(k, pool.length); pool.push(poly); } return seen.get(k); };
const frames = [];
let pre = null;
for (const [i, h] of picked.entries()) {
  const rawFile = path.join(RAW, h.id + '.json');
  let g;
  if (fs.existsSync(rawFile)) g = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  else { g = await get(`${API}/${h.id}/geojson`); fs.writeFileSync(rawFile, JSON.stringify(g)); await new Promise((r) => setTimeout(r, 250)); }
  const feats = g.features || [];
  const sel = (test) => clean(feats.filter((f) => f.geometry && f.geometry.type !== 'Point' && test(f.properties || {})).flatMap((f) => polys(f.geometry)));
  const occ = sel((p) => OCC.has(String(p.fill || '').toLowerCase()) && !isPre(p));
  const lib = sel((p) => LIB.has(String(p.fill || '').toLowerCase()));
  const p0 = sel(isPre);
  if (p0.length && (!pre || i === picked.length - 1)) pre = p0;
  frames.push({ d: h.createdAt.slice(0, 10), occ: occ.map(intern), lib: lib.map(intern) });
  if (i % 10 === 0) console.log(i, h.createdAt.slice(0, 10), 'occ', occ.length, 'lib', lib.length);
}
const out = { source: 'DeepStateMap (deepstatemap.live), simplified', generated: new Date().toISOString().slice(0, 10), pre2022: pre, pool, frames };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1e6).toFixed(2), 'MB');
