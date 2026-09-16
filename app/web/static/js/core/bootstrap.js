import { api } from "./api.js";
import { ALL_CATS, CATS, LIST_CATS, RANDOM_CAT, REF_CATS } from "./constants.js";
import { renderMenu } from "./menu.js";
import { isCatEmpty, saveState, spinnableCats, uiState } from "./state.js";
import { updateHeaderTitle } from "./views.js";
import { renderListCatChips } from "../list/list-items.js";
import { renderSpinCatChips } from "../spin/settings/spin-category.js";

// /api/categories is the single source of truth for both the wording on the
// category chips and how many items each category holds. The counts are what
// let the roulette picker drop a category that has been fully watched off
// (see spinnableCats() in core/state.js).
(async () => {
  let data;
  try {
    data = await api("/api/categories");
  } catch (e) {
    return;
  }
  for (const labels of [CATS, REF_CATS, ALL_CATS, LIST_CATS]) {
    for (const code of Object.keys(labels)) {
      const label = data[code] && data[code].short_label;
      if (label) labels[code] = label;
    }
  }
  uiState.categoryCounts = {};
  for (const [code, info] of Object.entries(data)) uiState.categoryCounts[code] = info.count;
  if (isCatEmpty(uiState.spinCat)) { uiState.spinCat = RANDOM_CAT; saveState(); }
  renderMenu();
  renderSpinCatChips();
  if (uiState.currentView === "list") renderListCatChips();
  updateHeaderTitle();
})();
