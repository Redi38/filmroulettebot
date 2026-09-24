import { isRandomSpin, uiState } from "../../core/state.js";
import { getLS, setLS } from "../../core/storage.js";
import { loadWheel } from "../wheel/loader.js";
import { DOCK_PREFIXES } from "./dock-controls.js";
import { spinMode } from "./spin-mode.js";

// ---- "Рандом" wheel preferences -------------------------------------------
// Two independent per-browser filters for the combined wheel only (see
// app/web/server/shared/random_filters.py for the server side):
//   "Только фильмы" drops the series list; cartoons and the Marvel/DC lots stay.
//   "До 2 ч" drops films longer than two hours; series are never affected by it.
const FILMS_ONLY_KEY = "filmroulette_random_films_only";
const MAX_2H_KEY = "filmroulette_random_max_2h";
const MAX_RUNTIME_MINUTES = 120;

let filmsOnly = getLS(FILMS_ONLY_KEY) === "1";
let max2h = getLS(MAX_2H_KEY) === "1";
// Which pill was just clicked, so only that one plays the fxTogglePop bounce
// on the re-render — same pattern as the confetti/neon toggles.
let justToggled = null;

/** Filter fields for a /api/random-spin body; empty when nothing is on. */
export function randomFilterParams() {
  const params = {};
  if (filmsOnly) params.films_only = true;
  if (max2h) params.max_runtime = MAX_RUNTIME_MINUTES;
  return params;
}

/** Same filters as a query-string suffix ("&films_only=true…") for the preview GET. */
export function randomFilterQuery() {
  return Object.entries(randomFilterParams())
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");
}

export function hasActiveRandomFilters() {
  return filmsOnly || max2h;
}

function renderPill(containerId, { key, active, label, title, onToggle }) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "random-filter-toggle-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "showcase-filter-btn" + (active ? " active" : "");
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute("aria-pressed", active ? "true" : "false");
  if (justToggled === key) btn.classList.add("fx-toggle-pop");
  btn.onclick = onToggle;
  el.appendChild(btn);
}

export function renderRandomFilters(prefix) {
  const section = document.getElementById(`${prefix}-random-filter-section`);
  if (section) section.classList.toggle("visible", isRandomSpin());

  renderPill(`${prefix}-films-only-toggle`, {
    key: "films-only",
    active: filmsOnly,
    label: "🎬 Фильмы",
    title: "Убрать сериалы из рулетки. Мультфильмы, Marvel и DC остаются",
    onToggle: () => {
      filmsOnly = !filmsOnly;
      setLS(FILMS_ONLY_KEY, filmsOnly ? "1" : "0");
      onFiltersChanged("films-only");
    },
  });
  renderPill(`${prefix}-max-runtime-toggle`, {
    key: "max-runtime",
    active: max2h,
    label: "⏱️ До 2 ч",
    title: "Только фильмы не длиннее двух часов. Сериалы этот фильтр не убирает",
    onToggle: () => {
      max2h = !max2h;
      setLS(MAX_2H_KEY, max2h ? "1" : "0");
      onFiltersChanged("max-runtime");
    },
  });
}

// The idle wheel on screen was built from the old filters, so rebuild it —
// unless a result card is showing, in which case the next spin picks them up.
async function onFiltersChanged(toggledKey) {
  justToggled = toggledKey;
  for (const prefix of DOCK_PREFIXES) renderRandomFilters(prefix);
  justToggled = null;
  if (!isRandomSpin() || uiState.currentView !== "spin" || uiState.currentCardData) return;
  const wheel = await loadWheel();
  if (wheel.wheelSpinState.active) return;
  if (spinMode === "wheel") wheel.showIdleWheel(uiState.spinCat);
}
