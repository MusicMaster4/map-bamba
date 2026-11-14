// Dados reais em pontos: todos os terremotos de magnitude 6,5+ desde 2000 (USGS).
export const config = { duration: 20, labels: 'none', roads: false, boundaries: false, lang: 'pt', locale: 'pt-BR', credit: 'Dados: USGS' };

const T0 = 2, T1 = 18, FROM = Date.UTC(2000, 0, 1), TO = Date.UTC(2026, 0, 1);

export default async (s) => {
  const data = await s.load('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2000-01-01&endtime=2026-01-01&minmagnitude=6.5&orderby=time-asc');
  const when = (ms) => T0 + ((ms - FROM) / (TO - FROM)) * (T1 - T0);
  const quakes = data.features.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], mag: f.properties.mag, time: f.properties.time }));

  s.camera.set({ center: [-168, 8], zoom: 2.05 });
  s.camera.drift({ at: 0, dur: 20, zoom: '+0.14' });

  s.points(quakes, {
    at: (q) => when(q.time), dur: 0.5, pulse: 1.6, glow: 0.9, stroke: false, opacity: 0.85,
    size: (q) => 1.6 + (q.mag - 6.5) ** 1.6 * 3.4,
    color: (q) => (q.mag >= 8 ? s.c.paper : q.mag >= 7.2 ? s.c.amber : s.c.signal),
  });

  const big = [
    { name: 'Sumatra', sub: '9,1 · 2004', at: Date.UTC(2004, 11, 26), p: [95.98, 3.3], side: 'left' },
    { name: 'Chile', sub: '8,8 · 2010', at: Date.UTC(2010, 1, 27), p: [-72.9, -36.12], side: 'right' },
    { name: 'Tōhoku', sub: '9,1 · 2011', at: Date.UTC(2011, 2, 11), p: [142.37, 38.3], side: 'left' },
  ];
  for (const b of big) s.label(b.p, b.name, { sub: b.sub, at: when(b.at) + 0.15, style: 'city', side: b.side, offset: b.side === 'left' ? [-46, -34] : [46, -34] });

  s.date({ from: FROM, to: TO, at: T0, dur: T1 - T0, format: { year: 'numeric' }, pos: 'tl', size: 110 });
  s.ticker({ value: (t) => quakes.filter((q) => when(q.time) <= t).length, at: T0, pos: 'bl', size: 64, unit: 'terremotos de magnitude 6,5+' });
  s.legend([{ color: s.c.signal, label: '6,5 – 7,1', kind: 'dot' }, { color: s.c.amber, label: '7,2 – 7,9', kind: 'dot' }, { color: s.c.paper, label: '8,0 ou mais', kind: 'dot' }], { at: 2.4, pos: 'br' });
};
