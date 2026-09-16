// Category vocabularies (CATS, REF_CATS, ALL_CATS, LIST_CATS, RANDOM_CAT)
// live in core/constants.js, which is also inlined into index.html.

import { CATS, LIST_CATS, RANDOM_CAT } from "./constants.js";
import { getLSJSON, setLSJSON } from "./storage.js";

const STATE_KEY = "filmroulette_state";
export const RESOLVED_HIST_KEY = "filmroulette_resolved_history";

function loadState() {
  const s = getLSJSON(STATE_KEY, null);
  if (!s) return { cat: "movies", view: "home", spinCat: RANDOM_CAT };
  // "random" used to be its own view alongside three per-category spin views;
  // both now fold into a single "spin" view with a category picker.
  const view = s.view === "random" ? "spin" : (s.view || "home");
  let spinCat = s.spinCat || (s.view === "random" ? RANDOM_CAT : null);
  if (!spinCat) spinCat = (s.view === "spin" && CATS[s.cat]) ? s.cat : RANDOM_CAT;
  return { cat: LIST_CATS[s.cat] ? s.cat : "movies", view, spinCat };
}

export const initial = loadState();

// Mutable cross-module UI state, grouped into one object. Plain top-level
// `let` bindings can only be reassigned by the module that declares them —
// ESM imports are live but read-only from the importing side — so anything
// other files need to *write* (not just read) has to live on a shared
// object instead. Access as `uiState.currentCat`, `uiState.spinCat`, etc.
export const uiState = {
  // Item counts per category from /api/categories, filled in by menu.js once
  // the first request lands. Empty categories are dropped from the roulette
  // picker (spinning an empty list 404s server-side anyway) — which is what
  // makes "Мульты" disappear on its own once the last cartoon has been
  // watched off the list, and come back the moment one is added again.
  categoryCounts: null,
  currentCat: initial.cat,
  currentView: initial.view,
  spinCat: initial.spinCat,
  currentCardData: null,
  // Remembers the category the list screen itself was last showing (set only
  // by picking a chip inside "Списки"), independent of `currentCat`, which
  // also gets overwritten while browsing a Marvel/DC showcase. Without this,
  // opening the showcase and then the main-menu "Списки" item would silently
  // land you on the showcase's category instead of your actual list.
  lastListCat: initial.view === "list" ? initial.cat : "movies",
};

export function isCatEmpty(code) {
  return !!uiState.categoryCounts && uiState.categoryCounts[code] === 0;
}

export function spinnableCats() {
  return Object.keys(CATS).filter((c) => !isCatEmpty(c) || c === uiState.spinCat);
}

// Categories offered by the list picker. Unlike the roulette, an empty
// category stays visible — the list screen is the only place to refill it.
export function listCats() {
  return Object.keys(LIST_CATS);
}

export function saveState() {
  setLSJSON(STATE_KEY, { cat: uiState.currentCat, view: uiState.currentView, spinCat: uiState.spinCat });
}

export function isRandomSpin() {
  return uiState.spinCat === RANDOM_CAT;
}
