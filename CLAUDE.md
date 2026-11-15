# map-bamba

Read `AGENTS.md` first: it is the short guide for making a video with this repo (briefs, recipes, checks).

- A video is a brief (`scenes/*.json`, uses a recipe) or a scene file (`scenes/*.js`, full API). Outputs go to `out/`.
- Verify with `node bin/bamba.js check <scene>` (text report, no image). `sheet` is for when you want to see it; it prints the same report.
- API by topic: `node bin/bamba.js help <topic>`; full reference in `docs/API.md`.
- Framework code: `src/runtime/` runs in the browser (scene API), `src/recipes/` are the recipes, `src/node/` is the CLI/renderer.
