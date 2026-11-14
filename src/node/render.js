// Renderer: drives the scene page frame by frame in GPU-accelerated headless Chrome and pipes
// frames to ffmpeg (NVENC when available). Frames are a pure function of time, so the timeline
// is split into contiguous segments rendered by parallel browser pages.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startServer } from './server.js';

const GPU_ARGS = [
  '--ignore-gpu-blocklist', '--enable-gpu', '--enable-gpu-rasterization', '--enable-zero-copy', '--use-angle=d3d11',
  '--enable-webgl', '--enable-accelerated-2d-canvas', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio',
  '--font-render-hinting=none', '--disable-lcd-text', '--enable-unsafe-swiftshader',
];
if (process.platform !== 'win32') GPU_ARGS.splice(GPU_ARGS.indexOf('--use-angle=d3d11'), 1, process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=gl');

export async function launchBrowser({ headed = false } = {}) {
  const tries = [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
  let lastErr;
  for (const t of tries) {
    try { return await chromium.launch({ ...t, headless: !headed, args: GPU_ARGS }); } catch (e) { lastErr = e; }
  }
  throw new Error('Could not launch Chrome/Edge/Chromium. Install Google Chrome or run `npx playwright-core install chromium`.\n' + lastErr);
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

async function openScene(browser, origin, sceneRel, { scale = 1, fps, player = false, onLog }) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.startsWith('[bamba]')) onLog?.(m.type(), t); });
  page.on('pageerror', (e) => { if (!/Scene failed|__bamba/.test(String(e))) onLog?.('error', String(e.message || e)); });
  const url = `${origin}/?scene=${encodeURIComponent('/work/' + sceneRel.replace(/\\/g, '/'))}${fps ? '&fps=' + fps : ''}${player ? '&player=1' : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__bamba && (window.__bamba.ready || window.__bamba.error), null, { timeout: 180000 });
  const info = await page.evaluate(() => ({ ...window.__bamba, seek: undefined }));
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

/** Render a scene to mp4. Returns { out, frames, seconds, fps, encoder, gpu, warnings }. */
export async function render(sceneFile, opts = {}) {
  const workDir = opts.cwd || process.cwd();
  const { abs, rel } = sceneRelPath(sceneFile, workDir);
  const out = path.resolve(workDir, opts.out || path.join('out', path.basename(abs).replace(/\.[^.]+$/, '') + '.mp4'));
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const log = opts.log || (() => {});
  const warnings = new Set();
  const onLog = (type, text) => { if (!warnings.has(text)) { warnings.add(text); log(`  ${type === 'error' ? 'ERROR' : 'warn'}: ${text.replace(/^\[bamba\] /, '')}`); } };
  const server = await startServer({ workDir, offline: opts.offline });
  const browser = await launchBrowser();
  const browsers = [browser];
  const started = Date.now();
  try {
    const scale = opts.scale || 1;
    const first = await openScene(browser, server.origin, rel, { scale, fps: opts.fps, onLog });
    const { duration, fps, width, height, gpu } = first.info;
    const from = Math.max(0, Math.round((opts.from ?? 0) * fps));
    const to = Math.min(Math.round(duration * fps), Math.round((opts.to ?? duration) * fps));
    const total = to - from;
    if (total <= 0) throw new Error('Nothing to render (check --from/--to)');
    const enc = pickEncoder(opts.encoder, opts.crf);
    const workers = Math.max(1, Math.min(opts.workers || Math.min(4, Math.max(1, os.cpus().length >> 2)), Math.ceil(total / (fps * 2))));
    log(`  ${width * scale}×${height * scale} @ ${fps}fps · ${total} frames · ${workers} worker${workers > 1 ? 's' : ''} · ${enc.name} · ${gpu}`);
    if (/swiftshader|llvmpipe|software/i.test(gpu)) log('  warn: WebGL is running on a SOFTWARE renderer — rendering will be slow. Check GPU drivers / Chrome flags.');

    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bamba-'));
    const bounds = Array.from({ length: workers + 1 }, (_, i) => from + Math.round((total * i) / workers));
    let done = 0;
    const tick = () => { done++; if (opts.onProgress) opts.onProgress(done, total); };
    // One browser process per worker: screenshots are serialised inside a browser, so separate
    // processes are what actually makes the workers run in parallel.
    const extra = await Promise.all(Array.from({ length: workers - 1 }, () => launchBrowser()));
    browsers.push(...extra);
    const sessions = [first, ...(await Promise.all(extra.map((b) => openScene(b, server.origin, rel, { scale, fps: opts.fps, onLog }))))];

    const segFiles = await Promise.all(sessions.map(async (s, w) => {
      const [a, b] = [bounds[w], bounds[w + 1]];
      const file = path.join(tmp, `seg${String(w).padStart(3, '0')}.mp4`);
      const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p', ...enc.args, '-g', String(fps * 2), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', file],
      { stdio: ['pipe', 'ignore', 'pipe'] });
      let ffErr = '';
      ff.stderr.on('data', (d) => (ffErr += d));
      const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed: ' + ffErr)))));
      // Pre-roll so label fades / collision state are settled before the first captured frame.
      for (let f = a; f < b; f++) {
        const png = await grab(s, f / fps, 'png', f === a);
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
        tick();
      }
      ff.stdin.end();
      await closed;
      await s.ctx.close();
      return file;
    }));

    if (segFiles.length === 1) await fsp.copyFile(segFiles[0], out);
    else {
      const list = path.join(tmp, 'list.txt');
      await fsp.writeFile(list, segFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('ffmpeg concat failed: ' + r.stderr);
    }
    await fsp.rm(tmp, { recursive: true, force: true });
    const seconds = (Date.now() - started) / 1000;
    return { out, frames: total, seconds, fps, encoder: enc.name, gpu, warnings: [...warnings], cache: server.stats };
  } finally {
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    await server.close();
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
  const onLog = (type, text) => { if (!warnings.has(text)) { warnings.add(text); (opts.log || (() => {}))(`  ${type === 'error' ? 'ERROR' : 'warn'}: ${text.replace(/^\[bamba\] /, '')}`); } };
  const server = await startServer({ workDir, offline: opts.offline });
  const browser = await launchBrowser();
  try {
    const s = await openScene(browser, server.origin, rel, { scale: opts.scale || 1, onLog });
    const files = [];
    for (const t of times) {
      const png = await grab(s, t, 'png', true);
      const f = path.join(outDir, `${base}@${t.toFixed(2)}s.png`);
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
  const onLog = (type, text) => { if (!warnings.has(text)) { warnings.add(text); (opts.log || (() => {}))(`  ${type === 'error' ? 'ERROR' : 'warn'}: ${text.replace(/^\[bamba\] /, '')}`); } };
  const server = await startServer({ workDir, offline: opts.offline });
  const browser = await launchBrowser();
  try {
    const cols = opts.cols || 3;
    const s = await openScene(browser, server.origin, rel, { scale: opts.scale || 0.5, onLog });
    const { duration, width, height } = s.info;
    const n = opts.n || 9;
    const times = opts.times || Array.from({ length: n }, (_, i) => +(((i + 0.5) / n) * duration).toFixed(2));
    const shots = [];
    for (const t of times) {
      shots.push((await grab(s, t, 'jpeg', true)).toString('base64'));
    }
    await s.ctx.close();
    const cellW = Math.round((opts.width || 2400) / cols), cellH = Math.round((cellW * height) / width);
    const page = await browser.newPage({ viewport: { width: cellW * cols, height: cellH * Math.ceil(times.length / cols) } });
    await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${cellW}px)">${shots.map((b, i) => `<div style="position:relative;width:${cellW}px;height:${cellH}px"><img src="data:image/jpeg;base64,${b}" style="width:100%;height:100%;display:block"><span style="position:absolute;left:8px;top:8px;background:#000c;color:#fff;font:600 15px ui-monospace,monospace;padding:3px 7px;border-radius:3px">${times[i].toFixed(1)}s</span></div>`).join('')}</body>`);
    await fsp.writeFile(out, await page.screenshot({ type: 'jpeg', quality: 88 }));
    return { out, times, info: s.info, warnings: [...warnings] };
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
