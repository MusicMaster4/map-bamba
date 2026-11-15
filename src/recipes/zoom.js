// recipe: zoom — one continuous move from the whole Earth down to a place.
export const about = 'Continuous zoom from space down to a place (stadium, square, street, city).';
export const params = {
  to: 'REQUIRED. "place" or [lng, lat]',
  title: 'caption at the end (default: the place name)', sub: 'second line under the title',
  steps: 'captions shown on the way down, e.g. ["Terra", "Brasil", "Rio de Janeiro"]',
  zoom: 'final zoom (default: fits the place, or 16.3 for a point)',
};
export const example = { recipe: 'zoom', to: 'Estádio do Maracanã, Rio de Janeiro', steps: ['Terra', 'América do Sul', 'Brasil', 'Rio de Janeiro'], title: 'Estádio do Maracanã', lang: 'pt' };

export default async (s, P) => {
  const D = P.duration ?? 20;
  s.brief(P, { globe: true, buildings: '3d', hillshade: true });
  const isPoint = Array.isArray(P.to);
  const place = isPoint ? { center: P.to, name: '' } : await s.place(P.to).catch(async () => { const c = await s.geocode(P.to); return { center: c, name: c.name }; });
  const c = place.center;
  const t0 = D * 0.05, t1 = D * 0.8;

  s.camera.set({ center: [c[0] + 9, Math.max(-60, Math.min(60, c[1] * 0.35 + 6))], zoom: 2.7 });
  const target = P.zoom || !place.geojson ? { center: c, zoom: P.zoom ?? 16.3 } : { fit: place, padding: 330, maxZoom: 16.6 };
  s.camera.to({ ...target, pitch: 58, bearing: 24 }, { at: t0, dur: t1 - t0, curve: 1, ease: 'inOutSine' });
  s.camera.orbit({ at: t1, dur: D - t1, by: 34, ease: 'outSine' });

  // step captions share the descent evenly and stop before the place is named
  const steps = P.steps || [];
  const span = (t1 - t0) * 0.82;
  steps.forEach((text, i) => s.note(text, { at: i === 0 ? 0.6 : t0 + (span * i) / steps.length, end: t0 + (span * (i + 1)) / steps.length - 0.75, outDur: 0.6, pos: 'bl', size: 34, in: 'blur', out: 'blur' })); // gone before the next one lands
  s.caption(P.title || place.name, { at: t1 - 1.6, sub: P.sub });
  s.pin(c, null, { kind: 'pulse', at: t1 - 2.2 });
  return { place };
};
