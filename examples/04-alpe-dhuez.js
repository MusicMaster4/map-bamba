// Relevo 2.5D: a subida do Alpe d'Huez e suas 21 curvas, sobre terreno real.
export const config = { duration: 20, terrain: 1.4, hillshade: 0.6, labels: { cities: true }, lang: 'pt', locale: 'pt-BR' };

export default async (s) => {
  const route = await s.route([[6.0403, 45.057], [6.0711, 45.0925]]);
  const [base, top] = route.stops;
  const line = s.line(route, { color: s.c.amber, width: 5, glow: 0.45 });

  s.camera.set({ center: [6.052, 45.076], zoom: 11.2, pitch: 0, bearing: 0 });
  s.camera.to({ center: [6.054, 45.077], zoom: 13.1, pitch: 66, bearing: 48 }, { at: 0.6, dur: 4.4 });
  s.camera.orbit({ at: 5, dur: 15, by: -64, ease: 'inOutSine' });

  line.draw({ at: 4.6, dur: 11.4 });
  s.mover(line, { icon: 'dot', size: 26, color: s.c.paper });
  s.pin(base, "Le Bourg-d'Oisans", { at: 2.2, sub: '720 m', kind: 'stem', color: s.c.amber });
  s.pin(top, "Alpe d'Huez", { at: 15.4, sub: '1 850 m', kind: 'stem', color: s.c.amber });

  s.caption("Alpe d'Huez", { at: 0.6, sub: '21 curvas, 8% de inclinação média' });
  s.counter({ follow: line, to: route.km, unit: 'km', decimals: 1, at: 4.6, pos: 'br', label: 'de subida' });
};
