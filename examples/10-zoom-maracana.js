// Zoom contínuo do espaço até uma rua: da Terra inteira ao Maracanã.
export const config = { duration: 20, globe: true, hillshade: true, buildings: '3d', lang: 'pt', locale: 'pt-BR' };

export default async (s) => {
  const maracana = [-43.2302, -22.9121];
  s.camera.set({ center: [-34, -2], zoom: 2.7 });
  s.camera.to({ center: maracana, zoom: 16.3, pitch: 58, bearing: 24 }, { at: 1, dur: 15, curve: 1.0, ease: 'inOutSine' });
  s.camera.orbit({ at: 16, dur: 4, by: 34, ease: 'outSine' });

  const steps = [[0.6, 'Terra'], [3.3, 'América do Sul'], [5, 'Brasil'], [6.7, 'Rio de Janeiro'], [11.4, 'Zona Norte']];
  steps.forEach(([at, text], i) => s.note(text, { at, end: (steps[i + 1]?.[0] ?? 13.4) - 0.5, pos: 'bl', size: 34, in: 'blur', out: 'blur' }));
  s.caption('Estádio do Maracanã', { at: 13.8, sub: '22°54′44″S 43°13′49″O' });
  s.pin(maracana, null, { kind: 'pulse', at: 13.2 });
};
