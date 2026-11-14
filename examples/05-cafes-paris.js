// Estabelecimentos reais do OpenStreetMap: todos os cafés do Marais, em Paris.
export const config = { duration: 20, labels: { water: true, streets: true }, lang: 'pt', locale: 'pt-BR', credit: 'Dados: OpenStreetMap' };

export default async (s) => {
  const marais = await s.place('Le Marais, Paris');
  const vosges = await s.geocode('Place des Vosges, Paris');
  const cafes = await s.pois({ tags: 'amenity=cafe', within: marais });
  // ripple outwards from Place des Vosges
  cafes.sort((p, q) => s.geo.haversine(vosges, [p.lng, p.lat]) - s.geo.haversine(vosges, [q.lng, q.lat]));
  const T0 = 3, SPAN = 9, when = (i) => T0 + (i / cafes.length) ** 0.8 * SPAN;

  s.camera.set({ fit: marais, padding: 110 });
  s.camera.drift({ at: 0, dur: 12.5, zoom: '+0.15' });
  s.area(marais, { color: s.c.paper, fill: 0.045, strokeWidth: 1.4, dash: [3, 2.5], at: 0.8, dur: 1.4 });

  s.points(cafes, { at: (d, i) => when(i), size: 4.6, pulse: 1.1, glow: 0.7, label: 'name', labelSize: 13, labelMinZoom: 15.1 });
  s.camera.to({ center: vosges, zoom: 16.4, pitch: 38, bearing: -18 }, { at: 12.6, dur: 5.2 });

  s.caption('Os cafés do Marais', { at: 0.6, sub: 'Paris, 3º e 4º arrondissements' });
  s.label(vosges, 'Place des Vosges', { at: 15.5, style: 'place' });
  s.ticker({ value: (t) => cafes.filter((_, i) => when(i) <= t).length, at: T0, pos: 'br', unit: 'cafés', label: 'mapeados no OpenStreetMap' });
};
