// Builds SDF glyph PBFs for the map's label fonts from the bundled webfonts, so map labels
// use the same typefaces as the overlay. Output: assets/glyphs/<fontstack>/<range>.pbf
// Run: node scripts/build-glyphs.js   (needs Chrome; only when changing fonts)
import fs from 'node:fs';
import path from 'node:path';
import { startServer, PKG_ROOT } from '../src/node/server.js';
import { launchBrowser } from '../src/node/render.js';

const STACKS = {
  'Bamba Sans': { family: 'Archivo', weight: 440, stretch: 'normal', style: 'normal' },
  'Bamba Sans Medium': { family: 'Archivo', weight: 580, stretch: 'normal', style: 'normal' },
  'Bamba Condensed': { family: 'Archivo', weight: 600, stretch: 'semi-condensed', style: 'normal' },
  'Bamba Serif Italic': { family: 'Newsreader', weight: 420, stretch: 'normal', style: 'italic' },
};
const RANGES = [0, 256, 512, 7680, 8192]; // Latin, Latin Extended, punctuation

const server = await startServer({ workDir: PKG_ROOT });
const browser = await launchBrowser();
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto(server.origin + '/bamba/scripts/glyphs.html');
await page.waitForFunction(() => window.buildRange);
for (const [name, font] of Object.entries(STACKS)) {
  for (const start of RANGES) {
    const b64 = await page.evaluate(([name, font, start]) => window.buildRange(name, font, start), [name, font, start]);
    const dir = path.join(PKG_ROOT, 'assets', 'glyphs', name);
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(path.join(dir, `${start}-${start + 255}.pbf`), buf);
    console.log(name, `${start}-${start + 255}`, buf.length);
  }
}
await browser.close();
await server.close();
