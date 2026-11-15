// Page bootstrap: load the scene module, build it, expose window.__bamba for the renderer.
import { Scene } from './scene.js';
import { recipeFor } from '../recipes/index.js';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const errBox = document.getElementById('error');
const fail = (e) => {
  const full = String((e && e.stack) || e);
  // keep the message and the frames inside the user's scene; framework frames are noise
  const lines = full.split('\n');
  const own = lines.filter((l, i) => i > 0 && l.includes('/work/')).map((l) => l.replace(/https?:\/\/[^/]+\/work\//, '').replace(/\?v=\d+/, ''));
  const msg = [String((e && e.message) || lines[0]).replace(/^Error: /, ''), ...own].join('\n');
  window.__bamba = { error: msg };
  errBox.style.display = 'block';
  errBox.textContent = full;
};

async function boot() {
  const src = q.get('scene');
  if (!src) throw new Error('No scene given (?scene=/work/path/to/scene.js)');
  let mod;
  if (/\.json($|\?)/.test(src)) {
    // a brief: { "recipe": "route", … } — a complete video from a few lines of JSON
    const res = await fetch(src + '?v=' + Date.now());
    if (!res.ok) throw new Error(`Cannot read ${src} (${res.status})`);
    let P;
    try { P = JSON.parse(await res.text()); } catch (e) { throw new Error(`${src} is not valid JSON: ${e.message}`); }
    const R = recipeFor(P);
    mod = { default: (s) => R.default(s, P) };
  } else mod = await import(src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now());
  if (typeof mod.default !== 'function') throw new Error(`${src} must "export default async (s) => { … }"`);
  const cfg = { ...(mod.config || {}) };
  const scene = new Scene(cfg, new URL(src, location.href).href);
  await mod.default(scene);
  if (q.get('fps')) scene.configure({ fps: +q.get('fps') });
  await scene.mount(stage);
  if (!q.get('lazy')) await scene.settle(0);
  window.__scene = scene;
  window.__bamba = {
    ready: true, duration: scene.duration, fps: scene.fps, width: scene.width, height: scene.height, bg: scene.theme.bg,
    warnings: scene.warnings,
    seek: (t) => scene.seek(t),
    settle: (t) => scene.settle(t),
    keyTimes: (n) => scene.keyTimes(n),
    audit: () => scene.audit(),
    frame: (t, settle, url, blur, dt) => scene.frame(t, settle, url, blur, dt),
    fast: !!scene.overlay.comp, pixfmt: scene.overlay.yuv ? 'yuv420p' : 'rgba', // true when frames can be read straight from the compositing canvas
    gpu: (() => { try { const gl = scene.map.painter.context.gl; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch { return 'unknown'; } })(),
  };
  if (q.get('player')) player(scene);
}

function player(scene) {
  const bar = document.getElementById('player');
  bar.style.display = 'flex';
  const [btn, range, out] = [bar.querySelector('button'), bar.querySelector('input'), bar.querySelector('output')];
  range.max = scene.duration;
  const fit = () => { const k = Math.min(innerWidth / scene.width, (innerHeight - 50) / scene.height, 1); stage.style.transform = `scale(${k})`; stage.style.transformOrigin = '0 0'; };
  addEventListener('resize', fit); fit();
  let playing = false, t = 0, busy = false, last = 0;
  const show = async (v) => { if (busy) return; busy = true; t = v; range.value = v; out.textContent = v.toFixed(2) + 's'; await scene.seek(v); busy = false; };
  range.oninput = () => { playing = false; btn.textContent = 'Play'; show(+range.value); };
  btn.onclick = () => { playing = !playing; btn.textContent = playing ? 'Pause' : 'Play'; last = performance.now(); if (t >= scene.duration) t = 0; };
  const loop = async (now) => { if (playing && !busy) { const nt = t + (now - last) / 1000; last = now; if (nt >= scene.duration) { playing = false; btn.textContent = 'Play'; } await show(Math.min(nt, scene.duration)); } else last = now; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

addEventListener('unhandledrejection', (e) => fail(e.reason));
boot().catch(fail);
