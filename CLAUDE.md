# map-bamba

Read `AGENTS.md` first: it is the complete guide (workflow, API, design rules) for making a video with this repo.

- Scenes live in `scenes/` (yours) and `examples/` (reference). Outputs go to `out/`.
- Check work with `node bin/bamba.js sheet <scene>` and look at the JPG before rendering.
- Framework code: `src/runtime/` runs in the browser (scene API), `src/node/` is the CLI/renderer.
