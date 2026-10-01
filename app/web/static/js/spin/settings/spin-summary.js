import { CATS, RANDOM_CAT } from "../../core/constants.js";
import { isRandomSpin, uiState } from "../../core/state.js";
import { randomFilterParams } from "./random-filters.js";
import { spinMode } from "./spin-mode.js";
import { isWeightedMode } from "./weighted-mode.js";

// One-line recap of the active roulette settings, shown under the collapsed
// dock header ("Все списки · Колесо · По весу"). Called from the dock render paths
// (never at module-eval time, the settings modules import each other).
export function updateSpinSettingsSummary() {
  const parts = [uiState.spinCat === RANDOM_CAT ? "Все списки" : (CATS[uiState.spinCat] || uiState.spinCat)];
  parts.push(spinMode === "wheel" ? "Колесо" : "Классика");
  if (spinMode === "wheel" && isWeightedMode()) parts.push("По весу");
  if (isRandomSpin()) {
    const f = randomFilterParams();
    if (f.films_only) parts.push("Только фильмы");
    if (f.max_runtime) parts.push("До 2 ч");
  }
  const text = parts.join(" · ");
  for (const el of document.querySelectorAll(".spin-settings-summary")) el.textContent = text;
}
