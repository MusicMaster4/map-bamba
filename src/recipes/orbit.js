// recipe: orbit — a slow circle over a 2.5D city, with real buildings picked out and labelled at roof height.
export const about = 'Orbit over a 2.5D skyline; chosen buildings are extruded in the accent colour and labelled at their rooftops.';
export const params = {
  center: 'REQUIRED. "district or landmark, city" or [lng, lat]',
  landmarks: '[{ q: "Empire State Building, New York", name, height (m), sub }] — real footprints are looked up from q',
  zoom: 'default 14.9', by: 'degrees of orbit, default 96',
  title: 'caption', sub: 'second line under the title',
};
export const example = { recipe: 'orbit', center: [-73.9812, 40.7527], title: 'Midtown Manhattan', landmarks: [{ q: 'Empire State Building, New York', name: 'Empire State', height: 381, sub: '381 m · 1931' }, { q: 'Chrysler Building, New York', name: 'Chrysler', height: 319, sub: '319 m · 1930' }] };

export default async (s, P) => {
  const D = P.duration ?? 20;
  s.brief(P, { buildings: '3d', labels: { water: true } });
  const center = await s.geocode(P.center);
  s.camera.set({ center, zoom: P.zoom ?? 14.9, pitch: 64, bearing: -42 });
  s.camera.orbit({ at: 0, dur: D, by: P.by ?? 96, ease: 'linear' });
  s.camera.to({ zoom: '+0.35' }, { at: 0, dur: D, ease: 'inOutSine' });
  s.buildingsRise({ at: 0.2, dur: Math.min(2.6, D * 0.14) });

  const marks = P.landmarks || [];
  const t0 = D * 0.16, step = marks.length ? Math.min(3.2, (D * 0.6) / marks.length) : 0;
  for (const [i, m] of marks.entries()) {
    const b = m.q ? await s.place(m.q) : { center: m.at };
    const at = t0 + i * step, h = m.height ?? 120;
    if (b.geojson && /Polygon/.test(b.geojson.geometry.type)) s.extrude(b, { height: h, at, dur: 1.6 });
    s.pin(b.center, m.name || b.name, { kind: 'stem', stem: 54, alt: h, altGrow: true, color: s.c.paper, sub: m.sub, at, dur: 1.6 });
  }
  if (P.title) s.caption(P.title, { at: 0.8, sub: P.sub });
};
