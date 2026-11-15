// Dev tool: where does render time go?
// node scripts/profile.js <scene> [t0] [frames] [--q=<extra page query>] [chrome flags…]
import { chromium } from 'playwright-core';
import { startServer } from '../src/node/server.js';
import { GPU_ARGS } from '../src/node/render.js';

const [scene, t0 = '8', n = '40', ...rest] = process.argv.slice(2);
const q = (rest.find((a) => a.startsWith('--q=')) || '--q=').slice(4);
const extra = rest.filter((a) => !a.startsWith('--q='));
const T0 = +t0, N = +n;
const now = () => performance.now();
const server = await startServer({ workDir: process.cwd() });
let sunk = 0;
server.sinks.set('p', async (req) => { for await (const c of req) sunk += c.length; });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...GPU_ARGS, ...extra] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.text().startsWith('[bamba]')) console.log(m.text()); });
let a = now();
await page.goto(`${server.origin}/?scene=/work/${scene}&lazy=1${q ? '&' + q : ''}`);
await page.waitForFunction(() => window.__bamba && (window.__bamba.ready || window.__bamba.error));
const boot = Math.round(now() - a);
const err = await page.evaluate(() => window.__bamba.error);
if (err) { console.log(err); process.exit(1); }
const res = await page.evaluate(async ([T0, N]) => {
  const s = window.__scene, ov = s.overlay, out = { fast: !!ov.comp };
  await s.settle(T0);
  for (const k of Object.keys(s.stats)) s.stats[k] = 0;
  const time = async (fn) => { const a = performance.now(); await fn(); return performance.now() - a; };
  let seek = 0, compose = 0, pixels = 0, post = 0, mapOnly = 0;
  const origCompose = ov.compose.bind(ov);
  for (let i = 0; i < N; i++) {
    const t = T0 + i / 30;
    ov.compose = async () => {};
    seek += await time(() => s.seek(t));
    ov.compose = origCompose;
    compose += await time(() => ov.compose());
    if (ov.comp) {
      let px; pixels += await time(() => { px = ov.pixels(); });
      post += await time(() => fetch('/__frame?id=p', { method: 'POST', body: new Blob([px]) }));
    }
  }
  const r = (v) => +(v / N).toFixed(1);
  const st = s.stats, per = (k) => +((st[k] || 0) / st.seeks).toFixed(1);
  Object.assign(out, { seek: r(seek), compose: r(compose), pixels: r(pixels), post: r(post), redraws: +(st.redraws / st.seeks).toFixed(2), inSeek: { update: per('update'), draw: per('draw'), wait: per('wait'), dom: per('dom') } });
  return out;
}, [T0, N]);
console.log(JSON.stringify({ boot, ...res, sunkMB: Math.round(sunk / 1e6) }));
await browser.close();
await server.close();
