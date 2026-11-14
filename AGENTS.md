# map-bamba — guide for AI agents

You write one small JavaScript file (a *scene*); map-bamba renders it to a 1080p video on real map
data (real streets, buildings, places, terrain). Everything you need is on this page.

## Workflow (do exactly this)

```bash
npm install                      # once. Needs Node 20+, ffmpeg on PATH, Chrome/Edge (or: npx playwright-core install chromium)
node bin/bamba.js doctor         # once. Confirms GPU / ffmpeg / network
node bin/bamba.js new my-scene   # creates scenes/my-scene.js from the template
node bin/bamba.js sheet scenes/my-scene.js            # → out/my-scene.sheet.jpg  (9 frames in ONE image)
node bin/bamba.js still scenes/my-scene.js -t 7.5     # → full-res PNG of one moment, when you need detail
node bin/bamba.js render scenes/my-scene.js           # → out/my-scene.mp4  (30–60 s for a 20 s video)
```

**Always look at the sheet before rendering.** It is one image; read it, fix the scene, repeat. Use
`--times 2,6.5,14` to pick moments and `-n 12` for more frames. Sheet frames are small: to judge small
text (pin subs, units) use `still`. A misspelt option or preset fails at once with the valid names and
the line in your scene.
First run of a scene downloads tiles/data (slower); everything is cached in `.bamba-cache/` afterwards.

## Anatomy of a scene

```js
export const config = { duration: 20, buildings: '3d', lang: 'pt', locale: 'pt-BR' };

export default async (s) => {
  const route = await s.route(['Praça de Boa Viagem, Recife', 'Praça de Casa Forte, Recife']); // real streets
  s.camera.set({ fit: route, padding: 170 });                 // where the camera starts
  const line = s.line(route, { width: 6, glow: 0.8 });        // a thing on the map
  line.draw({ at: 5, dur: 10 });                              // …that animates
  s.camera.follow(line, { zoom: 15.5, pitch: 58, bearing: 'auto' });
  s.caption('De Boa Viagem a Casa Forte', { at: 0.5, end: 5 });
  s.counter({ follow: line, to: route.km, unit: 'km', decimals: 1, at: 5, pos: 'br' });
};
```

Rules of the model:

- Coordinates are always `[lng, lat]`.
- You *declare* everything up front; nothing runs "live". Every element takes `at` (seconds, when it
  appears), `dur` (how long its entrance takes), `end` (when it starts leaving), `outDur`, `ease`.
  Screen and pinned elements also take `color`.
- Sizes are in px at 1920×1080.
- Colours: `s.c.signal amber ice mint rose violet` (accents), `s.c.paper dim` (neutrals),
  `s.c.accent fg bg` (theme). `s.c.mix(a, b, 0.5)`, `s.c.alpha(c, 0.4)`.

## config

| key | default | notes |
|---|---|---|
| `duration`, `fps`, `size` | `20`, `30`, `[1920, 1080]` | `size: [1080, 1920]` for vertical |
| `theme` | `'ink'` | `ink` (#151515) · `paper` (light) · `night` (navy) · `blueprint`, or `{ bg, fg, accent }` |
| `bg`, `fg`, `accent` | — | override one colour; the whole map palette is re-derived from `bg` |
| `labels` | `'all'` | `'all'` · `'places'` · `'none'` · `{ countries, states, cities, hoods, streets, water, pois }` (only listed keys are on) |
| `buildings` | `'2d'` | `'3d'` = extruded 2.5D city (use with `pitch`) · `false` |
| `terrain` | `false` | `1.4` = real 3D relief, exaggerated 1.4× (mountains; use with `pitch`) |
| `hillshade` | `true` | relief shading; number = strength (0.5) · `false` |
| `globe` | `false` | spherical Earth (zoom ≲ 5 shows the ball). `graticule: true` adds lat/lng lines |
| `roads`, `rail`, `boundaries`, `landcover` | `true` | switch map layers off for calmer maps |
| `lang`, `locale` | `'en'`, `'en-US'` | map label language · number/date formatting |
| `credit` | `true` | text added before "© OpenStreetMap" (e.g. `'Data: USGS'`); `false` hides it |
| `scrim`, `margin` | `true`, `72` | soft gradient behind edge text · safe margin |
| `post` | `{ vignette: 0.3, grain: 0.022 }` | `grainMotion: true` = animated film grain (bigger files) |

## Real data — all async, cached on disk

```js
await s.geocode('Marco Zero, Recife')            // → [lng, lat] (+ .name, .bbox). Array in → array out
await s.place('Le Marais, Paris')                // → { name, center, bbox, geojson } real outline: country/state/city/district/park/building
await s.route([a, b, …], { profile: 'car' })     // 'car' | 'bike' | 'foot'; 2+ points or address strings (long multi-stop routes are fine)
                                                 // → GeoJSON LineString Feature: route.geometry.coordinates, route.km, route.minutes,
                                                 //   route.stops (your input points as [lng, lat], in order)
await s.pois({ tags: 'amenity=cafe', within: place })               // real establishments → [{ lng, lat, name, tags }]
await s.pois({ tags: ['amenity=bar', 'amenity=pub'], around: [lng, lat], radius: 800 })
await s.countries('BR', 'AR')                    // Natural Earth outlines → Feature[] (props: name, name_pt, iso2, iso3, continent, pop)
await s.load('https://…/data.geojson')           // any JSON/GeoJSON/CSV; or './data/file.json' next to the scene
s.arc(a, b)                                      // great-circle path (flights, shipping)
s.geo.spline([[lng, lat], …])                    // smooth curve through hand-placed waypoints (sea routes, historic voyages)
```

`pois` tags are OpenStreetMap tags: `amenity=restaurant|cafe|bar|pharmacy|school|hospital`,
`shop=bakery|supermarket`, `tourism=museum|hotel|attraction`, `railway=station`, `leisure=park`…
Geometry helpers in `s.geo`: `haversine(a,b)` km · `bbox(g)` · `centroid(g)` · `area(g)` km² ·
`inside(pt, g)` · `circle(center, km)` · `bearing(a,b)` · `greatCircle` · `spline`.

## Camera

```js
s.camera.set({ center: [lng, lat], zoom: 12, pitch: 0, bearing: 0 })   // start view
s.camera.set({ fit: geometryOrBbox, padding: 160 })                    // …or frame something (padding px or {top,bottom,left,right})
s.camera.to({ center, zoom, pitch, bearing }, { at: 2, dur: 4 })       // fly there (zooms out and back in when far)
s.camera.to({ zoom: '+0.5', bearing: '+30' }, { at: 8, dur: 6 })       // strings = relative to wherever it is
s.camera.follow(line, { zoom: 15.5, pitch: 58, bearing: 'auto' })      // ride the head of a drawing line
s.camera.orbit({ at: 0, dur: 20, by: 90 })                             // rotate around the centre
s.camera.drift({ at: 0, dur: 20, zoom: '+0.15' })                      // slow push so a held shot stays alive
```

Zoom scale: 1–3 world · 4–6 country · 8–10 region · 11–13 city · 14–16 streets · 17+ buildings.
Map labels exist only in their zoom range: countries ≤ 7 · states 4–9 · cities 3–14 · hoods 11+ · streets 13.5+.
`follow` runs for the line's draw time (or your `at`/`dur`), keeps any property you don't pass
(e.g. the current bearing) and holds the final position until the next `camera.to`.
`pitch` 0 = top-down, 55–65 = cinematic 2.5D (needs `buildings: '3d'` or `terrain`). Moves on
different properties overlap freely (orbit + zoom). Default ease is `glide`.
`fit` ignores pitch: when tilted, pass `center` + `zoom` instead, or add `zoomOffset: 0.5`.

## On the map (drapes on terrain/globe, sits under labels)

```js
const line = s.line(geom, { color, width: 5, glow: 0.8, dash: [2, 2] })   // geom: coords | Feature | route | arc. dash = [on, off] in line widths
line.draw({ at: 2, dur: 8 })          // draws itself (ease 'inOutSine'; pass ease: 'linear' for constant speed).
                                      // line.draw({ to: 0.5 }) then again later to continue. Without draw() the whole line just fades in at `at`.
line.erase({ at: 14, dur: 2 })        // tail chases head
line.timeAt([lng, lat])               // WHEN the drawing head reaches a place (or a 0..1 fraction) → use as `at` for pins along a route
line.kmAt([lng, lat])                 // distance from the start to that place · line.km total
line.progress(t)                      // fraction drawn at time t, 0..1 · line.headAt(t) → [lng, lat] of the head

s.area(geom, { color, fill: 0.3, stroke: true, strokeWidth: 1.6, hatch: true, glow: 0.7, dash, at, end })
  .frames([{ at: 2, data: geojsonA }, { at: 2.1, data: geojsonB }, …])    // time-varying shape (front lines, floods, growth)

s.points(items, {                     // items: [[lng,lat]] | [{lng, lat, …}] | GeoJSON points
  at: (d, i) => 2 + i * 0.02,         // per-point appear time (or a number + `stagger`)
  size: (d) => 3 + d.mag, color: (d) => …,   // numbers or functions
  pulse: true, glow: 0.8,             // ring burst on appear, soft halo
  label: 'name', labelMinZoom: 15,    // real names next to dots (collision-aware)
})

s.extrude(geom, { height: 381, color, at, dur })      // 3D block growing from the ground (highlight a building footprint from s.place)
s.buildingsRise({ at: 0.2, dur: 2.5 })                // the whole 3D city grows in
```

`slot` puts map elements in the layer stack: `'low'` (under water & roads — default for areas, so
coastlines stay crisp) · `'mid'` (over roads) · `'top'` (under labels — default for lines/points) · `'over'`.

## Pinned to the map (labels, pins, movers)

```js
s.pin([lng, lat], 'Marco Zero', { at: 2, sub: 'Recife Antigo', kind: 'dot', side: 'right' })
s.label([lng, lat], 'PLACE DES VOSGES', { at: 3, style: 'place' })        // text only, centred on the point
s.pin(p, 'Canal de Suez', { offset: [70, -60], style: 'note' })           // label displaced with a leader line
s.pin(p, 'Empire State', { kind: 'stem', alt: 381, sub: '381 m · 1931' }) // alt = metres above ground (roof labels)
s.mover(line, { icon: 'plane', size: 44 })                                // rides the line as it draws; rotates to heading
```

- `kind`: `dot` · `ring` · `pulse` (radiating) · `stem` (vertical leader, label on top — best in 2.5D) · `none`
- `side`: `right` `left` `top` `bottom` `center` · `style`: `city` · `place` (spaced caps) · `water` (serif italic) · `note` · `tag` (mono)
- `icon`: `plane` · `arrow` · `ship` · `car` · `dot`, or your own SVG string (48×48, pointing up). `end` hides it.

## On the screen (text, numbers, keys)

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

- Text `style`: `caption` (38px) · `title` (68px) · `note` (24px) · `serif` (italic) · `quote` · `mono`
- Text `in`: `rise` (default) · `mask` · `fade` · `blur` · `words` · `chars` · `type` · `track` · `wipe` · `none` — `out`: `fade` · `blur` · `drop` · `wipe`
- Extras: `size`, `color`, `weight`, `upper`, `tracking`, `font: 'sans'|'serif'|'mono'`, `italic`, `width` (wrap), `align`, `offset: [x, y]`, `plate: false`

## Easing

`glide` (camera default) · `inOut` `in` `out` · `inOutSine` `outSine` · `inOutCubic` `outCubic` ·
`outQuart` `outQuint` `outExpo` · `outBack` `spring` (overshoot) · `linear`, or any `(p) => p`.

## Design rules (what makes it look expensive instead of generated)

1. **The map is the hero.** No centred title cards, no "eyebrow + giant headline", no boxes, badges
   or emoji. Words live small in a corner; `caption` + `sub` is usually all the text a shot needs.
2. **One accent colour per scene** (a second only to compare two things). Everything else stays neutral.
3. **Show numbers, not adjectives.** A counter, a date or a `%` beats a sentence.
4. **Never a frozen frame.** Add `camera.drift` or a slow `orbit` under static shots; end with ≥2 s of hold.
5. **Stage it.** Establish the place (0–2 s) → reveal the subject → land on the conclusion. Stagger
   entrances by 0.3–0.6 s instead of showing everything at once.
6. **Turn the map down to turn the story up.** Use `labels: { countries: true }` or `'none'`,
   `roads: false` at country/world scale; keep `streets` only at zoom ≥ 14.
7. **Short, real, specific text.** Sentence case, ≤ 6 words, real names and units, in the viewer's
   language (`lang`, `locale`). Credit non-OSM data with `credit`.
8. **2.5D needs light and height**: `buildings: '3d'` or `terrain` + `pitch: 55–65` + a little `bearing`.

## Recipes

| I want… | Use |
|---|---|
| A to B through real streets | `s.route` → `s.line().draw()` + `camera.follow` + `s.mover` + `s.counter({ follow })` — `examples/02` |
| A journey with stops | one `s.route([...stops])`, then per stop `s.pin(p, name, { at: line.timeAt(p), sub: `km ${Math.round(line.kmAt(p))}` })` |
| A flight | `config.globe` + `s.arc(a, b)` + `mover({ icon: 'plane' })` — `examples/03` |
| Territory changing over time | `s.area().frames([...])` + `s.date` + `s.timebar` + `s.legend` — `examples/01` |
| Mountains / a climb | `config.terrain` + `pitch` + `camera.orbit` — `examples/04` |
| Every café / shop / station in an area | `s.place` + `s.pois` + `s.points({ label: 'name' })` — `examples/05` |
| Countries lighting up | `s.countries` + `s.area({ at })`, `theme: 'paper'` — `examples/06` |
| Comparing two routes | two `s.line` in two accents + two counters — `examples/07` |
| A skyline | `buildings: '3d'` + `orbit` + `s.extrude(place)` + `pin({ kind: 'stem', alt })` — `examples/08` |
| Events over time (quakes, launches) | `s.points({ at: (d) => …, pulse })` + `s.date` + `s.ticker` — `examples/09` |
| Space → street zoom | `config.globe` + one long `camera.to` (`curve: 1`) — `examples/10` |

## Troubleshooting

- *Sheet frame looks empty / wrong place* → check `[lng, lat]` order; print values with `console.log` (shown in the CLI as warnings when prefixed `[bamba]`).
- *geocode found the wrong thing* → add city/country to the query, or pass coordinates.
- *Labels overlap my text* → move text to another `pos`, or reduce `labels`.
- *Tilted `fit` is too far/close* → use `center` + `zoom`.
- *Slow first render* → tiles are being downloaded once; re-runs are cached. `--offline` forbids network.
- `--scale 2` renders 4K · `--fps 60` · `--from 4 --to 8` renders a slice · `--crf 18` higher quality (default 23).
