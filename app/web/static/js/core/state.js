const CATS = {movies: "🎬 Фильмы", cartoons: "🎥 Мульты", series: "📺 Сериалы"};
const REF_CATS = {marvel: "🕷 Marvel", dc: "🦇 DC"};
const ALL_CATS = {...CATS, ...REF_CATS};

const STATE_KEY = "filmroulette_state";
const RESOLVED_HIST_KEY = "filmroulette_resolved_history";

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return {cat: "movies", view: "home"};
    const s = JSON.parse(raw);
    return {cat: s.cat || "movies", view: s.view || "home"};
  } catch { return {cat: "movies", view: "home"}; }
}
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify({cat: currentCat, view: currentView})); } catch {}
}

const initial = loadState();
let currentCat = initial.cat;
let currentView = initial.view;
let currentCardData = null;
