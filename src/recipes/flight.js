// recipe: flight — great-circle legs between cities on a shaded globe, with a plane and a distance counter.
export const about = 'Flight across the globe along great circles; several stops become several legs.';
export const params = {
  stops: 'REQUIRED. 2+ places: "city" or [lng, lat]',
  names: 'labels for the stops, same order as stops (default: first part of each query)',
  subs: 'second line per stop, e.g. airport codes',
  title: 'caption shown at the start', sub: 'second line under the title',
  label: 'small text under the distance counter',
};
export const example = { recipe: 'flight', stops: ['São Paulo', 'Lisbon', 'Tokyo'], subs: ['GRU', 'LIS', 'NRT'], title: 'São Paulo → Lisboa → Tóquio', lang: 'pt', accent: 'amber' };

export default async (s, P) => {
  const D = P.duration ?? 20;
  s.brief(P, { globe: true, graticule: true, labels: { countries: true, water: true }, roads: false, rail: false });
  const stops = await s.geocode(P.stops);
  const names = P.names || P.stops.map((x, i) => (typeof x === 'string' ? x.split(',')[0] : stops[i].name || ''));
  const legs = stops.slice(1).map((b, i) => s.line(s.arc(stops[i], b), { width: 3.5, glow: 1 }));
  const total = legs.reduce((a, l) => a + l.km, 0);

  // each leg gets air time in proportion to its length; a short pause on the ground between legs
  const t0 = D * 0.11, t1 = D * 0.8, pause = legs.length > 1 ? Math.min(0.8, (t1 - t0) * 0.06) : 0;
  const air = t1 - t0 - pause * (legs.length - 1);
  let t = t0;
  s.camera.set({ center: stops[0], zoom: 4.1 });
  s.pin(stops[0], names[0], { at: 0.5, sub: P.subs?.[0] });
  legs.forEach((leg, i) => {
    const dur = (air * leg.km) / total;
    leg.draw({ at: t, dur });
    s.camera.follow(leg, { zoom: 3.1, settle: Math.min(4, dur * 0.6) });
    s.mover(leg, { icon: 'plane', size: 44, end: t + dur + 0.1 });
    s.pin(stops[i + 1], names[i + 1], { at: t + dur - 0.5, sub: P.subs?.[i + 1], side: 'left' });
    t += dur + pause;
  });
  s.camera.to({ zoom: '+0.6' }, { at: t1 + 0.2, dur: D - t1 - 0.2, ease: 'outCubic' });

  if (P.title) s.caption(P.title, { at: 0.5, end: t0 + 2.2, sub: P.sub });
  s.ticker({ value: (time) => legs.reduce((a, l) => a + l.km * l.progress(time), 0), unit: 'km', at: t0, pos: 'br', label: P.label });
  return { legs, stops };
};
