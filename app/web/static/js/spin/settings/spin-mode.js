import { isRandomSpin, uiState } from "../../core/state.js";
import { getLS, setLS } from "../../core/storage.js";
import { DOCK_PREFIXES, renderAllDockControls, renderChoiceToggle } from "./dock-controls.js";
import { resetSpinResult } from "./spin-category.js";
import { loadWheel } from "../wheel/loader.js";

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

      requestAnimationFrame(async () => {
        const wheel = await loadWheel();
        wheel.resetWheelWraps();
        wheel.syncSpinResultClearance();

        if (uiState.currentCardData) return;

        if (uiState.currentView !== "spin") return;
        if (spinMode === "wheel" && !isRandomSpin()) wheel.showIdleWheel(uiState.spinCat);
        else resetSpinResult();
      });
    },
  });
}
