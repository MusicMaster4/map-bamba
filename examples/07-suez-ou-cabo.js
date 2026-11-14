// Duas rotas marítimas Xangai → Roterdã comparadas, em tema azul-noite.
export const config = { duration: 20, theme: 'night', labels: { countries: true, water: true }, roads: false, lang: 'pt', locale: 'pt-BR', credit: 'Rotas aproximadas' };

const SHARED = [[122.0, 31.0], [123.4, 27.2], [119.9, 23.6], [114.6, 17.2], [110.6, 10.2], [106.6, 5.0]];
const SUEZ = [...SHARED, [104.4, 1.35], [100.6, 3.1], [97.6, 5.7], [94.3, 6.1], [80.6, 5.4], [65.0, 10.5], [52.0, 13.3], [47.5, 12.3], [44.3, 11.95], [43.3, 12.6],
  [42.2, 14.6], [40.2, 17.6], [38.1, 21.6], [35.9, 25.2], [34.2, 27.4], [33.05, 29.0], [32.56, 29.95], [32.38, 31.4], [28.0, 33.6], [20.0, 35.0], [14.0, 36.1], [10.6, 37.7],
  [5.0, 37.6], [-2.0, 36.2], [-5.5, 35.95], [-9.8, 36.5], [-10.3, 39.0], [-10.1, 43.6], [-6.5, 47.2], [-5.7, 48.9], [-2.5, 49.95], [1.4, 51.0], [3.0, 51.8], [4.05, 51.97]];
const CABO = [...SHARED, [106.9, 0.2], [106.3, -3.6], [105.6, -6.1], [95.0, -12.5], [75.0, -20.5], [55.0, -27.5], [45.0, -29.8], [33.0, -33.5], [20.1, -35.9], [17.4, -34.9],
  [10.0, -25.0], [0.0, -10.0], [-10.5, 2.0], [-18.6, 14.0], [-18.4, 24.0], [-15.6, 30.0], [-11.4, 36.6], [-10.3, 39.0], [-10.1, 43.6], [-6.5, 47.2], [-5.7, 48.9], [-2.5, 49.95], [1.4, 51.0], [3.0, 51.8], [4.05, 51.97]];

export default async (s) => {
  const suez = s.line(s.geo.spline(SUEZ), { color: s.c.amber, width: 3.2, glow: 0.9 });
  const cabo = s.line(s.geo.spline(CABO), { color: s.c.ice, width: 3.2, glow: 0.9 });
  const days = (km) => km / (16 * 1.852 * 24); // a 16 nós

  s.camera.set({ fit: [cabo, suez], padding: { top: 110, bottom: 150, left: 130, right: 420 } });
  s.camera.drift({ at: 0, dur: 20, zoom: '+0.1' });

  s.pin(SUEZ[0], 'Xangai', { at: 0.5, color: s.c.paper, kind: 'ring', side: 'top' });
  s.pin(SUEZ.at(-1), 'Roterdã', { at: 0.9, color: s.c.paper, kind: 'ring', side: 'top' });

  suez.draw({ at: 2, dur: 7 });
  s.mover(suez, { icon: 'ship', size: 26, color: s.c.amber, end: 8.9 });
  s.label([32.5, 30.2], 'Canal de Suez', { at: 7.2, kind: 'dot', size: 8, color: s.c.amber, style: 'note', offset: [70, -64] });

  cabo.draw({ at: 9.5, dur: 8 });
  s.mover(cabo, { icon: 'ship', size: 26, color: s.c.ice, end: 17.4 });
  s.label([18.5, -34.4], 'Cabo da Boa Esperança', { at: 13.2, kind: 'dot', size: 8, color: s.c.ice, style: 'note', offset: [-70, 56] });

  s.counter({ follow: suez, to: suez.km, unit: 'km', at: 2, pos: 'r', size: 62, color: s.c.amber, label: `via Suez · ${Math.round(days(suez.km))} dias` });
  s.counter({ follow: cabo, to: cabo.km, unit: 'km', at: 9.5, pos: 'r', size: 62, color: s.c.ice, label: `via Cabo · ${Math.round(days(cabo.km))} dias` });
  s.caption('Xangai → Roterdã', { at: 0.6, sub: 'Navegando a 16 nós' });
};
