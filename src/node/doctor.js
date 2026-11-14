// `bamba doctor` — verifies everything a render needs.
import { spawnSync } from 'node:child_process';
import { launchBrowser, pickEncoder } from './render.js';

export async function doctor() {
  const ok = (b, msg, hint) => { console.log(`${b ? '  ok  ' : ' FAIL '} ${msg}${!b && hint ? `\n        → ${hint}` : ''}`); return b; };
  let all = true;
  all &= ok(+process.versions.node.split('.')[0] >= 20, `Node ${process.versions.node}`, 'Node 20+ is required');

  const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  all &= ok(!ff.error && ff.status === 0, ff.error ? 'ffmpeg' : (ff.stdout || '').split('\n')[0].slice(0, 60), 'install ffmpeg and put it on PATH (winget install ffmpeg / brew install ffmpeg / apt install ffmpeg)');
  if (!ff.error) {
    try { const e = pickEncoder(); ok(true, `encoder: ${e.name}${e.gpu ? ' (GPU)' : ' (CPU — works, just slower)'}`); } catch (e) { all &= ok(false, 'encoder', e.message); }
  }

  let browser;
  try {
    browser = await launchBrowser();
    ok(true, `browser: ${browser.browserType().name()} ${browser.version()}`);
    const page = await browser.newPage();
    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl2';
    });
    all &= ok(!!gpu, `WebGL2: ${gpu || 'unavailable'}`, 'WebGL2 is required');
    if (gpu && /swiftshader|llvmpipe|software|basic render/i.test(gpu)) ok(false, 'GPU acceleration', 'WebGL is on a software renderer; renders work but are several times slower. Update GPU drivers.');
  } catch (e) {
    all &= ok(false, 'browser', 'install Google Chrome, or run: npx playwright-core install chromium');
  } finally { await browser?.close().catch(() => {}); }

  for (const [name, url] of [['tiles (OpenFreeMap)', 'https://tiles.openfreemap.org/planet'], ['routing (OSRM)', 'https://router.project-osrm.org/route/v1/driving/0,0;0.1,0.1?overview=false'], ['geocoding (Nominatim)', 'https://nominatim.openstreetmap.org/status']]) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'map-bamba/0.1 (doctor)' }, signal: AbortSignal.timeout(15000) }); ok(r.status < 500, `network: ${name}`, 'HTTP ' + r.status); } catch (e) { ok(false, `network: ${name}`, 'unreachable — cached scenes still render with --offline'); }
  }
  console.log(all ? '\nReady. Try: node bin/bamba.js sheet examples/02-recife-rota.js' : '\nFix the FAIL lines above, then run doctor again.');
}
