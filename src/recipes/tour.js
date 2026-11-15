// recipe: tour — the camera visits several places in turn (stadiums, museums, branches, landmarks…),
// pausing on each with its name and an optional number, then pulls back to show them all.
export const about = 'The camera visits several places one after another in 2.5D, names each (optionally with a number), then shows them all.';
export const params = {
  stops: 'REQUIRED. [{ q: "place, city" | at: [lng, lat], name, sub, value }] in visiting order (value = a number counted up while there)',
  unit: 'word after each value, e.g. "lugares"',
  total: 'label for the sum of the values on the final shot (omit to hide the sum)',
  zoom: 'how close to get to each stop, default 15.8',
  title: 'caption', sub: 'second line under the title',
};
export const example = { recipe: 'tour', title: 'Os três grandes estádios de São Paulo', unit: 'lugares', total: 'somados', lang: 'pt',
  stops: [{ q: 'Estádio do Morumbi, São Paulo', name: 'Morumbi', value: 66795 }, { q: 'Allianz Parque, São Paulo', name: 'Allianz Parque', value: 43713 }, { q: 'Neo Química Arena, São Paulo', name: 'Neo Química Arena', value: 49205 }] };

export default async (s, P) => {
  const D = P.duration ?? 20;
  if (!Array.isArray(P.stops) || P.stops.length < 2) throw new Error('tour: pass stops: [{ q | at, name, sub, value }, …] (2 or more)');
  s.brief(P, { buildings: '3d' });
  const stops = [];
  for (const st of P.stops) stops.push({ ...st, p: st.at || (await s.geocode(st.q)) });
  const all = stops.map((st) => st.p), frame = { top: 230, bottom: 260, left: 260, right: 260 };
  const fmt = new Intl.NumberFormat(s.cfg.locale);

  s.camera.set({ fit: all, padding: frame });
  const t0 = D * 0.05, slot = (D * 0.75) / stops.length, travel = slot * 0.56;
  stops.forEach((st, i) => {
    const from = t0 + i * slot, arrive = from + travel, leave = from + slot;
    s.camera.to({ center: st.p, zoom: P.zoom ?? 15.8, pitch: 58, bearing: i % 2 ? 22 : -24 }, { at: from, dur: travel });
    s.camera.drift({ at: arrive, dur: leave - arrive, zoom: '+0.12', bearing: i % 2 ? '-6' : '+6' });
    const sub = st.sub ?? (st.value != null ? `${fmt.format(st.value)}${P.unit ? ' ' + P.unit : ''}` : undefined);
    s.pin(st.p, st.name || st.p.name, { at: arrive - 0.5, kind: 'stem', alt: 40, sub, textSize: 28 });
    if (st.value != null) s.counter({ to: st.value, unit: P.unit, label: st.name, at: arrive - 0.4, dur: Math.min(1.4, slot * 0.3), end: leave - 0.2, pos: 'br' });
  });
  const back = t0 + stops.length * slot;
  s.camera.to({ fit: all, padding: frame, pitch: 0, bearing: 0 }, { at: back, dur: Math.min(3, D - back - 1.2) });
  const sum = stops.reduce((a, st) => a + (st.value || 0), 0);
  if (P.total && sum) s.counter({ to: sum, unit: P.unit, label: P.total, at: back + 1.2, dur: 1.4, pos: 'br' });
  if (P.title) s.caption(P.title, { at: 0.4, sub: P.sub });
  return { stops };
};
