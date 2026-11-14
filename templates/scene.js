// A map-bamba scene. Check it with:  node bin/bamba.js sheet scenes/<this file>
// Full API: AGENTS.md
export const config = { duration: 20, lang: 'en', locale: 'en-US' };

export default async (s) => {
  // 1 · real data (cached on disk after the first run)
  const route = await s.route(['Trafalgar Square, London', 'Tower Bridge, London']);
  const [from, to] = route.stops;

  // 2 · camera: where it starts, where it goes
  s.camera.set({ fit: route, padding: 230 });
  s.camera.drift({ at: 0, dur: 20, zoom: '+0.1' });   // a slow push keeps the shot alive

  // 3 · things on the map
  const line = s.line(route, { width: 6, glow: 0.7 });
  line.draw({ at: 2, dur: 12 });
  s.mover(line, { icon: 'arrow', size: 34 });
  s.pin(from, 'Trafalgar Square', { at: 0.8, kind: 'ring' });
  s.pin(to, 'Tower Bridge', { at: 13.5, side: 'left' });

  // 4 · words and numbers
  s.caption('Trafalgar Square to Tower Bridge', { at: 0.6, sub: 'Along the north bank of the Thames' });
  s.counter({ follow: line, to: route.km, unit: 'km', decimals: 1, at: 2, pos: 'br' });
};
