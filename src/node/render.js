// Renderer: drives the scene page frame by frame in GPU-accelerated headless Chrome and pipes
// frames to ffmpeg (NVENC when available).
//
// Speed comes from three things:
//  · frames are a pure function of time, so the timeline is rendered by several browser processes
//    at once (idle workers steal the back half of the busiest worker's range);
//  · in Chrome with HTML-in-canvas the finished frame is one canvas, read back as raw RGBA and
//    streamed straight into ffmpeg — no screenshot, no PNG encode/decode;
//  · the page draws the map exactly once per frame.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startServer } from './server.js';

export const GPU_ARGS = [
  '--ignore-gpu-blocklist', '--enable-gpu', '--enable-gpu-rasterization', '--enable-zero-copy', '--use-angle=d3d11',
  '--enable-webgl', '--enable-accelerated-2d-canvas', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio',
  '--font-render-hinting=none', '--disable-lcd-text', '--enable-unsafe-swiftshader',
];
if (process.platform !== 'win32') GPU_ARGS.splice(GPU_ARGS.indexOf('--use-angle=d3d11'), 1, process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=gl');
const FAST_ARGS = (process.env.BAMBA_CHROME_ARGS ?? '').split(' ').filter(Boolean); // extra Chrome flags for experiments

export async function launchBrowser({ headed = false } = {}) {
  const tries = [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
  let lastErr;
  for (const t of tries) {
    try { return await chromium.launch({ ...t, headless: !headed, args: [...GPU_ARGS, ...FAST_ARGS] }); } catch (e) { lastErr = e; }
  }
  throw new Error('Could not launch Chrome/Edge/Chromium. Install Google Chrome or run `npx playwright-core install chromium`.\n' + lastErr);
}

/**
 * How many browser processes to render with. Each one holds a WebGL context plus an encoder session
 * (roughly 0.8 GB of video memory at 1080p), so the count follows the VRAM that is actually free:
 * running out of it is far slower than using fewer workers.
 */
export function autoWorkers() {
  const cpu = Math.max(2, Math.min(6, os.cpus().length >> 2));
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 4000 });
    const free = parseInt(String(r.stdout).trim().split('\n')[0], 10);
    if (free > 0) return Math.max(1, Math.min(cpu, Math.floor((free - 400) / 800)));
  } catch {}
  return Math.min(4, cpu);
}

let _enc;
/** Pick the best available H.264 encoder: NVENC → QuickSync → AMF → VideoToolbox → libx264. */
export function pickEncoder(prefer, q) {
  if (_enc && !prefer && q == null) return _enc;
  const Q = (base) => String(q ?? base);
  const candidates = {
    h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', Q(23), '-b:v', '0', '-maxrate', '20M', '-bufsize', '40M', '-profile:v', 'high', '-bf', '2', '-spatial-aq', '1', '-temporal-aq', '1', '-aq-strength', '10'],
    h264_qsv: ['-c:v', 'h264_qsv', '-global_quality', Q(20), '-preset', 'veryslow'],
    h264_amf: ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '17', '-qp_p', '19', '-qp_b', '21'],
    h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-q:v', '70'],
    libx264: ['-c:v', 'libx264', '-preset', 'slow', '-crf', Q(18)],
  };
  const order = prefer ? [prefer] : Object.keys(candidates);
  for (const name of order) {
    if (!candidates[name]) throw new Error(`Unknown encoder "${name}". Valid: ${Object.keys(candidates).join(', ')}`);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:r=30:d=0.2', ...candidates[name], '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { encoding: 'utf8' });
    if (r.error) throw new Error('ffmpeg not found on PATH. Install ffmpeg (https://ffmpeg.org) and try again.');
    if (r.status === 0) { const e = { name, args: candidates[name], gpu: name !== 'libx264' }; if (!prefer && q == null) _enc = e; return e; }
  }
  throw new Error('No working H.264 encoder found in ffmpeg.');
}

export async function openScene(browser, origin, sceneRel, { scale = 1, fps, player = false, onLog, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.startsWith('[bamba]')) onLog?.(m.type(), t); });
  page.on('pageerror', (e) => { if (!/Scene failed|__bamba/.test(String(e))) onLog?.('error', String(e.message || e)); });
  const url = `${origin}/?scene=${encodeURIComponent('/work/' + sceneRel.replace(/\\/g, '/'))}${fps ? '&fps=' + fps : ''}${player ? '&player=1' : ''}${query}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__bamba && (window.__bamba.ready || window.__bamba.error), null, { timeout: 180000 });
  const info = await page.evaluate(() => ({ ...window.__bamba, seek: undefined, settle: undefined, frame: undefined }));
  if (info.error) throw new Error('scene failed to build — ' + info.error);
  if (info.width !== 1920 || info.height !== 1080) await page.setViewportSize({ width: info.width, height: info.height });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, info };
}

async function grab(s, t, format = 'png', settle = false) {
  await s.page.evaluate(([t, settle]) => (settle ? window.__bamba.settle(t) : window.__bamba.seek(t)), [t, settle]);
  const { data } = await s.cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? 95 : undefined, optimizeForSpeed: true, captureBeyondViewport: false });
  return Buffer.from(data, 'base64');
}

function sceneRelPath(sceneFile, workDir) {
  const abs = path.resolve(workDir, sceneFile);
  if (!fs.existsSync(abs)) throw new Error(`Scene file not found: ${abs}`);
  const rel = path.relative(workDir, abs);
  if (rel.startsWith('..')) throw new Error(`Scene must be inside the working directory (${workDir})`);
  return { abs, rel };
}
const logger = (opts, warnings) => (type, text) => { if (!warnings.has(text)) { warnings.add(text); (opts.log || (() => {}))(`  ${type === 'error' ? 'ERROR' : 'warn'}: ${text.replace(/^\[bamba\] /, '')}`); } };

/** Render a scene to mp4. Returns { out, frames, seconds, fps, encoder, gpu, warnings, workers, capture, timing }. */
export async function render(sceneFile, opts = {}) {
  const workDir = opts.cwd || process.cwd();
  const { abs, rel } = sceneRelPath(sceneFile, workDir);
  const out = path.resolve(workDir, opts.out || path.join('out', path.basename(abs).replace(/\.[^.]+$/, '') + '.mp4'));
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const log = opts.log || (() => {});
  const warnings = new Set();
  const onLog = logger(opts, warnings);
  const started = Date.now();
  const server = await startServer({ workDir, offline: opts.offline });
  const browsers = [];
  const scale = opts.scale || 1;
  const blur = Math.max(1, Math.round(opts.blur || 1));
  if (opts.draft) opts = { ...opts, scale: opts.scale || 0.5 }; // quick look: half size, fastest encoder preset
  const want = Math.max(1, opts.workers || autoWorkers());
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bamba-'));
  try {
    // every worker is its own browser process
    let enc = pickEncoder(opts.encoder, opts.crf);
    if (opts.draft && enc.name === 'h264_nvenc') enc = { ...enc, args: enc.args.map((a) => (a === 'p7' ? 'p4' : a)) };
    const query = '&lazy=1' + (opts.screenshots ? '&nocomp=1' : '') + (opts.rgba ? '&rgba=1' : '');
    const open = async () => { const b = await launchBrowser(); browsers.push(b); return openScene(b, server.origin, rel, { scale, fps: opts.fps, onLog, query }); };
    const first = await open(); // one first: a broken scene should fail once, not once per worker
    const { duration, fps, width, height, gpu, fast, pixfmt } = first.info;
    const from = Math.max(0, Math.round((opts.from ?? 0) * fps));
    const to = Math.min(Math.round(duration * fps), Math.round((opts.to ?? duration) * fps));
    const total = to - from;
    if (total <= 0) throw new Error('Nothing to render (check --from/--to)');
    const workers = Math.max(1, Math.min(want, Math.ceil(total / 24)));
    const sessions = [first, ...(await Promise.all(Array.from({ length: workers - 1 }, open)))];
    const booted = Date.now();
    const W = Math.round(width * scale), H = Math.round(height * scale);
    log(`  ${W}×${H} @ ${fps}fps · ${total} frames · ${workers} worker${workers > 1 ? 's' : ''} · ${enc.name} · ${fast ? 'direct capture' : 'screenshot capture'}${blur > 1 ? ` · motion blur ×${blur}` : ''} · ${gpu}`);
    if (/swiftshader|llvmpipe|software/i.test(gpu)) log('  warn: WebGL is running on a SOFTWARE renderer — rendering will be slow. Check GPU drivers / Chrome flags.');
    if (blur > 1 && !fast) log('  warn: motion blur needs direct capture (Chrome with HTML-in-canvas); rendering without it.');

    // contiguous ranges, one per worker; a worker that runs out steals half of the largest remainder
    const ranges = Array.from({ length: workers }, (_, i) => { const a = from + Math.round((total * i) / workers); return { a, next: a, b: from + Math.round((total * (i + 1)) / workers) }; });
    const steal = () => {
      let best = null;
      for (const r of ranges) if (r.b - r.next >= 16 && (!best || r.b - r.next > best.b - best.next)) best = r;
      if (!best) return null;
      const mid = best.next + Math.ceil((best.b - best.next) / 2);
      const nr = { a: mid, next: mid, b: best.b };
      best.b = mid;
      ranges.push(nr);
      return nr;
    };
    let done = 0;
    const segs = [];
    const filter = 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p';
    const renderRange = async (s, r, w) => {
      if (r.next >= r.b) return;
      const file = path.join(tmp, `seg${String(r.a).padStart(7, '0')}.mp4`);
      // frames arrive already converted to YUV 4:2:0 (BT.709, limited range) when the page can do it on the GPU
      const input = !fast ? ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-vf', filter]
        : pixfmt === 'yuv420p' ? ['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-s', `${W}x${H}`, '-framerate', String(fps), '-i', '-', '-pix_fmt', 'yuv420p']
          : ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(fps), '-i', '-', '-vf', filter];
      const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input, ...enc.args, '-g', String(fps * 2),
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
      let ffErr = '';
      ff.stderr.on('data', (d) => (ffErr += d));
      ff.stdin.on('error', () => {});
      const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed: ' + ffErr)))));
      const id = `${w}-${r.a}`;
      const frameBytes = pixfmt === 'yuv420p' ? (W * H * 3) / 2 : W * H * 4;
      server.sinks.set(id, async (req) => {
        const chunks = [];
        let n = 0;
        for await (const chunk of req) { chunks.push(chunk); n += chunk.length; }
        if (n !== frameBytes) return false; // truncated upload: refuse it, the page sends the frame again
        for (const chunk of chunks) if (!ff.stdin.write(chunk)) await once(ff.stdin, 'drain');
        return true;
      });
      const url = `/__frame?id=${id}`;
      segs.push({ a: r.a, file });
      try {
        while (r.next < r.b) {
          const f = r.next++;
          if (fast) await s.page.evaluate(([t, settle, url, blur, dt]) => window.__bamba.frame(t, settle, url, blur, dt), [f / fps, f === r.a, url, blur, 1 / fps]);
          else { const png = await grab(s, f / fps, 'png', f === r.a); if (!ff.stdin.write(png)) await once(ff.stdin, 'drain'); }
          done++;
          opts.onProgress?.(done, total);
        }
      } finally { server.sinks.delete(id); ff.stdin.end(); }
      await closed;
    };
    const pageStats = [];
    await Promise.all(sessions.map(async (s, w) => {
      const t0 = Date.now();
      for (let r = ranges[w]; r; r = steal()) await renderRange(s, r, w);
      if (opts.stats) pageStats.push({ w, wall: Date.now() - t0, ...(await s.page.evaluate(() => window.__scene.stats).catch(() => ({}))) });
      await s.ctx.close().catch(() => {});
    }));
    if (opts.stats) for (const p of pageStats) { const n = p.frames || 1, r = (k) => ((p[k] || 0) / n).toFixed(1); log(`  worker ${p.w}: ${n} frames, ${(p.wall / n).toFixed(1)} ms/frame wall — update ${r('update')} draw ${r('draw')} wait ${r('wait')} dom ${r('dom')} compose ${r('compose')} pixels ${r('pixels')} post ${r('post')} (redraws/frame ${(p.redraws / (p.seeks || 1)).toFixed(2)})`); }
    const rendered = Date.now();

    segs.sort((x, y) => x.a - y.a);
    if (segs.length === 1) await fsp.copyFile(segs[0].file, out);
    else {
      const list = path.join(tmp, 'list.txt');
      await fsp.writeFile(list, segs.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'));
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('ffmpeg concat failed: ' + r.stderr);
    }
    const seconds = (Date.now() - started) / 1000;
    return { out, frames: total, seconds, fps, encoder: enc.name, gpu, workers, capture: fast ? 'direct' : 'screenshot', warnings: [...warnings], cache: server.stats,
      timing: { boot: (booted - started) / 1000, frames: (rendered - booted) / 1000, mux: (Date.now() - rendered) / 1000 } };
  } finally {
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    await server.close();
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Render single frames to PNG. times: seconds[]. Returns file paths. */
export async function stills(sceneFile, times, opts = {}) {
  const workDir = opts.cwd || process.cwd();
  const { abs, rel } = sceneRelPath(sceneFile, workDir);
  const base = path.basename(abs).replace(/\.[^.]+$/, '');
  const outDir = path.resolve(workDir, opts.outDir || 'out');
  await fsp.mkdir(outDir, { recursive: true });
  const warnings = new Set();
  const server = await startServer({ workDir, offline: opts.offline });
  const browser = await launchBrowser();
  try {
    const s = await openScene(browser, server.origin, rel, { scale: opts.scale || 1, onLog: logger(opts, warnings), query: '&lazy=1' + (opts.screenshots ? '&nocomp=1' : '') });
    const files = [];
    for (const t of times) {
      const png = await grab(s, t, 'png', true);
      const f = path.join(outDir, `${base}@${t.toFixed(2)}s${opts.suffix || ''}.png`);
      await fsp.writeFile(f, png);
      files.push(f);
    }
    return { files, info: s.info, warnings: [...warnings] };
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }
}

/** Contact sheet: n evenly spaced frames (or explicit times) in one image, each stamped with its time. */
export async function sheet(sceneFile, opts = {}) {
  const workDir = opts.cwd || process.cwd();
  const { abs, rel } = sceneRelPath(sceneFile, workDir);
  const out = path.resolve(workDir, opts.out || path.join('out', path.basename(abs).replace(/\.[^.]+$/, '') + '.sheet.jpg'));
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.rm(out, { force: true }); // a failed run must not leave the previous sheet behind
  const warnings = new Set();
  const server = await startServer({ workDir, offline: opts.offline });
  const browser = await launchBrowser();
  try {
    const cols = opts.cols || 3;
    const s = await openScene(browser, server.origin, rel, { scale: opts.scale || 0.5, onLog: logger(opts, warnings), query: '&lazy=1' });
    const { duration, width, height } = s.info;
    const n = opts.n || 9;
    // the moments worth seeing (each snapped to where something has just arrived), and a text check of the scene
    const times = opts.times || (await s.page.evaluate((n) => window.__bamba.keyTimes(n), n));
    const { issues } = await s.page.evaluate(() => window.__bamba.audit());
    const shots = [];
    for (const t of times) shots.push((await grab(s, t, 'jpeg', true)).toString('base64'));
    await s.ctx.close();
    const cellW = Math.round((opts.width || 1568) / cols), cellH = Math.round((cellW * height) / width);
    const page = await browser.newPage({ viewport: { width: cellW * cols, height: cellH * Math.ceil(times.length / cols) } });
    await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${cellW}px)">${shots.map((b, i) => `<div style="position:relative;width:${cellW}px;height:${cellH}px"><img src="data:image/jpeg;base64,${b}" style="width:100%;height:100%;display:block"><span style="position:absolute;left:6px;top:6px;background:#000c;color:#fff;font:600 13px ui-monospace,monospace;padding:2px 6px;border-radius:3px">${times[i].toFixed(1)}s</span></div>`).join('')}</body>`);
    await fsp.writeFile(out, await page.screenshot({ type: 'jpeg', quality: 88 }));
    return { out, times, issues, info: s.info, warnings: [...warnings] };
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }
}

/** Text-only check of a scene: { issues: string[], timeline: string[], info }. No frames are rendered. */
export async function check(sceneFile, opts = {}) {
  const workDir = opts.cwd || process.cwd();
  const { rel } = sceneRelPath(sceneFile, workDir);
  const warnings = new Set();
  const server = await startServer({ workDir, offline: opts.offline });
  const browser = await launchBrowser();
  try {
    const s = await openScene(browser, server.origin, rel, { scale: 0.25, onLog: logger(opts, warnings), query: '&lazy=1' });
    const r = await s.page.evaluate(() => window.__bamba.audit());
    return { ...r, info: s.info, warnings: [...warnings] };
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }
}

/** Open the scene in a visible browser with a scrubber. */
export async function preview(sceneFile, opts = {}) {
  const workDir = opts.cwd || process.cwd();
  const { rel } = sceneRelPath(sceneFile, workDir);
  const server = await startServer({ workDir, port: opts.port || 4747 });
  const url = `${server.origin}/?scene=${encodeURIComponent('/work/' + rel.replace(/\\/g, '/'))}&player=1`;
  return { url, server };
}
