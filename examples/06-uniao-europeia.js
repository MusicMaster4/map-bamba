// Mapa coroplético em tema claro: a expansão da União Europeia, onda por onda.
export const config = { duration: 20, theme: 'paper', labels: { countries: true }, roads: false, lang: 'pt', locale: 'pt-BR', credit: 'Fronteiras: Natural Earth' };

const WAVES = [
  { at: 1.6, year: 1957, in: ['BE', 'FR', 'DE', 'IT', 'LU', 'NL'] },
  { at: 4.2, year: 1973, in: ['DK', 'IE', 'GB'] },
  { at: 6.2, year: 1981, in: ['GR'] },
  { at: 7.8, year: 1986, in: ['ES', 'PT'] },
  { at: 9.6, year: 1995, in: ['AT', 'FI', 'SE'] },
  { at: 11.6, year: 2004, in: ['CY', 'CZ', 'EE', 'HU', 'LV', 'LT', 'MT', 'PL', 'SK', 'SI'] },
  { at: 13.8, year: 2007, in: ['BG', 'RO'] },
  { at: 15.4, year: 2013, in: ['HR'] },
  { at: 17.2, year: 2020, out: ['GB'] },
];

export default async (s) => {
  s.camera.set({ center: [9.5, 53.2], zoom: 3.55 });
  s.camera.drift({ at: 0, dur: 20, zoom: '+0.12' });

  const blue = '#2B50AA';
  const codes = WAVES.flatMap((w) => w.in || []);
  const byCode = Object.fromEntries((await s.countries(codes)).map((f, i) => [codes[i], f]));
  WAVES.forEach((w, i) => {
    const next = WAVES[i + 1]?.at ?? 99;
    for (const code of w.in || []) {
      const f = byCode[code];
      // newcomers hold the accent colour until the next wave arrives, then settle into the union's blue
      s.area(f, { color: s.c.accent, fill: 0.78, stroke: '#F1EDE4', strokeWidth: 1.1, at: w.at, dur: 0.7, end: next - 0.5, outDur: 0.45 });
      s.area(f, { color: blue, fill: 0.55, stroke: '#F1EDE4', strokeWidth: 1.1, at: next - 0.5, dur: 0.45, end: code === 'GB' ? 17.2 : null, outDur: 1.4 });
    }
    for (const code of w.out || []) {
      const f = byCode[code];
      s.area(f, { color: blue, fill: 0, hatch: { spacing: 7, width: 1.3, opacity: 0.5 }, stroke: blue, strokeWidth: 1.2, at: w.at + 0.4, dur: 1.2 });
    }
  });

  const wave = (t) => WAVES.findLast((w) => t >= w.at);
  const members = (t) => WAVES.filter((w) => t >= w.at).reduce((n, w) => n + (w.in?.length || 0) - (w.out?.length || 0), 0);
  s.ticker({ value: (t) => String(wave(t)?.year ?? 1957), at: 1.2, pos: 'tl', size: 120 });
  s.ticker({ value: (t) => String(members(t)), at: 1.6, pos: 'bl', size: 64, unit: 'países-membros' });
  s.note('Reino Unido deixa a União', { at: 17.4, pos: 'tl', color: s.c.accent, size: 28 });
};
