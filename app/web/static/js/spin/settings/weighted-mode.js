import { api } from "../../core/api.js";
import { isRandomSpin, uiState } from "../../core/state.js";
import { getLS, setLS } from "../../core/storage.js";
import { renderChoiceToggle, renderControlOnAllDocks } from "./dock-controls.js";
import { spinMode } from "./spin-mode.js";
import { loadWheel } from "../wheel/loader.js";

// ---- weighted mode ---------------------------------------------------------
const WEIGHTED_MODE_KEY = "filmroulette_weighted_spin";
function loadWeightedMode() {
  return getLS(WEIGHTED_MODE_KEY) === "1";
}
function saveWeightedMode(v) {
  setLS(WEIGHTED_MODE_KEY, v ? "1" : "0");
}
let weightedMode = loadWeightedMode();
export function isWeightedMode() { return weightedMode; }

let weightResizeToken = 0;

export function renderWeightToggle(containerId) {
  const section = document.getElementById(containerId.replace(/-weight-toggle$/, "-weight-section"));
  if (section) section.classList.toggle("visible", spinMode === "wheel");
  renderChoiceToggle(containerId, {
    options: [[false, "🎲 Обычный"], [true, "⚖️ Весовой"]],
    value: weightedMode,
    containerClass: "spin-weight-wrap",
    visible: spinMode === "wheel",
    groupClass: "spin-mode-toggle--weight",
    onChange: (value) => {
      weightedMode = value;
      saveWeightedMode(value);
      renderControlOnAllDocks(renderWeightToggle, "weight-toggle");
      resizeIdleWheelForWeightedMode(value);
    },
  });
}

async function resizeIdleWheelForWeightedMode(weighted) {
  const wheel = await loadWheel();
  const wrap = document.getElementById("spin-wheel-wrap");
  const canvas = wrap && wrap.querySelector(".wheel-canvas");
  const pool = wrap && wrap._wheelPool;
  const canResize = wrap && canvas && pool && pool.length >= 2
    && !wheel.wheelSpinState.active && !uiState.currentCardData
    && spinMode === "wheel" && uiState.currentView === "spin";

  if (!canResize) {
    weightResizeToken++;
    requestAnimationFrame(() => {
      wheel.resetWheelWraps();
      wheel.syncSpinResultClearance();
      if (uiState.currentCardData) return;
      if (spinMode === "wheel" && uiState.currentView === "spin" && !isRandomSpin()) wheel.showIdleWheel(uiState.spinCat);
    });
    return;
  }

  const token = ++weightResizeToken;
  try {
    const data = await api(`/api/${uiState.spinCat}/wheel-weights`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({pool, weighted}),
    });
    if (token !== weightResizeToken) return;
    if (wrap._wheelPool !== pool || document.getElementById("spin-wheel-wrap") !== wrap) return;
    wrap._wheelWeights = data.wheel_weights;
    await wheel.animateWheelWeights(canvas, pool, wheel.getWheelDPR(), data.wheel_weights);
  } catch (e) {
    if (token !== weightResizeToken) return;
    wheel.resetWheelWraps();
    wheel.syncSpinResultClearance();
    if (!uiState.currentCardData && spinMode === "wheel" && uiState.currentView === "spin" && !isRandomSpin()) wheel.showIdleWheel(uiState.spinCat);
  }
}
