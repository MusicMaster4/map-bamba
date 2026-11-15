#!/usr/bin/env node
// map-bamba CLI
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `map-bamba — map animations from a few lines

  A scene is a brief (.json, uses a recipe) or a scene file (.js, full API).

  bamba recipes                          list the recipes (one-brief videos)
  bamba brief  <recipe> [name]           show a recipe's keys + example; with a name, write scenes/<name>.json
  bamba check  <scene>                   text report: problems found + timeline (no image to read)
  bamba sheet  <scene> [-n 9] [--times 1,5,12]   contact sheet JPG of the key moments (+ the same problem list)
  bamba still  <scene> -t 4.5[,9]        full-resolution PNG frame(s)
  bamba render <scene> [-o out.mp4] [--scale 2] [--fps 60] [--from s --to s] [--blur 8] [--crf 23] [--draft]
  bamba eject  <brief.json> [out.js]     turn a brief into an editable scene file
  bamba new    <name>                    blank scene file from the template
  bamba help   [topic]                   API reference by topic: camera line area points pins text data config ease design
  bamba preview <scene>                  live scrubber in your browser
  bamba doctor                           check Chrome / GPU / ffmpeg / network

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
const printIssues = (issues) => { if (!issues) return; log(issues.length ? `check: ${issues.length} thing${issues.length > 1 ? 's' : ''} to look at\n${issues.slice(0, 12).map((i) => '  ' + i).join('\n')}` : 'check: no problems found'); };

async function main() {
  if (!cmd || flags.h || (cmd === 'help' && !pos.length)) return log(HELP);
  const common = { log, offline: !!flags.offline };
  if (cmd === 'doctor') return (await import('../src/node/doctor.js')).doctor();
  if (cmd === 'help') {
    // print the API section(s) whose heading mentions the topic
    const topic = pos.join(' ').toLowerCase();
    const sections = fs.readFileSync(path.join(ROOT, 'docs', 'API.md'), 'utf8').split(/\n(?=## )/);
    const hit = sections.filter((sec) => sec.split('\n')[0].toLowerCase().includes(topic));
    if (!hit.length) throw new Error(`No API section about "${topic}". Topics: ${sections.slice(1).map((sec) => sec.split('\n')[0].replace(/^## /, '')).join(' · ')}`);
    return log(hit.join('\n').trim());
  }
  if (cmd === 'recipes' || cmd === 'brief' || cmd === 'eject') {
    const { RECIPES, COMMON, recipeFor } = await import('../src/recipes/index.js');
    if (cmd === 'recipes') {
      log(Object.entries(RECIPES).map(([k, r]) => `  ${k.padEnd(10)} ${r.about}`).join('\n'));
      return log('\nnext: bamba brief <recipe>   (keys + a ready example)');
    }
    if (cmd === 'brief') {
      const R = RECIPES[pos[0]];
      if (!R) throw new Error(`Unknown recipe "${pos[0] ?? ''}". Valid: ${Object.keys(RECIPES).join(', ')}`);
      const text = JSON.stringify(R.example, null, 2);
      if (pos[1]) {
        const dest = path.resolve('scenes', pos[1].replace(/\.json$/, '') + '.json');
        if (fs.existsSync(dest)) throw new Error(dest + ' already exists');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, text + '\n');
        log(`created ${rel(dest)} — edit it, then: bamba check ${rel(dest)}\n`);
      }
      log(`${pos[0]} — ${R.about}\n`);
      log(Object.entries(R.params).map(([k, v]) => `  ${k.padEnd(10)} ${v}`).join('\n'));
      log('  — every brief also takes —');
      log(Object.entries(COMMON).filter(([k]) => k !== 'recipe').map(([k, v]) => `  ${k.padEnd(10)} ${v}`).join('\n'));
      return pos[1] ? undefined : log(`\nexample (save as scenes/<name>.json):\n${text}`);
    }
    // eject: the recipe's own source with this brief baked in
    const src = pos[0];
    if (!src) throw new Error('usage: bamba eject <brief.json> [out.js]');
    const P = JSON.parse(fs.readFileSync(src, 'utf8'));
    recipeFor(P);
    const code = fs.readFileSync(path.join(ROOT, 'src', 'recipes', P.recipe + '.js'), 'utf8');
    const body = code.slice(code.indexOf('export default'));
    const { recipe, ...rest } = P;
    const out = path.resolve(pos[1] || src.replace(/\.json$/, '.js'));
    if (fs.existsSync(out)) throw new Error(out + ' already exists');
    fs.writeFileSync(out, `// Ejected from the "${recipe}" recipe: an ordinary scene file now — edit freely (API: bamba help <topic>).\nconst P = ${JSON.stringify(rest, null, 2)};\n\n${body.replace('export default async (s, P) =>', 'export default async (s) =>')}`);
    return log(`created ${rel(out)} — next: bamba check ${rel(out)}`);
  }
  if (cmd === 'new') {
    const name = pos[0] || 'scene';
    const dest = path.resolve('scenes', name.replace(/\.js$/, '') + '.js');
    if (fs.existsSync(dest)) throw new Error(dest + ' already exists');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'templates', 'scene.js'), dest);
    return log(`created ${rel(dest)}\nnext: bamba check ${rel(dest)}`);
  }
  const R = await import('../src/node/render.js');
  const scene = pos[0];
  if (!scene) throw new Error(`Missing scene file.\n\n${HELP}`);
  if (cmd === 'check') {
    const r = await R.check(scene, common);
    printIssues(r.issues);
    if (r.places?.length) log(`places looked up:\n${r.places.map((l) => '  ' + l).join('\n')}`);
    return log(`timeline (${r.info.duration}s, ${r.info.width}×${r.info.height}):\n${r.timeline.map((l) => '  ' + l).join('\n')}`);
  }
  if (cmd === 'sheet') {
    const r = await R.sheet(scene, { ...common, n: num(flags.n, 9), cols: num(flags.cols, 3), out: flags.o, times: flags.times ? String(flags.times).split(',').map(Number) : undefined, scale: num(flags.scale, 0.5), width: flags.width ? num(flags.width) : undefined });
    log(`sheet → ${rel(r.out)}   (${r.times.length} frames: ${r.times.map((t) => t + 's').join(' ')})`);
    return printIssues(r.issues);
  }
  if (cmd === 'still') {
    const times = String(flags.t ?? flags.times ?? '0').split(',').map(Number);
    const r = await R.stills(scene, times, { ...common, scale: num(flags.scale, 1), outDir: flags.o, screenshots: !!flags.screenshots });
    return log(r.files.map((f) => 'still → ' + rel(f)).join('\n'));
  }
  if (cmd === 'render') {
    log(`rendering ${scene}`);
    let last = 0;
    const r = await R.render(scene, {
      ...common, out: flags.o, scale: num(flags.scale, 1), fps: flags.fps ? num(flags.fps) : undefined, from: flags.from ? num(flags.from) : undefined, to: flags.to ? num(flags.to) : undefined,
      workers: flags.workers ? num(flags.workers) : undefined, encoder: flags.encoder === true ? undefined : flags.encoder, crf: flags.crf ? num(flags.crf) : undefined,
      blur: flags.blur ? num(flags.blur, 8) : undefined, screenshots: !!flags.screenshots, rgba: !!flags.rgba, stats: !!flags.stats, draft: !!flags.draft,
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
