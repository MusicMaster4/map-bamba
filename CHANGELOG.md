# Changelog

## 0.2.0

### Fewer tokens per video
- **Recipes and briefs.** Nine recipes (`route`, `flight`, `tour`, `zoom`, `highlight`, `pois`,
  `orbit`, `events`, `compare`) turn a few lines of JSON into a complete, art-directed video.
  `bamba recipes`, `bamba brief <recipe> [name]`, `bamba eject <brief.json>`; inside a scene file,
  `await s.recipe({ … })`.
- **`bamba check`.** A text report instead of an image: text that leaves the frame or overlaps,
  labels under on-screen text, pins that appear off-camera, lines drawn outside the shot, what each
  place name was geocoded to, and the timeline. `bamba sheet` prints the same list.
- **Smarter contact sheet.** Frames are the moments where something has just arrived, not evenly
  spaced ones, and the sheet is 1568 px wide (the size vision models keep).
- **Automatic label placement.** Pins created without `side` take the side that collides least
  with other labels, on-screen text and the frame edge.
- **Docs in two tiers.** `AGENTS.md` is the short guide; `docs/API.md` is the reference, printable by
  topic with `bamba help <topic>`.

### Faster rendering
- Frames are composed in one canvas (Chrome's HTML-in-canvas) and read back from the GPU as
  YUV 4:2:0 (BT.709), then streamed raw into the encoder: no screenshots, no PNG encode/decode, no
  CPU colour conversion. Browsers without the API fall back to screenshots.
- The map is drawn once per frame (MapLibre's own animation-frame renders are suppressed, and the
  frame is complete as soon as one draw finds everything loaded).
- Line reveals are a colour ramp along the line (a paint change) rather than new geometry per frame.
- Idle workers steal half of the busiest worker's remaining frames; the default worker count follows
  free video memory.
- Colour conversion to YUV now uses the BT.709 matrix the files are tagged with.
- Measured on the ten examples (RTX 3070, idle GPU): 329.7 s → 134.3 s in total, 2.45× faster, with the
  same encoder settings. The encoder is now the limit.

### Looks
- Contact shadows under 2.5D buildings; a light filament and a lit tip on drawing lines; bloom on
  dark themes (`post.bloom`); outlines that trace themselves before the fill arrives (`area` `in: 'draw'`);
  a follow camera that looks ahead (`ahead`); one ripple as a pin lands.
- Optional motion blur (`bamba render --blur 8`, experimental) and fades from/to the background (`config.fade`).

### API additions
`s.configure()`, `s.brief()`, `s.recipe()`, `line.timeAt()`, `line.kmAt()`, `camera.follow({ ahead })`,
`area({ in })`, `line({ core, head })`, pin `textSize`, `config.fade`, `post.bloom`.

## 0.1.0

First release: scene runtime, GPU renderer, data tools, ten example scenes.
