// Dev helper: open a scene, print boot/seek diagnostics. node scripts/debug.js examples/x.js [t]
import { startServer } from '../src/node/server.js';
import { launchBrowser } from '../src/node/render.js';

const scene = process.argv[2];
const t = Number(process.argv[3] || 0);
const server = await startServer({ workDir: process.cwd() });
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
page.on('console', (m) => console.log('[' + m.type() + ']', m.text().slice(0, 400)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e.stack || e).slice(0, 600)));
page.on('requestfailed', (r) => console.log('[reqfailed]', r.url().slice(0, 200), r.failure()?.errorText));
await page.goto(`${server.origin}/?scene=/work/${scene}`);
const t0 = Date.now();
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const st = await page.evaluate(() => {
    const b = window.__bamba || {}, s = window.__scene;
    const m = s?.map || window.__dbgmap;
    return { ready: !!b.ready, error: b.error?.slice(0, 500), gpu: b.gpu, loaded: m?.loaded?.(), tiles: m?.areTilesLoaded?.(), style: m?.isStyleLoaded?.() };
  });
  console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(st), JSON.stringify(server.stats));
  if (st.ready || st.error) break;
}
const ok = await page.evaluate(() => !!window.__bamba?.ready);
if (ok) {
  const a = Date.now();
  await page.evaluate((t) => window.__bamba.seek(t), t);
  console.log('seek', t, 'took', Date.now() - a, 'ms');
  await page.screenshot({ path: 'out/debug.png' });
  console.log('wrote out/debug.png');
}
await browser.close();
await server.close();
