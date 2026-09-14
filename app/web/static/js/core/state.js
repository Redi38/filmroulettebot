// Category vocabularies (CATS, REF_CATS, ALL_CATS, LIST_CATS, RANDOM_CAT)
// live in core/constants.js, which is also inlined into index.html.

const STATE_KEY = "filmroulette_state";
const RESOLVED_HIST_KEY = "filmroulette_resolved_history";

// Item counts per category from /api/categories, filled in by menu.js once the
// first request lands. Empty categories are dropped from the roulette picker
// (spinning an empty list 404s server-side anyway) — which is what makes
// "Мульты" disappear on its own once the last cartoon has been watched off
// the list, and come back the moment one is added again.
let categoryCounts = null;

function isCatEmpty(code) {
  return !!categoryCounts && categoryCounts[code] === 0;
}

// Categories offered by the roulette picker: "Наугад" plus every spinnable
// category that still has something in it. Until counts arrive, show all.
function spinnableCats() {
  return Object.keys(CATS).filter((c) => !isCatEmpty(c) || c === spinCat);
}

// Categories offered by the list picker. Unlike the roulette, an empty
// category stays visible — the list screen is the only place to refill it.
function listCats() {
  return Object.keys(LIST_CATS);
}

function loadState() {
  const s = getLSJSON(STATE_KEY, null);
  if (!s) return {cat: "movies", view: "home", spinCat: RANDOM_CAT};
  // "random" used to be its own view alongside three per-category spin views;
  // both now fold into a single "spin" view with a category picker.
  const view = s.view === "random" ? "spin" : (s.view || "home");
  let spinCat = s.spinCat || (s.view === "random" ? RANDOM_CAT : null);
  if (!spinCat) spinCat = (s.view === "spin" && CATS[s.cat]) ? s.cat : RANDOM_CAT;
  return {cat: LIST_CATS[s.cat] ? s.cat : "movies", view, spinCat};
}
function saveState() {
  setLSJSON(STATE_KEY, {cat: currentCat, view: currentView, spinCat});
}

const initial = loadState();
let currentCat = initial.cat;
let currentView = initial.view;
let spinCat = initial.spinCat;
let currentCardData = null;

function isRandomSpin() {
  return spinCat === RANDOM_CAT;
}
