#!/usr/bin/env node
// map-bamba CLI
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELP = `map-bamba — code-driven map animations

  bamba sheet   <scene.js> [-n 9] [--times 1,5,12] [--cols 3]   contact sheet (one JPG) — look at this first
  bamba still   <scene.js> -t 4.5[,9,…] [--scale 1]             full-resolution PNG frame(s)
  bamba render  <scene.js> [-o out.mp4] [--scale 2] [--fps 60] [--from s --to s] [--workers n] [--encoder name] [--crf 21]
  bamba preview <scene.js>                                       live scrubber in your browser
  bamba new     <name>                                           scaffold scenes/<name>.js
  bamba doctor                                                   check Chrome / GPU / ffmpeg / network

Outputs go to ./out. Tiles and API responses are cached in ./.bamba-cache (add --offline to forbid network).`;

const args = process.argv.slice(2);
const cmd = args.shift();
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('-')) { const k = a.replace(/^-+/, ''); const v = args[i + 1] !== undefined && !/^-[a-z-]/i.test(args[i + 1]) ? args[++i] : true; flags[k] = v; } else pos.push(a);
}
const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const log = (s) => console.log(s);
const rel = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/');

async function main() {
  if (!cmd || cmd === 'help' || flags.h || flags.help) return log(HELP);
  const common = { log, offline: !!flags.offline };
  if (cmd === 'doctor') return (await import('../src/node/doctor.js')).doctor();
  if (cmd === 'new') {
    const name = pos[0] || 'scene';
    const dest = path.resolve('scenes', name.replace(/\.js$/, '') + '.js');
    if (fs.existsSync(dest)) throw new Error(dest + ' already exists');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'scene.js'), dest);
    return log(`created ${rel(dest)}\nnext: bamba sheet ${rel(dest)}`);
  }
  const R = await import('../src/node/render.js');
  const scene = pos[0];
  if (!scene) throw new Error(`Missing scene file.\n\n${HELP}`);
  if (cmd === 'sheet') {
    const r = await R.sheet(scene, { ...common, n: num(flags.n, 9), cols: num(flags.cols, 3), out: flags.o, times: flags.times ? String(flags.times).split(',').map(Number) : undefined, scale: num(flags.scale, 0.5) });
    return log(`sheet → ${rel(r.out)}   (${r.times.length} frames: ${r.times.map((t) => t + 's').join(' ')})`);
  }
  if (cmd === 'still') {
    const times = String(flags.t ?? flags.times ?? '0').split(',').map(Number);
    const r = await R.stills(scene, times, { ...common, scale: num(flags.scale, 1), outDir: flags.o });
    return log(r.files.map((f) => 'still → ' + rel(f)).join('\n'));
  }
  if (cmd === 'render') {
    log(`rendering ${scene}`);
    let last = 0;
    const r = await R.render(scene, {
      ...common, out: flags.o, scale: num(flags.scale, 1), fps: flags.fps ? num(flags.fps) : undefined, from: flags.from ? num(flags.from) : undefined, to: flags.to ? num(flags.to) : undefined,
      workers: flags.workers ? num(flags.workers) : undefined, encoder: flags.encoder === true ? undefined : flags.encoder, crf: flags.crf ? num(flags.crf) : undefined,
      onProgress: (d, n) => { const p = Math.floor((d / n) * 10); if (p > last) { last = p; process.stdout.write(`  ${p * 10}%`); if (p === 10) process.stdout.write('\n'); } },
    });
    return log(`video → ${rel(r.out)}   ${r.frames} frames in ${r.seconds.toFixed(1)}s (${(r.frames / r.seconds).toFixed(1)} fps) · ${(fs.statSync(r.out).size / 1e6).toFixed(1)} MB`);
  }
  if (cmd === 'preview') {
    const r = await R.preview(scene, { port: flags.port ? num(flags.port) : undefined });
    log(`preview → ${r.url}\n(ctrl+c to stop)`);
    const { spawn } = await import('node:child_process');
    if (!flags['no-open']) spawn(process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', r.url] : [r.url], { detached: true, stdio: 'ignore' }).unref();
    return new Promise(() => {});
  }
  throw new Error(`Unknown command "${cmd}".\n\n${HELP}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('\nerror: ' + (e.message || e)); process.exit(1); });
