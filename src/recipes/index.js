// Recipes: complete, art-directed videos driven by a few lines of JSON (a "brief").
//   { "recipe": "route", "stops": ["Praça de Boa Viagem, Recife", "Praça de Casa Forte, Recife"], "title": "…" }
// Each recipe is an ordinary scene function (s, P) — `bamba eject` copies one out for hand-tuning.
import * as route from './route.js';
import * as flight from './flight.js';
import * as zoom from './zoom.js';
import * as highlight from './highlight.js';
import * as pois from './pois.js';
import * as orbit from './orbit.js';
import * as events from './events.js';
import * as compare from './compare.js';
import * as tour from './tour.js';

export const RECIPES = { route, flight, tour, zoom, highlight, pois, orbit, events, compare };

/** Keys every brief accepts, on top of the recipe's own. */
export const COMMON = {
  recipe: 'REQUIRED. one of: ' + Object.keys(RECIPES).join(', '),
  lang: 'language of map labels and number formats: "en" (default), "pt", "es", "fr", "de", "it"',
  accent: 'signal | amber | ice | mint | rose | violet, or #hex',
  theme: 'ink (default, #151515) | paper | night | blueprint', bg: 'any background colour, e.g. "#102418"',
  duration: 'seconds, default 20', size: '"vertical" | "square" | [w, h] (default 1920×1080)',
  credit: 'data credit shown before "© OpenStreetMap"',
};

/** Validate a brief; returns its recipe module. */
export function recipeFor(P) {
  if (!P || typeof P !== 'object' || !P.recipe) throw new Error(`A brief needs "recipe". Valid: ${Object.keys(RECIPES).join(', ')}`);
  const R = RECIPES[P.recipe];
  if (!R) throw new Error(`Unknown recipe "${P.recipe}". Valid: ${Object.keys(RECIPES).join(', ')}`);
  const ok = [...Object.keys(R.params), ...Object.keys(COMMON), 'locale', 'fg', 'labels', 'boundaries', 'from', 'to'];
  const bad = Object.keys(P).filter((k) => !ok.includes(k));
  if (bad.length) throw new Error(`recipe "${P.recipe}": unknown key${bad.length > 1 ? 's' : ''} ${bad.map((b) => `"${b}"`).join(', ')}. Valid: ${[...Object.keys(R.params), ...Object.keys(COMMON)].join(', ')}`);
  const missing = Object.entries(R.params).filter(([k, v]) => v.startsWith('REQUIRED') && P[k] == null).map(([k]) => k);
  if (missing.length) throw new Error(`recipe "${P.recipe}": missing ${missing.join(', ')}. Example: ${JSON.stringify(R.example)}`);
  return R;
}
