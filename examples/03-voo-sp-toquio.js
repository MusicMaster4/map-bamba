// Voo São Paulo → Tóquio sobre o globo, pela rota ortodrômica (great circle).
export const config = { duration: 20, globe: true, graticule: true, labels: { countries: true, water: true }, roads: false, lang: 'pt', locale: 'pt-BR' };

export default async (s) => {
  const GRU = [-46.4731, -23.4356], NRT = [140.3929, 35.772];
  const line = s.line(s.arc(GRU, NRT), { color: s.c.amber, width: 3.5, glow: 1 });

  s.camera.set({ center: GRU, zoom: 4.2 });
  s.pin(GRU, 'São Paulo', { at: 0.5, sub: 'Guarulhos · GRU', color: s.c.amber });
  line.draw({ at: 2.2, dur: 13.5 });
  s.camera.follow(line, { zoom: 3.1, settle: 4.5 });
  s.mover(line, { icon: 'plane', size: 46, end: 15.9 });
  s.pin(NRT, 'Tóquio', { at: 15.3, sub: 'Narita · NRT', color: s.c.amber, side: 'left' });
  s.camera.to({ zoom: '+0.7' }, { at: 15.7, dur: 4.3, ease: 'outCubic' });

  s.counter({ follow: line, to: line.km, unit: 'km', at: 2.2, pos: 'br', label: 'São Paulo → Tóquio, em linha ortodrômica' });
};
