// Renders every scene in examples/ to out/. Usage: node scripts/render-examples.js [filter]
import fs from 'node:fs';
import { render } from '../src/node/render.js';

const filter = process.argv[2] || '';
const scenes = fs.readdirSync('examples').filter((f) => /^dd-.*.js$/.test(f) && f.includes(filter)).sort();
for (const f of scenes) {
  const r = await render('examples/' + f, { log: (s) => console.log(s) });
  console.log(`${f} → ${r.frames} frames in ${r.seconds.toFixed(1)}s (${r.encoder})`);
}
