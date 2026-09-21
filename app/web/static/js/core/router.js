import { CATS, LIST_CATS, RANDOM_CAT } from "./constants.js";
import { openHistoryPanel } from "../history/panel.js";
import { renderMenu } from "./menu.js";
import { uiState } from "./state.js";
import { showSection } from "./views.js";

// Views whose hash carries a category. The roulette is in this list too, but
// its category lives in `uiState.spinCat` rather than `uiState.currentCat` — picking "Наугад"
// or "Сериалы" on the wheel must not silently retarget the watchlist.
export const VIEWS_WITH_CAT = ["list", "showcase"];

export function hashCatFor(view) {
  if (view === "spin") return uiState.spinCat;
  return VIEWS_WITH_CAT.includes(view) ? uiState.currentCat : null;
}

function stateToHash(view, cat) {
  if (view === "spin") return `#/spin/${cat || uiState.spinCat}`;
  return VIEWS_WITH_CAT.includes(view) ? `#/${view}/${cat}` : `#/${view}`;
}

function hashToState(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  let view = parts[0] || "home";
  if (view === "random" || view === "history") view = "spin"; // legacy bookmarks from the old split views
  // "Ожидаемые" used to be its own view; it is now a chip on the list screen.
  if (view === "upcoming") return { view: "list", cat: "upcoming" };
  return { view, cat: parts[1] || null };
}

export function pushViewToHistory(view, cat) {
  const hash = stateToHash(view, cat);
  if (location.hash !== hash) {
    history.pushState({ view, cat }, "", hash);
  }
}

function adoptCat(view, cat) {
  if (!cat) return;
  if (view === "spin") {
    if (cat === RANDOM_CAT || CATS[cat]) uiState.spinCat = cat;
  } else if (LIST_CATS[cat]) {
    uiState.currentCat = cat;
    if (view === "list") uiState.lastListCat = cat;
  }
}

function applyHistoryState(view, cat) {
  if (view === "history") view = "spin";
  uiState.currentView = view;
  adoptCat(view, cat);
  renderMenu();
  showSection();
}

window.addEventListener("popstate", (e) => {
  const { view, cat } = e.state || hashToState(location.hash);
  applyHistoryState(view, cat);
});

export function initRouting() {
  // An old #/history bookmark lands on the roulette with the panel open. Noted
  // up front: the replaceState below rewrites the hash to #/spin/....
  const openHistory = /^#\/?history\b/.test(location.hash);
  if (location.hash) {
    const { view, cat } = hashToState(location.hash);
    uiState.currentView = view;
    adoptCat(view, cat);
  }
  // A hash like #/random or #/spin/movies from before the merge is rewritten
  // in place, so the address bar never shows a view that no longer exists.
  const cat = hashCatFor(uiState.currentView);
  history.replaceState({ view: uiState.currentView, cat }, "", stateToHash(uiState.currentView, cat));
  renderMenu();
  showSection();
  if (openHistory) openHistoryPanel();
}
