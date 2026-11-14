// Caminho de Santiago (Caminho Francês). First written by a fresh agent that was given only AGENTS.md;
// tidied afterwards to use line.timeAt / line.kmAt, which its feedback led to.
export const config = { duration: 20, terrain: 1.4, labels: { countries: true, states: true, water: true }, roads: false, rail: false, lang: 'pt', locale: 'pt-BR' };

// Classic stages, [lng, lat]. `show` = stop highlighted in the video.
const WAY = [
  { p: [-1.2375, 43.1631], name: 'Saint-Jean-Pied-de-Port', show: true, side: 'top' },
  { p: [-1.3197, 43.0093], name: 'Roncesvalles' },
  { p: [-1.644, 42.8169], name: 'Pamplona', show: true, side: 'right' },
  { p: [-1.8147, 42.6722], name: 'Puente la Reina' },
  { p: [-2.0304, 42.6715], name: 'Estella' },
  { p: [-2.4456, 42.465], name: 'Logroño', show: true, side: 'top' },
  { p: [-2.953, 42.441], name: 'Santo Domingo de la Calzada' },
  { p: [-3.7038, 42.3408], name: 'Burgos', show: true, side: 'bottom' },
  { p: [-4.4064, 42.2671], name: 'Frómista' },
  { p: [-5.03, 42.371], name: 'Sahagún' },
  { p: [-5.5671, 42.5987], name: 'León', show: true, side: 'top' },
  { p: [-6.056, 42.457], name: 'Astorga' },
  { p: [-6.59, 42.546], name: 'Ponferrada' },
  { p: [-7.043, 42.708], name: 'O Cebreiro' },
  { p: [-7.415, 42.781], name: 'Sarria' },
  { p: [-7.616, 42.807], name: 'Portomarín' },
  { p: [-8.164, 42.927], name: 'Arzúa' },
  { p: [-8.5446, 42.8806], name: 'Santiago de Compostela', show: true, side: 'top' },
];
const FRAME = { top: 240, bottom: 280, left: 210, right: 210 };
const STAGES = 33; // the traditional split of the Camino Francés into daily stages

export default async (s) => {
  const route = await s.route(WAY.map((w) => w.p), { profile: 'foot' });
  const [first, last] = [WAY[0], WAY.at(-1)];

  s.camera.set({ fit: route, padding: FRAME });
  s.line(route, { color: s.c.dim, width: 2.2, dash: [1, 2.5], at: 0.6, dur: 1.2 }); // the whole way, quietly, from the first shot
  const line = s.line(route, { color: s.c.amber, width: 5, glow: 0.6 });
  line.draw({ at: 4.2, dur: 11.3, ease: 'linear' });

  s.camera.to({ center: first.p, zoom: 8.4, pitch: 48, bearing: -8 }, { at: 1.6, dur: 2.6 });
  s.camera.follow(line, { zoom: 8.4, pitch: 48 });
  s.mover(line, { icon: 'arrow', size: 30, color: s.c.amber });
  s.camera.to({ fit: route, padding: FRAME, pitch: 0, bearing: 0 }, { at: 15.8, dur: 2.6 });

  s.points(WAY.filter((w) => !w.show).map((w) => ({ lng: w.p[0], lat: w.p[1] })), { at: (d) => line.timeAt([d.lng, d.lat]), size: 3.5, color: s.c.paper });
  s.pin(last.p, last.name, { at: 1, end: 3.2, kind: 'ring', side: 'top', color: s.c.paper }); // destination shown in the opening shot
  for (const w of WAY.filter((d) => d.show)) {
    s.pin(w.p, w.name, {
      at: w === first ? 0.7 : line.timeAt(w.p), kind: w === first || w === last ? 'ring' : 'dot', side: w.side, color: s.c.paper,
      sub: w === first ? 'km 0 · França' : `km ${Math.round(line.kmAt(w.p))}`,
    });
  }

  s.caption('Caminho de Santiago', { at: 0.5, end: 3.9, sub: 'Caminho Francês · dos Pireneus à Galícia' });
  s.counter({ follow: line, to: route.km, unit: 'km', at: 4.2, pos: 'br', color: s.c.amber, label: 'a pé desde Saint-Jean' });
  s.caption('De Saint-Jean a Santiago', { at: 16.4, sub: `cerca de ${STAGES} dias de caminhada` });
};
