// Série temporal real: a linha de frente na Ucrânia a cada 10 dias desde abril de 2022 (DeepStateMap).
export const config = { duration: 20, labels: { countries: true, cities: true, water: true }, roads: false, lang: 'pt', locale: 'pt-BR', credit: 'Dados: DeepStateMap' };

const T0 = 2.4, T1 = 17.6, UKRAINE_KM2 = 603550;

export default async (s) => {
  const d = await s.load('./data/ukraine.json');
  const multi = (ids) => ({ type: 'MultiPolygon', coordinates: ids.map((i) => d.pool[i]) });
  const from = +new Date(d.frames[0].d), to = +new Date(d.frames.at(-1).d);
  const when = (date) => T0 + ((+new Date(date) - from) / (to - from)) * (T1 - T0);
  const pre = { type: 'MultiPolygon', coordinates: d.pre2022 };
  const preKm2 = s.geo.area(pre);
  const frames = d.frames.map((f) => ({ at: when(f.d), occ: multi(f.occ), lib: multi(f.lib), km2: preKm2 + s.geo.area(multi(f.occ)) }));
  const [ukraine] = await s.countries('UA');

  s.camera.set({ fit: ukraine, padding: { top: 120, bottom: 190, left: 120, right: 120 } });
  s.camera.to({ center: [35.6, 48.25], zoom: 6.35 }, { at: 7.2, dur: 9, ease: 'inOutSine' });

  s.area(ukraine, { color: s.c.paper, fill: 0.035, strokeWidth: 1.6, strokeOpacity: 0.55, at: 0.3 });
  s.area(pre, { color: s.c.signal, fill: 0.1, hatch: { spacing: 6, width: 1.2, opacity: 0.5 }, strokeWidth: 1, strokeOpacity: 0.6, at: 0.9 });
  s.area(frames[0].lib, { color: s.c.ice, fill: 0.2, strokeWidth: 0.8, strokeOpacity: 0.5, at: 1.5 }).frames(frames.map((f) => ({ at: f.at, data: f.lib })));
  s.area(frames[0].occ, { color: s.c.signal, fill: 0.5, strokeWidth: 1.5, glow: 0.7, at: 1.5 }).frames(frames.map((f) => ({ at: f.at, data: f.occ })));

  s.date({ from, to, at: T0, dur: T1 - T0, pos: 'tl', size: 84, format: { month: 'short', year: 'numeric' } });
  s.ticker({
    value: (t) => (frames.findLast((f) => f.at <= t) ?? frames[0]).km2 / UKRAINE_KM2 * 100,
    decimals: 1, unit: '%', label: 'do território da Ucrânia sob ocupação', at: 1.6, pos: 'tr', size: 84,
  });
  s.legend([
    { color: s.c.signal, label: 'Ocupado desde 2022', kind: 'fill' },
    { color: s.c.signal, label: 'Ocupado antes de 2022', kind: 'hatch' },
    { color: s.c.ice, label: 'Retomado pela Ucrânia', kind: 'fill' },
  ], { at: 1.2, pos: 'bl' });
  s.timebar({
    from, to, at: T0, dur: T1 - T0, pos: 'b', width: 820,
    marks: [{ at: '2022-11-11', label: 'Kherson' }, { at: '2023-05-20', label: 'Bakhmut' }, { at: '2024-02-17', label: 'Avdiivka' }, { at: '2025-01-01', label: '2025' }, { at: '2026-01-01', label: '2026' }],
  });
};
