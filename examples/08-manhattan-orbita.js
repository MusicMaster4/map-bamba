// Cidade em 2.5D: órbita sobre Midtown Manhattan com os arranha-céus reais destacados.
export const config = { duration: 20, buildings: '3d', labels: { water: true }, lang: 'pt', locale: 'pt-BR' };

const TOWERS = [
  { q: 'Empire State Building, New York', name: 'Empire State', h: 381, year: 1931, at: 3.2 },
  { q: 'Chrysler Building, New York', name: 'Chrysler', h: 319, year: 1930, at: 6.4 },
  { q: 'One Vanderbilt, New York', name: 'One Vanderbilt', h: 427, year: 2020, at: 9.6 },
  { q: '30 Rockefeller Plaza, New York', name: '30 Rock', h: 259, year: 1933, at: 12.8 },
];

export default async (s) => {
  s.camera.set({ center: [-73.9812, 40.7527], zoom: 14.9, pitch: 64, bearing: -42 });
  s.camera.orbit({ at: 0, dur: 20, by: 96, ease: 'linear' });
  s.camera.to({ zoom: '+0.35' }, { at: 0, dur: 20, ease: 'inOutSine' });
  s.buildingsRise({ at: 0.2, dur: 2.6 });

  for (const t of TOWERS) {
    const b = await s.place(t.q);
    s.extrude(b, { height: t.h, color: s.c.accent, at: t.at, dur: 1.6 });
    s.pin(b.center, t.name, { kind: 'stem', stem: 54, alt: t.h, altGrow: true, color: s.c.paper, sub: `${t.h} m · ${t.year}`, at: t.at, dur: 1.6 });
  }

  s.caption('Midtown Manhattan', { at: 0.8, sub: 'Quatro torres, um século de skyline' });
};
