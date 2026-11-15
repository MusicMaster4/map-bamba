// recipe: route — A → B (→ C …) along real roads, drawn as it is travelled.
// Short trips become a 2.5D follow shot through the city; long journeys pull back and pin each stop
// with its distance; `terrain: true` turns it into a mountain climb with an orbiting camera.
export const about = 'A → B (→ C…) along real roads. City trip = 2.5D follow shot; long journey = stop pins with km; terrain:true = mountain climb.';
export const params = {
  stops: 'REQUIRED. 2+ places: "address" or [lng, lat]',
  names: 'labels for the stops, same order as stops (default: first part of each address)',
  profile: '"car" (default) | "bike" | "foot"',
  terrain: 'true for mountain roads (3D relief, orbiting camera)',
  title: 'caption shown at the start', sub: 'second line under the title',
  label: 'small text under the distance counter',
};
export const example = { recipe: 'route', stops: ['Praça de Boa Viagem, Recife', 'Praça de Casa Forte, Recife'], title: 'De Boa Viagem a Casa Forte', sub: 'Recife, Pernambuco', lang: 'pt' };

export default async (s, P) => {
  const D = P.duration ?? 20;
  const route = await s.route(P.stops, { profile: P.profile || 'car' });
  const km = route.km, city = km < 30 && !P.terrain, journey = km >= 30 && !P.terrain;
  s.brief(P, {
    buildings: city ? '3d' : '2d', terrain: P.terrain ? 1.4 : false, hillshade: P.terrain ? 0.6 : true, rail: false, roads: km < 400,
    labels: city ? 'all' : P.terrain ? { cities: true } : { countries: true, states: true, cities: true, water: true },
  });
  const stops = route.stops, first = stops[0], last = stops.at(-1);
  const names = P.names || P.stops.map((x, i) => (typeof x === 'string' ? x.split(',')[0] : stops[i].name || ''));
  const t0 = D * 0.24, t1 = D * 0.8;
  const frame = { top: 200, bottom: 240, left: 200, right: 200 };

  const line = s.line(route, { width: city ? 6 : 5, glow: 0.8 });
  line.draw({ at: t0, dur: t1 - t0, ease: journey ? 'linear' : 'inOutSine' });
  s.mover(line, { icon: P.terrain ? 'dot' : 'arrow', size: P.terrain ? 24 : 32, color: P.terrain ? s.c.paper : s.c.fg });

  s.camera.set({ fit: route, padding: frame });
  if (P.terrain) {
    // hold the whole climb in frame and circle it
    s.camera.to({ fit: route, padding: 150, zoomOffset: 0.45, pitch: 64, bearing: 40 }, { at: D * 0.04, dur: D * 0.2 });
    s.camera.orbit({ at: t0, dur: D - t0, by: -64, ease: 'inOutSine' });
  } else {
    // width of ground the follow shot shows: a city block view, or about a fifth of a long journey
    const lat = (first[1] * Math.PI) / 180;
    const zoom = city ? 15.4 : Math.min(13, Math.log2((1920 * 156.543 * Math.cos(lat)) / Math.max(km / 3, 6)));
    s.camera.to({ center: first, zoom, pitch: city ? 58 : 46, bearing: city ? -25 : -8 }, { at: D * 0.08, dur: D * 0.15 });
    s.camera.follow(line, { zoom, pitch: city ? 58 : 46, ...(city ? { bearing: 'auto' } : { ahead: 0.06 }) });
    s.camera.to({ fit: route, padding: frame, pitch: 0, bearing: 0 }, { at: t1 + 0.2, dur: D * 0.14 });
  }

  // stops: ends are on screen from the opening shot, the rest land as the line reaches them
  stops.forEach((p, i) => {
    const end = i === 0 || i === stops.length - 1;
    const at = i === 0 ? 0.6 : end && !journey ? 1.1 : Math.max(t0, line.timeAt(p) - (journey ? 0.7 : 0.2)); // a beat before the line gets there
    const kmHere = Math.round(line.kmAt(p));
    if (i === stops.length - 1 && journey) s.pin(p, names[i], { at: 1.1, end: D * 0.16, kind: 'ring', color: s.c.paper });
    s.pin(p, names[i], { at, kind: P.terrain ? 'stem' : end ? 'ring' : 'dot', ...(end || journey ? { color: s.c.paper } : {}), ...(journey && i > 0 ? { sub: `km ${kmHere}` } : {}) });
  });

  if (P.title) s.caption(P.title, { at: 0.5, end: t0 - 0.3, sub: P.sub });
  s.counter({ follow: line, to: km, unit: 'km', decimals: km < 100 ? 1 : 0, at: t0, pos: 'br', label: P.label });
  return { route, line };
};
