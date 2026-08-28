const CATS = {movies: "🎬 Фильмы", cartoons: "🎥 Мульты", series: "📺 Сериалы"};
const REF_CATS = {marvel: "🕷 Marvel", dc: "🦇 DC"};
const ALL_CATS = {...CATS, ...REF_CATS};

const STATE_KEY = "filmroulette_state";
const RESOLVED_HIST_KEY = "filmroulette_resolved_history";

function loadState() {
  const s = getLSJSON(STATE_KEY, null);
  if (!s) return {cat: "movies", view: "home"};
  return {cat: s.cat || "movies", view: s.view || "home"};
}
function saveState() {
  setLSJSON(STATE_KEY, {cat: currentCat, view: currentView});
}

const initial = loadState();
let currentCat = initial.cat;
let currentView = initial.view;
let currentCardData = null;
