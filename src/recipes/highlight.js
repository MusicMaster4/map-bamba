// recipe: highlight — countries or regions lighting up group by group (a choropleth that tells a story).
export const about = 'Countries / regions light up group by group: memberships, alliances, expansions, rankings.';
export const params = {
  groups: 'REQUIRED. [{ label, places: ["BR", "Argentina", "Bavaria, Germany", …], color? }] in order of appearance',
  title: 'caption', sub: 'second line under the title',
  unit: 'word after the running count, e.g. "países"',
  theme: '"ink" (default) | "paper" | "night"',
};
export const example = { recipe: 'highlight', title: 'Mercosul', unit: 'países', lang: 'pt', groups: [{ label: '1991', places: ['BR', 'AR', 'UY', 'PY'] }, { label: '2012', places: ['VE'] }, { label: '2024', places: ['BO'] }] };

export default async (s, P) => {
  const D = P.duration ?? 20;
  if (!Array.isArray(P.groups) || !P.groups.length) throw new Error('highlight: pass groups: [{ label, places: [...] }]');
  s.brief(P, { labels: { countries: true }, roads: false, rail: false });
  // a place is a country (ISO code or name, from the bundled outlines) or anything Nominatim can outline
  const outline = async (q) => { try { return (await s.countries(q))[0]; } catch { return (await s.place(q)).geojson; } };
  const groups = [];
  for (const g of P.groups) groups.push({ ...g, shapes: await Promise.all(g.places.map(outline)) });
  const all = groups.flatMap((g) => g.shapes);

  s.camera.set({ fit: all, padding: { top: 150, bottom: 190, left: 300, right: 300 } });
  s.camera.drift({ at: 0, dur: D, zoom: '+0.12' });

  // newcomers arrive at full strength and settle to a quieter fill of the same colour when the next group lands
  const t0 = D * 0.09, step = (D * 0.74) / groups.length, settled = { fill: 0.24, strokeOpacity: 0.55 };
  groups.forEach((g, i) => {
    const at = t0 + i * step, next = i < groups.length - 1 ? at + step : null;
    for (const f of g.shapes) {
      s.area(f, { color: g.color || s.c.accent, fill: 0.62, strokeWidth: 1.4, at, dur: Math.min(1.5, step * 0.8), ...(next && !g.color ? { end: next - 0.3, outDur: 0.6 } : {}) });
      if (next && !g.color) s.area(f, { ...settled, strokeWidth: 1.1, in: 'fade', at: next - 0.3, dur: 0.6 });
    }
  });
  const reached = (t) => groups.filter((_, i) => t >= t0 + i * step);
  if (groups.some((g) => g.label)) s.ticker({ value: (t) => String(reached(t).at(-1)?.label ?? groups[0].label ?? ''), at: t0 - 0.4, pos: 'tl', size: 110 });
  s.ticker({ value: (t) => reached(t).reduce((n, g) => n + g.shapes.length, 0), at: t0, pos: 'br', unit: P.unit });
  if (P.title) s.caption(P.title, { at: 0.5, sub: P.sub });
  return { groups };
};
