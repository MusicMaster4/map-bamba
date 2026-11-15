// Dev tool: time the renderer of two checkouts on the same scenes, alternating.
// Other programs on the GPU (a 3D app, a game) dominate render time, so every run is watched:
// if anything else used the GPU while it ran, the run is thrown away and repeated later.
// node scripts/bench.js <other-checkout-dir> [scene filter]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const other = process.argv[2];
const filter = process.argv[3] || '';
const here = process.cwd();
const scenes = fs.readdirSync('examples').filter((f) => /^\d\d-.*\.js$/.test(f) && f.includes(filter)).sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** GPU load (%) from processes that are not ours (nvidia-smi pmon; 0 when unavailable). */
function foreignLoad() {
  const r = spawnSync('nvidia-smi', ['pmon', '-c', '1'], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  let sum = 0;
  for (const line of r.stdout.split('\n')) {
    const c = line.trim().split(/\s+/);
    if (c.length < 9 || c[0] === '#') continue;
    const sm = parseInt(c[3], 10), name = c.slice(9).join(' ').toLowerCase();
    if (isFinite(sm) && !/chrome|ffmpeg|node/.test(name)) sum += sm;
  }
  return sum;
}
async function waitIdle() {
  for (let i = 0, calm = 0; i < 150; i++) { if (foreignLoad() < 4) { if (++calm >= 4) return true; } else calm = 0; await sleep(1500); }
  return false;
}
async function once(dir, scene) {
  const out = dir === here ? path.join(here, 'out', scene.replace(/\.js$/, '.mp4')) : path.join(here, 'out', '_bench.mp4');
  const p = spawn('node', [path.join(dir, 'bin', 'bamba.js'), 'render', path.join('examples', scene), '-o', out], { cwd: dir });
  let text = '', samples = 0, load = 0;
  p.stdout.on('data', (d) => (text += d));
  p.stderr.on('data', (d) => (text += d));
  const timer = setInterval(() => { samples++; load += foreignLoad(); }, 2500);
  const code = await new Promise((r) => p.on('close', r));
  clearInterval(timer);
  const m = /in ([\d.]+)s/.exec(text);
  return { sec: code === 0 && m ? +m[1] : NaN, foreign: samples ? load / samples : 0, err: code === 0 ? null : text.slice(-200) };
}
/** Best clean run out of up to 4 attempts (clean = other programs averaged under 5 % of the GPU). */
async function run(dir, scene) {
  let best = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await waitIdle();
    const r = await once(dir, scene);
    if (r.err) return r;
    r.clean = r.foreign < 5;
    if (!best || (r.clean && !best.clean) || (r.clean === best.clean && r.sec < best.sec)) best = r;
    if (r.clean) break;
  }
  return best;
}
const rows = [];
for (const scene of scenes) {
  const a = await run(other, scene), b = await run(here, scene);
  rows.push({ scene, old: a.sec, new: b.sec, clean: a.clean && b.clean });
  console.log(`${scene.padEnd(26)} old ${String(a.sec).padStart(6)}s   new ${String(b.sec).padStart(6)}s   ×${(a.sec / b.sec).toFixed(2)}${a.clean && b.clean ? '' : `   (GPU shared: other apps ${Math.round(a.foreign)}% / ${Math.round(b.foreign)}%)`}${a.err || b.err ? '  ERR ' + (a.err || b.err) : ''}`);
}
const ok = rows.filter((r) => r.clean), sum = (list, k) => list.reduce((s, r) => s + r[k], 0);
console.log(`${`total (${ok.length} clean)`.padEnd(26)} old ${sum(ok, 'old').toFixed(1).padStart(6)}s   new ${sum(ok, 'new').toFixed(1).padStart(6)}s   ×${(sum(ok, 'old') / sum(ok, 'new')).toFixed(2)}`);
fs.rmSync(path.join(here, 'out', '_bench.mp4'), { force: true });
