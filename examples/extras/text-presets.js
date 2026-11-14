// Every text style and entrance preset in one scene (reference for docs/presets.jpg).
export const config = { duration: 12, labels: 'none', roads: false, credit: false };

export default async (s) => {
  s.camera.set({ center: [12.5, 41.9], zoom: 4.6 });
  s.camera.drift({ at: 0, dur: 12, zoom: '+0.2' });

  s.title('Title — mask', { pos: 'tl', at: 0.3, in: 'mask', sub: 'sub line, serif italic' });
  s.caption('Caption — rise', { pos: 'l', at: 0.9, in: 'rise', sub: 'the default for captions' });
  s.text('Serif — blur', { pos: 'bl', at: 1.5, style: 'serif', in: 'blur' });
  s.note('Note — fade. Quiet supporting copy.', { pos: 'bl', at: 2.1 });

  s.text('Words arrive one by one', { pos: 't', at: 2.7, in: 'words' });
  s.text('Characters cascade', { pos: 't', at: 3.6, in: 'chars' });
  s.text('40.7128° N  74.0060° W', { pos: 'c', at: 4.4, style: 'mono', in: 'type' });
  s.text('Tracking settles', { pos: 'b', at: 5.2, in: 'track', upper: true, tracking: 0.14, size: 26 });
  s.text('Wipe reveal', { pos: 'b', at: 6, in: 'wipe', end: 9.5, out: 'wipe' });

  s.text('“Quote style, for a line worth reading.”', { pos: 'tr', at: 6.6, style: 'quote', in: 'mask', width: 620 });
  s.counter({ to: 18492, unit: 'km', label: 'counter', at: 7.2, dur: 3, pos: 'r' });
  s.date({ from: '2022-02-24', to: '2026-11-01', at: 7.6, dur: 3, pos: 'br', size: 54 });
  s.legend([{ color: s.c.signal, label: 'fill', kind: 'fill' }, { color: s.c.signal, label: 'hatch', kind: 'hatch' }, { color: s.c.amber, label: 'line', kind: 'line' }, { color: s.c.ice, label: 'dash', kind: 'dash' }, { color: s.c.mint, label: 'dot', kind: 'dot' }], { pos: 'br', at: 8.2 });

  s.pin([12.5, 41.9], 'dot · city', { at: 1, sub: 'with sub' });
  s.pin([2.35, 48.86], 'ring · note', { at: 1.4, kind: 'ring', style: 'note', side: 'left' });
  s.pin([23.7, 38.0], 'pulse · tag', { at: 1.8, kind: 'pulse', style: 'tag', side: 'bottom' });
  s.pin([19.0, 47.5], 'stem', { at: 2.2, kind: 'stem' });
  s.label([17.5, 34.6], 'water style', { at: 2.6, style: 'water' });
  s.label([3.0, 39.6], 'place style', { at: 3, style: 'place' });
  s.pin([28.9, 41.0], 'leader', { at: 3.4, offset: [60, -50], style: 'note' });
};
