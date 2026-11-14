// Tiny colour utilities (sRGB hex in, hex/rgba out).
export function parse(c) {
  if (Array.isArray(c)) return c;
  c = String(c).trim();
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`Cannot parse colour "${c}" (use #rrggbb or rgba())`);
}
const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
export const toHex = ([r, g, b]) => '#' + hex2(r) + hex2(g) + hex2(b);
/** Mix a → b by p (0..1). */
export function mix(a, b, p) { const A = parse(a), B = parse(b); return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * p)); }
/** Colour with alpha, as rgba() string. */
export function rgba(c, a = 1) { const [r, g, b, a0] = parse(c); return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+(a * a0).toFixed(4)})`; }
export function luminance(c) { const [r, g, b] = parse(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
