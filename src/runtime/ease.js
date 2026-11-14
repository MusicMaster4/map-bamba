// Easing curves. Every animation option `ease` accepts one of these names or a function (p) => p.
const pow = (n) => ({
  in: (p) => p ** n,
  out: (p) => 1 - (1 - p) ** n,
  inOut: (p) => (p < 0.5 ? 2 ** (n - 1) * p ** n : 1 - (-2 * p + 2) ** n / 2),
});
const quad = pow(2), cubic = pow(3), quart = pow(4), quint = pow(5);

export const EASE = {
  linear: (p) => p,
  in: cubic.in, out: cubic.out, inOut: cubic.inOut,
  inQuad: quad.in, outQuad: quad.out, inOutQuad: quad.inOut,
  inCubic: cubic.in, outCubic: cubic.out, inOutCubic: cubic.inOut,
  inQuart: quart.in, outQuart: quart.out, inOutQuart: quart.inOut,
  inQuint: quint.in, outQuint: quint.out, inOutQuint: quint.inOut,
  inExpo: (p) => (p === 0 ? 0 : 2 ** (10 * p - 10)),
  outExpo: (p) => (p === 1 ? 1 : 1 - 2 ** (-10 * p)),
  inOutExpo: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2),
  inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  outSine: (p) => Math.sin((p * Math.PI) / 2),
  outBack: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
  // Smooth start + long soft landing; the default for camera moves.
  glide: (p) => (p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2) * 0.35 + cubic.inOut(p) * 0.65,
  // Soft overshoot settle; good for pins/dots popping in.
  spring: (p) => 1 - Math.exp(-6.5 * p) * Math.cos(9 * p) * (1 - p),
};

export function ease(name) {
  if (typeof name === 'function') return name;
  const f = EASE[name || 'inOut'];
  if (!f) throw new Error(`Unknown ease "${name}". Valid: ${Object.keys(EASE).join(', ')}`);
  return f;
}
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, p) => a + (b - a) * p;
/** Progress 0..1 of time t inside [at, at+dur]. */
export const prog = (t, at, dur) => (dur <= 0 ? (t >= at ? 1 : 0) : clamp((t - at) / dur));
