import { api } from "../../core/api.js";
import { renderCatSelect } from "../../core/cat-select.js";
import { CATS, RANDOM_CAT } from "../../core/constants.js";
import { isRandomSpin, spinnableCats, uiState } from "../../core/state.js";
import { placeholderHtml } from "../../core/utils.js";
import { showSection, switchSpinCat } from "../../core/views.js";

// ---- roulette category ("Рандом" / Фильмы / Сериалы / …) ------------------
//
// Replaces what used to be four separate menu entries and two separate spin
// screens. "Рандом" is one wheel holding the titles of every roulette list
// plus a Marvel and a DC lot (POST /api/random-spin); anything else spins that
// one list (the movies wheel carries the same two lots).
function spinCatOptions() {
  return [
    [RANDOM_CAT, "Рандом"],
    ...spinnableCats().map((code) => [code, CATS[code] || code]),
  ];
}

// A dropdown rather than a pill row: the dock is a narrow fixed column on
// desktop, and four or five pills do not fit across it.
export function renderSpinCatChips() {
  renderCatSelect("spin-cat-select", {
    options: spinCatOptions(),
    value: uiState.spinCat,
    label: "Категория рулетки",
    onChange: (code) => switchSpinCat(code),
  });
}

// Shared by showSection(), switchSpinCat() and the spin-mode toggle so the
// empty-state copy always matches the category that is actually selected.
export function resetSpinResult() {
  const el = document.getElementById("spin-result");
  if (!el) return;
  el.innerHTML = placeholderHtml(
    isRandomSpin()
      ? "Нажми «Крутить», и рулетка выберет тайтл из всех списков 🍿"
      : `Нажми «Крутить», чтобы узнать, что посмотреть 🎬`,
  );
}
