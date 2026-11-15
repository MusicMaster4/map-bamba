# map-bamba API reference

For scene files (`.js`). Most videos need only a brief — see `AGENTS.md`. Print one section with
`node bin/bamba.js help <topic>`.

## Scene basics

```js
export const config = { duration: 20, buildings: '3d', lang: 'pt', locale: 'pt-BR' };   // optional

export default async (s) => {
  const route = await s.route(['Praça de Boa Viagem, Recife', 'Praça de Casa Forte, Recife']);
  s.camera.set({ fit: route, padding: 170 });
  const line = s.line(route, { width: 6, glow: 0.8 });
  line.draw({ at: 5, dur: 10 });
  s.camera.follow(line, { zoom: 15.5, pitch: 58, bearing: 'auto' });
  s.caption('De Boa Viagem a Casa Forte', { at: 0.5, end: 5 });
  s.counter({ follow: line, to: route.km, unit: 'km', decimals: 1, at: 5, pos: 'br' });
};
```

- Coordinates are always `[lng, lat]`. Sizes are px at 1920×1080.
- Everything is declared up front. Every element takes `at` (seconds, when it appears), `dur` (how
  long its entrance takes), `end` (when it starts leaving), `outDur`, `ease`. Screen and pinned
  elements also take `color`.
- Colours: `s.c.signal amber ice mint rose violet` (accents), `s.c.paper dim` (neutrals),
  `s.c.accent fg bg` (theme), `s.c.mix(a, b, 0.5)`, `s.c.alpha(c, 0.4)`.
- `s.configure({ … })` sets config from inside the function (call it first).
  `await s.recipe({ recipe: 'route', … })` runs a recipe and returns its parts (`{ line, route }`…) so you can add to it.

## Config

| key | default | notes |
|---|---|---|
| `duration`, `fps`, `size` | `20`, `30`, `[1920, 1080]` | `size: [1080, 1920]` for vertical |
| `theme` | `'ink'` | `ink` (#151515) · `paper` (light) · `night` (navy) · `blueprint`, or `{ bg, fg, accent }` |
| `bg`, `fg`, `accent` | — | override one colour; the whole map palette is re-derived from `bg` |
| `labels` | `'all'` | `'all'` · `'places'` · `'none'` · `{ countries, states, cities, hoods, streets, water, pois }` (only listed keys are on) |
| `buildings` | `'2d'` | `'3d'` = extruded 2.5D city with contact shadows (use with `pitch`) · `false` |
| `terrain` | `false` | `1.4` = real 3D relief, exaggerated 1.4× (use with `pitch`) |
| `hillshade` | `true` | relief shading; number = strength · `false` |
| `globe` | `false` | spherical Earth (zoom ≲ 5 shows the ball). `graticule: true` adds lat/lng lines |
| `roads`, `rail`, `boundaries`, `landcover` | `true` | switch map layers off for calmer maps |
| `lang`, `locale` | `'en'`, `'en-US'` | map label language · number/date formatting |
| `credit` | `true` | text added before "© OpenStreetMap" (e.g. `'Data: USGS'`); `false` hides it |
| `fade` | — | `{ in: 0.5, out: 0.6 }` fades the video from / to the background colour |
| `post` | `{ vignette: 0.3, grain: 0.022, bloom: 0.2 }` | `bloom` = soft light around bright strokes (dark themes); `grainMotion: true` = animated grain |
| `scrim`, `margin` | `true`, `72` | soft gradient behind edge text · safe margin |

Map labels exist only in their zoom range: countries ≤ 7 · states 4–9 · cities 3–14 · hoods 11+ · streets 13.5+.

## Data

All async and cached on disk after the first run.

```js
await s.geocode('Marco Zero, Recife')            // → [lng, lat] (+ .name, .bbox). Array in → array out
await s.place('Le Marais, Paris')                // → { name, center, bbox, geojson }: real outline of a country/state/city/district/park/building
await s.route([a, b, …], { profile: 'car' })     // 'car' | 'bike' | 'foot'; 2+ points or addresses (long multi-stop routes are fine)
                                                 // → LineString Feature: route.geometry.coordinates, route.km, route.minutes, route.stops ([lng,lat] per input)
await s.pois({ tags: 'amenity=cafe', within: place })                              // real establishments → [{ lng, lat, name, tags }]
await s.pois({ tags: ['amenity=bar', 'amenity=pub'], around: [lng, lat], radius: 800 })
await s.countries('BR', 'AR')                    // Natural Earth outlines → Feature[] (props: name, name_pt, iso2, iso3, continent, pop)
await s.load('https://…/data.geojson')           // any JSON/GeoJSON/CSV; or './data/file.json' next to the scene
s.arc(a, b)                                      // great-circle path (flights, shipping)
s.geo.spline([[lng, lat], …])                    // smooth curve through hand-placed waypoints
```

OSM tags for `pois`: `amenity=restaurant|cafe|bar|pharmacy|school|hospital`, `shop=bakery|supermarket`,
`tourism=museum|hotel|attraction`, `railway=station`, `leisure=park`…
`s.geo`: `haversine(a,b)` km · `bbox(g)` · `centroid(g)` · `area(g)` km² · `inside(pt, g)` · `circle(center, km)` · `bearing(a,b)`.

## Camera

```js
s.camera.set({ center: [lng, lat], zoom: 12, pitch: 0, bearing: 0 })   // start view
s.camera.set({ fit: geometryOrBbox, padding: 160 })                    // …or frame something (padding px or {top,bottom,left,right}); `fit` works in camera.to as well
s.camera.to({ center, zoom, pitch, bearing }, { at: 2, dur: 4 })       // fly there (zooms out and back in when far)
s.camera.to({ zoom: '+0.5', bearing: '+30' }, { at: 8, dur: 6 })       // strings = relative to wherever it is
s.camera.follow(line, { zoom: 15.5, pitch: 58, bearing: 'auto' })      // ride the head of a drawing line
s.camera.orbit({ at: 0, dur: 20, by: 90 })                             // rotate around the centre
s.camera.drift({ at: 0, dur: 20, zoom: '+0.15' })                      // slow push so a held shot stays alive
```

Zoom: 1–3 world · 4–6 country · 8–10 region · 11–13 city · 14–16 streets · 17+ buildings.
`pitch` 0 = top-down, 55–65 = cinematic 2.5D (needs `buildings: '3d'` or `terrain`). Moves on
different properties overlap freely (orbit + zoom). Default ease is `glide`.
`follow` runs for the line's draw time, keeps any property you don't pass, and holds the last
position until the next `camera.to`. With `bearing: 'auto'` the head sits below centre so the way
ahead is visible (`ahead: 0.13` = fraction of the frame height; `ahead: 0` centres it).
`fit` ignores pitch: when tilted, pass `center` + `zoom`, or add `zoomOffset: 0.5`.

## Line

```js
const line = s.line(geom, { color, width: 5, glow: 0.8 })   // geom: coords | Feature | route | arc
line.draw({ at: 2, dur: 8 })          // draws itself (ease 'inOutSine'; ease: 'linear' = constant speed). A soft light rides the tip.
                                      // line.draw({ to: 0.5 }) then again later to continue. Without draw() the line fades in at `at`.
line.erase({ at: 14, dur: 2 })        // tail chases head
line.timeAt([lng, lat])               // WHEN the drawing head reaches a place (or a 0..1 fraction) → `at` for pins along a route
line.kmAt([lng, lat])                 // distance from the start to that place · line.km total
line.progress(t)                      // fraction drawn at time t, 0..1 · line.headAt(t) → [lng, lat]
```

Options: `dash: [2, 2]` ([on, off] in line widths) · `glow` 0–1 · `core: false` (no light filament) ·
`head: false` (no tip light) · `casing` · `opacity` · `slot`.
`slot` places map elements in the layer stack: `'low'` (under water & roads — default for areas) ·
`'mid'` (over roads) · `'top'` (under labels — default for lines/points) · `'over'`.

## Area

```js
s.area(geom, { color, fill: 0.3, stroke: true, strokeWidth: 1.6, hatch: true, glow: 0.7, at, end })
  .frames([{ at: 2, data: geojsonA }, { at: 2.1, data: geojsonB }, …])    // time-varying shape (front lines, floods, growth)
```

By default the outline traces itself and the fill follows (`in: 'draw'`); `in: 'fade'` just fades.
`hatch: { spacing, width, opacity }` for a diagonal pattern; `dash` for a dashed outline.

## Points

```js
s.points(items, {                     // items: [[lng,lat]] | [{lng, lat, …}] | GeoJSON points
  at: (d, i) => 2 + i * 0.02,         // per-point appear time (or a number + `stagger`)
  size: (d) => 3 + d.mag, color: (d) => …,   // numbers or functions
  pulse: true, glow: 0.8,             // ring burst on appear, soft halo
  label: 'name', labelMinZoom: 15,    // real names next to dots (collision-aware)
})
s.extrude(geom, { height: 381, color, at, dur })      // 3D block growing from the ground (a footprint from s.place)
s.buildingsRise({ at: 0.2, dur: 2.5 })                // the whole 3D city grows in
```

## Pins and labels

```js
s.pin([lng, lat], 'Marco Zero', { at: 2, sub: 'Recife Antigo' })           // side chosen automatically; side: 'left' to force
s.label([lng, lat], 'PLACE DES VOSGES', { at: 3, style: 'place' })         // text only, centred on the point
s.pin(p, 'Canal de Suez', { offset: [70, -60], style: 'note' })            // label displaced with a leader line
s.pin(p, 'Empire State', { kind: 'stem', alt: 381, sub: '381 m · 1931' })  // alt = metres above ground (roof labels)
s.mover(line, { icon: 'plane', size: 44 })                                 // rides the line as it draws; rotates to heading
```

- `kind`: `dot` · `ring` · `pulse` (radiating) · `stem` (vertical leader, label on top — best in 2.5D) · `none`
- `side`: `right` `left` `top` `bottom` `center` (omit it: the clearest side is picked) · `style`: `city` · `place` (spaced caps) · `water` (serif italic) · `note` · `tag` (mono)
- `icon`: `plane` · `arrow` · `ship` · `car` · `dot`, or an SVG string (48×48, pointing up). `end` hides it.
- Bigger label: `textSize: 30` (default 25; `sub` scales with it). Pins stay until `end`.
- Pins along a route: `s.pin(p, name, { at: line.timeAt(p), sub: `km ${Math.round(line.kmAt(p))}` })`.

## Text and numbers

`pos` is a 3×3 grid: `tl t tr / l c r / bl b br`, or `[x, y]` px. Elements sharing a corner stack.

```js
s.caption('De Boa Viagem a Casa Forte', { at: 0.5, end: 6, sub: 'Recife, Pernambuco' })   // default bottom-left
s.title('…', { pos: 'bl' })       s.note('…', { pos: 'tr' })
s.text('…', { style: 'serif', in: 'mask', out: 'fade', pos: 'tl', size: 40, color: s.c.amber })
s.counter({ to: 1234, unit: 'km', label: 'percorridos', at: 2, dur: 8, pos: 'br', decimals: 1 })
s.counter({ follow: line, to: route.km, unit: 'km' })            // tied to a line's drawing progress
s.ticker({ value: (t) => items.filter((d) => d.t <= t).length, unit: 'cafés', pos: 'br' })   // any function of time
s.date({ from: '2022-02-24', to: '2026-11-01', at: 2, dur: 15, pos: 'tl', format: { month: 'short', year: 'numeric' } })
s.legend([{ color: s.c.signal, label: 'Ocupado', kind: 'fill' }], { pos: 'bl', at: 1 })      // kind: fill hatch line dash dot
s.timebar({ from: '2022-04-01', to: '2026-11-01', at: 2, dur: 15, marks: [{ at: '2023-05-20', label: 'Bakhmut' }] })
```

- `style`: `caption` (38px) · `title` (68px) · `note` (24px) · `serif` (italic) · `quote` · `mono`
- `in`: `rise` (default) · `mask` · `fade` · `blur` · `words` · `chars` · `type` · `track` · `wipe` · `none` — `out`: `fade` · `blur` · `drop` · `wipe`
- also: `size`, `color`, `weight`, `upper`, `tracking`, `font: 'sans'|'serif'|'mono'`, `italic`, `width` (wrap), `align`, `offset: [x, y]`, `plate: false`
- Text that takes turns in one corner: end each `outDur + 0.1` s before the next `at`, or they stack for a moment.

## Ease

`glide` (camera default) · `inOut` `in` `out` · `inOutSine` `outSine` · `inOutCubic` `outCubic` ·
`outQuart` `outQuint` `outExpo` · `outBack` `spring` (overshoot) · `linear`, or any `(p) => p`.

## Design rules

1. **The map is the hero.** No centred title cards, no "eyebrow + giant headline", no boxes, badges
   or emoji. Words live small in a corner; `caption` + `sub` is usually all the text a shot needs.
2. **One accent colour per scene** (a second only to compare two things). Everything else stays neutral.
3. **Show numbers, not adjectives.** A counter, a date or a `%` beats a sentence.
4. **Never a frozen frame.** Add `camera.drift` or a slow `orbit` under static shots; end with ≥ 2 s of hold.
5. **Stage it.** Establish the place (0–2 s) → reveal the subject → land on the conclusion. Stagger
   entrances by 0.3–0.6 s instead of showing everything at once.
6. **Turn the map down to turn the story up.** `labels: { countries: true }` or `'none'`,
   `roads: false` at country/world scale; keep `streets` only at zoom ≥ 14.
7. **Short, real, specific text.** Sentence case, ≤ 6 words, real names and units, in the viewer's
   language (`lang`, `locale`). Credit non-OSM data with `credit`.
8. **2.5D needs light and height**: `buildings: '3d'` or `terrain` + `pitch: 55–65` + a little `bearing`.

## Rendering and troubleshooting

- `bamba render` flags: `--scale 2` (4K) · `--fps 60` · `--from 4 --to 8` (a slice) · `--crf 18` (higher
  quality; default 23) · `--blur 8` (motion blur, experimental: 8 sub-frames per frame, several times the render time; fewer samples ghost on fast moves) · `--draft` (half size, fast preset) · `--workers n`.
- *Wrong place on the map* → check `[lng, lat]` order; `console.log('[bamba]', value)` prints in the CLI.
- *geocode found the wrong thing* → add city/country to the query, or pass coordinates.
- *Map labels under my text* → move the text to another `pos`, or reduce `labels`.
- *Tilted `fit` is too far/close* → use `center` + `zoom`.
- *Slow first run* → tiles are downloaded once; re-runs use the cache. `--offline` forbids network.
