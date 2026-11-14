// Rota real pelas ruas do Recife: de Boa Viagem a Casa Forte, com prédios em 2.5D.
export const config = { duration: 20, buildings: '3d', lang: 'pt', locale: 'pt-BR' };

export default async (s) => {
  const route = await s.route(['Praça de Boa Viagem, Recife', 'Praça de Casa Forte, Recife']);
  const [a, b] = route.stops;

  s.camera.set({ fit: route, padding: 170 });
  const line = s.line(route, { width: 6, glow: 0.8 });
  s.pin(a, 'Boa Viagem', { at: 0.6, kind: 'ring' });
  s.pin(b, 'Casa Forte', { at: 1.1, side: 'left' });

  s.camera.to({ center: a, zoom: 15.3, pitch: 58, bearing: -28 }, { at: 1.8, dur: 3.6 });
  line.draw({ at: 5.2, dur: 10.6 });
  s.camera.follow(line, { zoom: 15.5, bearing: 'auto' });
  s.mover(line, { icon: 'arrow', size: 34 });
  s.camera.to({ fit: route, padding: 170, pitch: 0, bearing: 0 }, { at: 16.2, dur: 3.2 });

  s.caption('De Boa Viagem a Casa Forte', { at: 0.5, end: 5, sub: 'Recife, Pernambuco' });
  s.counter({ follow: line, to: route.km, unit: 'km', decimals: 1, at: 5.2, pos: 'br', label: 'pelas ruas do Recife' });
};
