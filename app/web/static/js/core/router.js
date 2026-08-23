const VIEWS_WITH_CAT = ["spin", "list", "showcase"];

function stateToHash(view, cat) {
  return VIEWS_WITH_CAT.includes(view) ? `#/${view}/${cat}` : `#/${view}`;
}

function hashToState(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { view: parts[0] || "home", cat: parts[1] || null };
}

function pushViewToHistory(view, cat) {
  const hash = stateToHash(view, cat);
  if (location.hash !== hash) {
    history.pushState({ view, cat }, "", hash);
  }
}

function applyHistoryState(view, cat) {
  currentView = view;
  if (cat) currentCat = cat;
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
    if (cat) currentCat = cat;
  }
  history.replaceState({ view: currentView, cat: currentCat }, "", stateToHash(currentView, currentCat));
  renderMenu();
  showSection();
}
