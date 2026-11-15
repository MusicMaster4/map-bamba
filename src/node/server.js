// Local server: serves the runtime + the user's working directory, and a disk-cached
// HTTP proxy so tiles / geocoding / routing are fetched once and every later render is
// offline, fast and reproducible.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UA = 'map-bamba/0.1 (map animation renderer)';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.pbf': 'application/x-protobuf', '.map': 'application/json',
  '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip',
};

// Polite per-host pacing (ms between requests) for the free public APIs.
const PACE = { 'nominatim.openstreetmap.org': 1100, 'overpass-api.de': 1500, 'router.project-osrm.org': 400 };
const lastHit = new Map();
const chains = new Map();
function paced(host, fn) {
  const gap = PACE[host];
  if (!gap) return fn();
  const prev = chains.get(host) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const wait = (lastHit.get(host) || 0) + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { lastHit.set(host, Date.now()); }
  });
  chains.set(host, next);
  return next;
}

export async function startServer({ workDir = process.cwd(), cacheDir, port = 0, offline = false, quiet = true } = {}) {
  cacheDir = cacheDir || path.join(workDir, '.bamba-cache');
  const httpDir = path.join(cacheDir, 'http');
  await fsp.mkdir(httpDir, { recursive: true });
  const maplibreDir = path.dirname(require.resolve('maplibre-gl/package.json'));
  const stats = { hit: 0, miss: 0, fail: 0 };
  const sinks = new Map(); // id → async (req) => void: where a worker's raw frames go (its ffmpeg)
  const inflight = new Map();

  async function cachedFetch(url, method, body) {
    const key = crypto.createHash('sha1').update(method + ' ' + url + (body ? '\n' + body : '')).digest('hex');
    const dir = path.join(httpDir, key.slice(0, 2));
    const fBody = path.join(dir, key);
    const fMeta = fBody + '.json';
    try {
      const meta = JSON.parse(await fsp.readFile(fMeta, 'utf8'));
      stats.hit++;
      return { meta, body: await fsp.readFile(fBody) };
    } catch {}
    if (offline) { stats.fail++; return { meta: { status: 504, type: 'text/plain' }, body: Buffer.from('offline: not in cache') }; }
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const host = new URL(url).host;
      let lastErr;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await paced(host, () => fetch(url, {
            method, body: body || undefined,
            headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
            signal: AbortSignal.timeout(90000),
          }));
          if (res.status === 429 || res.status >= 500) { lastErr = new Error('HTTP ' + res.status); await new Promise((r) => setTimeout(r, 1200 * (attempt + 1) ** 2)); continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          const meta = { status: res.status, type: res.headers.get('content-type') || 'application/octet-stream', url };
          // Cache successes and definitive "no such tile" answers; never cache transient errors.
          if (res.ok || res.status === 404 || res.status === 204) {
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(fBody, buf);
            await fsp.writeFile(fMeta, JSON.stringify(meta));
          }
          stats.miss++;
          return { meta, body: buf };
        } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
      }
      stats.fail++;
      if (!quiet) console.error('[bamba] fetch failed', url, String(lastErr));
      return { meta: { status: 502, type: 'text/plain' }, body: Buffer.from(String(lastErr)) };
    })();
    inflight.set(key, job);
    try { return await job; } finally { inflight.delete(key); }
  }

  function sendFile(res, file) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('not found: ' + file); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(file).pipe(res);
    });
  }
  const within = (root, rel) => {
    const f = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    return f.startsWith(path.resolve(root)) ? f : null;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const p = decodeURIComponent(u.pathname);
      if (p === '/__frame') {
        const sink = sinks.get(u.searchParams.get('id'));
        if (!sink) { res.writeHead(410); res.end('no such frame sink'); return; }
        const ok = await sink(req);
        res.writeHead(ok === false ? 422 : 204); res.end();
        return;
      }
      if (p === '/__fetch') {
        const target = u.searchParams.get('url');
        let body = null;
        if (req.method === 'POST') { const chunks = []; for await (const c of req) chunks.push(c); body = Buffer.concat(chunks).toString('utf8'); }
        const out = await cachedFetch(target, req.method === 'POST' ? 'POST' : 'GET', body);
        res.writeHead(out.meta.status === 204 ? 204 : out.meta.status, { 'Content-Type': out.meta.type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
        res.end(out.meta.status === 204 ? undefined : out.body);
        return;
      }
      if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (p === '/' || p === '/index.html') return sendFile(res, path.join(PKG_ROOT, 'src/runtime/page.html'));
      if (p.startsWith('/bamba/vendor/maplibre/')) { const f = within(path.join(maplibreDir, 'dist'), p.slice('/bamba/vendor/maplibre/'.length)); return f ? sendFile(res, f) : (res.writeHead(403), res.end()); }
      if (p.startsWith('/bamba/assets/glyphs/')) {
        // Map label fonts: our own SDF glyphs for Latin; anything else falls back to Noto Sans.
        const f = within(PKG_ROOT, p.slice('/bamba/'.length));
        if (f && fs.existsSync(f)) return sendFile(res, f);
        const [stack, range] = p.slice('/bamba/assets/glyphs/'.length).split('/');
        const noto = /Italic/.test(stack) ? 'Noto Sans Italic' : /Medium|Condensed|Bold/.test(stack) ? 'Noto Sans Bold' : 'Noto Sans Regular';
        const out = await cachedFetch(`https://tiles.openfreemap.org/fonts/${encodeURIComponent(noto)}/${range}`, 'GET');
        res.writeHead(out.meta.status, { 'Content-Type': 'application/x-protobuf', 'Cache-Control': 'no-store' });
        res.end(out.body);
        return;
      }
      if (p.startsWith('/bamba/')) { const f = within(PKG_ROOT, p.slice('/bamba/'.length)); return f ? sendFile(res, f) : (res.writeHead(403), res.end()); }
      if (p.startsWith('/work/')) { const f = within(workDir, p.slice('/work/'.length)); return f ? sendFile(res, f) : (res.writeHead(403), res.end()); }
      res.writeHead(404); res.end('not found');
    } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
  });
  server.keepAliveTimeout = 120000; // pages hold one connection for the whole render
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actualPort = server.address().port;
  return { port: actualPort, origin: `http://127.0.0.1:${actualPort}`, stats, sinks, cacheDir, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
