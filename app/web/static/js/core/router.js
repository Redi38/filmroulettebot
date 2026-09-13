// Views whose hash carries a category. The roulette is in this list too, but
// its category lives in `spinCat` rather than `currentCat` — picking "Наугад"
// or "Сериалы" on the wheel must not silently retarget the watchlist.
const VIEWS_WITH_CAT = ["list", "showcase"];

function hashCatFor(view) {
  if (view === "spin") return spinCat;
  return VIEWS_WITH_CAT.includes(view) ? currentCat : null;
}

function stateToHash(view, cat) {
  if (view === "spin") return `#/spin/${cat || spinCat}`;
  return VIEWS_WITH_CAT.includes(view) ? `#/${view}/${cat}` : `#/${view}`;
}

function hashToState(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  let view = parts[0] || "home";
  if (view === "random") view = "spin"; // legacy bookmarks from the old split views
  return { view, cat: parts[1] || null };
}

function pushViewToHistory(view, cat) {
  const hash = stateToHash(view, cat);
  if (location.hash !== hash) {
    history.pushState({ view, cat }, "", hash);
  }
}

function adoptCat(view, cat) {
  if (!cat) return;
  if (view === "spin") {
    if (cat === RANDOM_CAT || CATS[cat]) spinCat = cat;
  } else if (LIST_CATS[cat]) {
    currentCat = cat;
  }
}

function applyHistoryState(view, cat) {
  currentView = view;
  adoptCat(view, cat);
  renderMenu();
  showSection();
}

window.addEventListener("popstate", (e) => {
  const { view, cat } = e.state || hashToState(location.hash);
  applyHistoryState(view, cat);
});

function initRouting() {
  if (location.hash) {
    const { view, cat } = hashToState(location.hash);
    currentView = view;
    adoptCat(view, cat);
  }
  // A hash like #/random or #/spin/movies from before the merge is rewritten
  // in place, so the address bar never shows a view that no longer exists.
  const cat = hashCatFor(currentView);
  history.replaceState({ view: currentView, cat }, "", stateToHash(currentView, cat));
  renderMenu();
  showSection();
}
