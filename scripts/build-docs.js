// Rebuilds the README images from the rendered videos in out/. Usage: node scripts/build-docs.js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
fs.mkdirSync('docs/examples', { recursive: true });

// one representative frame per example: [video, seconds]
const STILLS = [
  ['01-ucrania-front', 14], ['02-recife-rota', 8.6], ['03-voo-sp-toquio', 8], ['04-alpe-dhuez', 13], ['05-cafes-paris', 18.5],
  ['06-uniao-europeia', 12.6], ['07-suez-ou-cabo', 17.3], ['08-manhattan-orbita', 15], ['09-terremotos', 17], ['10-zoom-maracana', 17.5], ['camino', 9.5],
];
for (const [name, t] of STILLS) {
  if (!fs.existsSync(`out/${name}.mp4`)) { console.log('skip (not rendered):', name); continue; }
  ff(['-ss', String(t), '-i', `out/${name}.mp4`, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', `docs/examples/${name}.jpg`]);
}

// animated showreel: 2.5 s from eight videos
const CLIPS = [['08-manhattan-orbita', 5], ['02-recife-rota', 7.5], ['03-voo-sp-toquio', 6], ['01-ucrania-front', 9.5], ['04-alpe-dhuez', 9], ['09-terremotos', 9], ['07-suez-ou-cabo', 13], ['05-cafes-paris', 15.5]];
const inputs = CLIPS.flatMap(([name, t]) => ['-ss', String(t), '-t', '2.5', '-i', `out/${name}.mp4`]);
ff([...inputs, '-filter_complex', `${CLIPS.map((_, i) => `[${i}:v]`).join('')}concat=n=${CLIPS.length}:v=1:a=0,fps=12,scale=800:450:flags=lanczos[v]`, '-map', '[v]', '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '62', '-compression_level', '5', '-loop', '0', 'docs/preview.webp']);
console.log('docs images rebuilt');
