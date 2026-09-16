import { isRandomSpin, uiState } from "../../core/state.js";
import { getLS, setLS } from "../../core/storage.js";
import { DOCK_PREFIXES, renderAllDockControls, renderChoiceToggle } from "./dock-controls.js";
import { resetSpinResult } from "./spin-category.js";
import { syncSpinResultClearance } from "../wheel/viewport.js";
import { resetWheelWraps, showIdleWheel } from "../wheel/wheel-build.js";

// ---- spin mode (classic / wheel) -----------------------------------------
const SPIN_MODE_KEY = "filmroulette_spin_mode";
function loadSpinMode() {
  const v = getLS(SPIN_MODE_KEY);
  return v === "wheel" ? "wheel" : "classic";
}
function saveSpinMode(mode) {
  setLS(SPIN_MODE_KEY, mode);
}
export let spinMode = loadSpinMode();

export function renderSpinModeToggle(containerId) {
  renderChoiceToggle(containerId, {
    options: [["classic", "🎲 Классика"], ["wheel", "🎡 Колесо"]],
    value: spinMode,
    containerClass: "spin-mode-toggle-outer",
    groupClass: "spin-mode-toggle--mode",
    onChange: (value) => {
      spinMode = value;
      saveSpinMode(value);
      for (const prefix of DOCK_PREFIXES) renderAllDockControls(prefix);

      requestAnimationFrame(() => {
        resetWheelWraps();
        if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();

        if (uiState.currentCardData) return;

        if (uiState.currentView !== "spin") return;
        if (spinMode === "wheel" && !isRandomSpin()) showIdleWheel(uiState.spinCat);
        else resetSpinResult();
      });
    },
  });
}
