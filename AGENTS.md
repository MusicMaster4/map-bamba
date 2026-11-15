# map-bamba — guide for AI agents

You turn a short request ("a 20 s video of the route from A to B") into a finished 1080p map video
on real map data. **Start with a recipe**: a brief of a few JSON lines is a complete, art-directed
video. Write scene code only when no recipe fits.

## 1 · The fast path: a brief

```bash
node bin/bamba.js brief route my-video      # writes scenes/my-video.json from the recipe's example
# edit the JSON (it is the whole video), then:
node bin/bamba.js check  scenes/my-video.json    # text report: problems + timeline. No image to read.
node bin/bamba.js render scenes/my-video.json    # → out/my-video.mp4
```

| recipe | makes | the keys that matter |
|---|---|---|
| `route` | A → B (→ C…) on real roads. City trip: 2.5D follow shot. Long journey: stop pins with km. | `stops: ["address" \| [lng,lat], …]`, `names`, `profile: car\|bike\|foot`, `terrain: true` for mountain roads |
| `flight` | great-circle legs on a globe, plane, km counter | `stops: ["city", …]`, `names`, `subs` (e.g. airport codes) |
| `tour` | the camera visits several places in 2.5D, naming each, then shows them all | `stops: [{ q: "place, city", name, sub, value }]`, `unit`, `total` |
| `zoom` | one continuous zoom from space to a place | `to: "place"`, `steps: ["Terra", "Brasil", …]` |
| `highlight` | countries / regions lighting up group by group | `groups: [{ label, places: ["BR", "Bavaria, Germany", …] }]`, `unit` |
| `pois` | every real café / museum / station in an area, counted | `area: "Le Marais, Paris"`, `tags: "amenity=cafe"`, `unit` |
| `orbit` | orbit over a 2.5D skyline with labelled buildings | `center`, `landmarks: [{ q, name, height, sub }]` |
| `events` | dated points appearing in time (quakes, openings…) | `data: url \| [...]`, `fields: { time, size }`, `unit` |
| `compare` | 2–3 routes between the same ends, each with its km | `routes: [{ label, stops \| arc \| path }]` |

Every brief also takes `title`, `sub`, `lang` (`"pt"`, `"en"`, …: map labels + number format),
`accent` (`signal amber ice mint rose violet` or `#hex`), `theme` (`ink paper night blueprint`), `bg`,
`duration`, `size` (`"vertical"`, `"square"`), `credit`. `bamba brief <recipe>` prints every key.
`names` / `subs` follow the order of `stops`.

```json
{ "recipe": "route", "stops": ["Praça de Boa Viagem, Recife", "Praça de Casa Forte, Recife"],
  "title": "De Boa Viagem a Casa Forte", "sub": "Recife, Pernambuco", "lang": "pt" }
```

Write on-screen text in the viewer's language and pass real names: `names`, `title`, `sub`, `unit`.

## 2 · Checking without spending tokens

1. `bamba check <scene>` — always. It finds text that leaves the frame or collides, pins that appear
   off-camera, lines drawn outside the shot; it prints what each place name was resolved to and the
   timeline. Fix what it lists.
2. `bamba sheet <scene>` — once, when you want to *see* it: 9 key moments in one 1568 px image
   (`--times 3,9.5` to choose). It prints the same problem list.
3. `bamba still <scene> -t 7.5` — only to judge small text or one detail at full resolution.
4. `bamba render <scene>` — when check is clean. Typically 10–30 s for a 20 s video (longer if the GPU is busy).

A wrong key, preset or recipe name fails at once and prints the valid ones. Tiles and data are
cached in `.bamba-cache/`, so only the first run of a scene needs the network.

## 3 · When no recipe fits

- **Close to a recipe?** `bamba eject scenes/my-video.json` turns the brief into an ordinary scene
  file (the recipe's own code with your values); change only what you need.
- **Recipe plus extras?** In a scene file: `const { line } = await s.recipe({ recipe: 'route', stops: [...] })`,
  then add your own `s.pin(…)`, `s.note(…)`.
- **Something new?** `bamba new my-scene`, then read only the API you need:
  `bamba help camera` · `line` · `area` · `points` · `pins` · `text` · `data` · `config` · `design`
  (or the whole reference, `docs/API.md`). `examples/` has ten complete scenes; `examples/briefs/` one brief per recipe.

```js
// scenes/my-scene.js — the shape of every scene file
export const config = { duration: 20, lang: 'pt', locale: 'pt-BR' };
export default async (s) => {
  const a = await s.geocode('Marco Zero, Recife');              // real data, cached
  s.camera.set({ center: a, zoom: 12.5 });
  s.camera.to({ zoom: 15.6, pitch: 55 }, { at: 0.5, dur: 4 });  // everything is declared with `at` (seconds)
  s.pin(a, 'Marco Zero', { at: 2, sub: 'Recife Antigo' });      // label side is chosen automatically
  s.caption('Onde a cidade começou', { at: 1 });
};
```

## 4 · Taste (what recipes already do, and custom scenes must)

The map is the hero: no title cards, no eyebrow-over-headline, no boxes or emoji. Small text in a
corner, one accent colour, real numbers instead of adjectives, a camera that never fully stops, and
a 2 s hold at the end. `bamba help design` has the full list.
