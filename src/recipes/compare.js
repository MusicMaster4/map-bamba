// recipe: compare — two or three routes between the same ends, drawn one after another with their distances.
export const about = 'Two or three routes compared (road routes, great-circle arcs or hand-placed sea/air paths), each with its own distance.';
export const params = {
  routes: 'REQUIRED. 2–3 of { label, stops: ["A", "B"] (road) | arc: ["A", "B"] (great circle) | path: [[lng, lat], …] (hand-placed, smoothed), color?, icon? }',
  title: 'caption', sub: 'second line under the title',
  theme: '"ink" (default) | "night" | "paper"',
};
export const example = { recipe: 'compare', title: 'Lisboa → Porto', lang: 'pt', routes: [{ label: 'pela A1', stops: ['Lisboa', 'Porto'] }, { label: 'em linha reta', arc: ['Lisboa', 'Porto'] }] };

export default async (s, P) => {
  const D = P.duration ?? 20;
  if (!Array.isArray(P.routes) || P.routes.length < 2) throw new Error('compare: pass routes: [{ label, stops | arc | path }, …] (2 or 3)');
  s.brief(P, { labels: { countries: true, water: true, cities: false }, roads: false, rail: false });
  const palette = [s.c.amber, s.c.ice, s.c.mint];
  const lines = [];
  for (const [i, r] of P.routes.entries()) {
    const geom = r.stops ? await s.route(r.stops, { profile: r.profile }) : r.arc ? s.arc(...(await s.geocode(r.arc))) : s.geo.spline(r.path);
    lines.push({ r, color: r.color || palette[i % 3], line: s.line(geom, { color: r.color || palette[i % 3], width: 3.4, glow: 0.9 }) });
  }
  const a = lines[0].line.metric.at(0), b = lines[0].line.metric.at(1);
  s.camera.set({ fit: lines.map((l) => l.line), padding: { top: 120, bottom: 170, left: 150, right: 430 } });
  s.camera.drift({ at: 0, dur: D, zoom: '+0.1' });
  const first = P.routes[0], ends = first.stops || first.arc;
  s.pin(a, P.from ?? (typeof ends?.[0] === 'string' ? ends[0].split(',')[0] : null), { at: 0.5, kind: 'ring', color: s.c.paper });
  s.pin(b, P.to ?? (typeof ends?.at(-1) === 'string' ? ends.at(-1).split(',')[0] : null), { at: 0.9, kind: 'ring', color: s.c.paper });

  const t0 = D * 0.1, slot = (D * 0.78) / lines.length;
  lines.forEach(({ r, color, line }, i) => {
    const at = t0 + i * slot, dur = slot * 0.86;
    line.draw({ at, dur });
    s.mover(line, { icon: r.icon || 'dot', size: 22, color, end: at + dur + 0.2 });
    s.counter({ follow: line, to: line.km, unit: 'km', at, pos: 'r', size: 62, color, label: r.label });
  });
  if (P.title) s.caption(P.title, { at: 0.6, sub: P.sub });
  return { lines };
};
