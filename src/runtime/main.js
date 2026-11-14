// Page bootstrap: load the scene module, build it, expose window.__bamba for the renderer.
import { Scene } from './scene.js';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const errBox = document.getElementById('error');
const fail = (e) => {
  const msg = String((e && e.stack) || e);
  window.__bamba = { error: msg };
  errBox.style.display = 'block';
  errBox.textContent = msg;
  console.error('[bamba] ' + msg);
};

async function boot() {
  const src = q.get('scene');
  if (!src) throw new Error('No scene given (?scene=/work/path/to/scene.js)');
  const mod = await import(src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now());
  if (typeof mod.default !== 'function') throw new Error(`${src} must "export default async (s) => { … }"`);
  const cfg = { ...(mod.config || {}) };
  if (q.get('fps')) cfg.fps = +q.get('fps');
  const scene = new Scene(cfg, new URL(src, location.href).href);
  await mod.default(scene);
  await scene.mount(stage);
  await scene.settle(0);
  window.__scene = scene;
  window.__bamba = {
    ready: true, duration: scene.duration, fps: scene.fps, width: scene.width, height: scene.height, bg: scene.theme.bg,
    warnings: scene.warnings,
    seek: (t) => scene.seek(t),
    settle: (t) => scene.settle(t),
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
