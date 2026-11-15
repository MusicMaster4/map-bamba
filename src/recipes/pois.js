// recipe: pois — every real café / museum / station… in an area, appearing one by one and counted.
export const about = 'Every real establishment of a kind in an area (OpenStreetMap), popping in and counted; ends close enough to read the names.';
export const params = {
  area: 'REQUIRED. a place with an outline: "Le Marais, Paris", "Copacabana, Rio de Janeiro"',
  tags: 'REQUIRED. OpenStreetMap tag(s): "amenity=cafe", ["amenity=bar", "amenity=pub"], "tourism=museum", "shop=bakery"…',
  unit: 'word after the count, e.g. "cafés"',
  focus: 'place to push in to at the end (default: the densest part of the area)',
  title: 'caption', sub: 'second line under the title', label: 'small text under the counter',
};
export const example = { recipe: 'pois', area: 'Le Marais, Paris', tags: 'amenity=cafe', unit: 'cafés', title: 'Os cafés do Marais', sub: 'Paris', lang: 'pt' };

export default async (s, P) => {
  const D = P.duration ?? 20;
  if (!P.area || !P.tags) throw new Error('pois: pass area ("Le Marais, Paris") and tags ("amenity=cafe")');
  s.brief(P, { labels: { water: true, streets: true }, credit: P.credit ?? 'Data: OpenStreetMap' });
  const area = await s.place(P.area);
  const items = await s.pois({ tags: P.tags, within: area });
  if (!items.length) throw new Error(`pois: nothing tagged ${JSON.stringify(P.tags)} found in "${P.area}". Check the tag on wiki.openstreetmap.org/wiki/Map_features`);
  // end the shot where the places are thickest (or where the brief says)
  const dense = () => { let best = items[0], n = -1; for (const a of items) { const c = items.filter((b) => s.geo.haversine([a.lng, a.lat], [b.lng, b.lat]) < 0.25).length; if (c > n) { n = c; best = a; } } return [best.lng, best.lat]; };
  const focus = P.focus ? await s.geocode(P.focus) : dense();
  items.sort((a, b) => s.geo.haversine(focus, [a.lng, a.lat]) - s.geo.haversine(focus, [b.lng, b.lat]));
  const t0 = D * 0.15, span = D * 0.45, when = (i) => t0 + (i / items.length) ** 0.8 * span, push = D * 0.63;

  s.camera.set({ fit: area, padding: 120 });
  s.camera.drift({ at: 0, dur: push, zoom: '+0.15' });
  s.area(area, { color: s.c.paper, fill: 0.045, strokeWidth: 1.4, at: 0.8 });
  s.points(items, { at: (d, i) => when(i), size: 4.6, pulse: 1.1, glow: 0.7, label: 'name', labelSize: 13, labelMinZoom: 15.1 });
  s.camera.to({ center: focus, zoom: 16.4, pitch: 38, bearing: -18 }, { at: push, dur: D * 0.26 });

  if (P.title) s.caption(P.title, { at: 0.6, sub: P.sub });
  s.ticker({ value: (t) => items.filter((_, i) => when(i) <= t).length, at: t0, pos: 'br', unit: P.unit, label: P.label });
  return { area, items };
};
