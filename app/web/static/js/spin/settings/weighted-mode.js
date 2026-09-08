// ---- weighted mode ---------------------------------------------------------
const WEIGHTED_MODE_KEY = "filmroulette_weighted_spin";
function loadWeightedMode() {
  return getLS(WEIGHTED_MODE_KEY) === "1";
}
function saveWeightedMode(v) {
  setLS(WEIGHTED_MODE_KEY, v ? "1" : "0");
}
let weightedMode = loadWeightedMode();
function isWeightedMode() { return weightedMode; }

let weightResizeToken = 0;

function renderWeightToggle(containerId) {
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
  const wrap = document.getElementById("spin-wheel-wrap");
  const canvas = wrap && wrap.querySelector(".wheel-canvas");
  const pool = wrap && wrap._wheelPool;
  const canResize = wrap && canvas && pool && pool.length >= 2
    && !wheelSpinActive && !currentCardData
    && spinMode === "wheel" && currentView === "spin";

  if (!canResize) {
    weightResizeToken++;
    requestAnimationFrame(() => {
      resetWheelWraps();
      if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
      if (currentCardData) return;
      if (spinMode === "wheel" && currentView === "spin") showIdleWheel(currentCat);
    });
    return;
  }

  const token = ++weightResizeToken;
  try {
    const data = await api(`/api/${currentCat}/wheel-weights`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({pool, weighted}),
    });
    if (token !== weightResizeToken) return;
    if (wrap._wheelPool !== pool || document.getElementById("spin-wheel-wrap") !== wrap) return;
    wrap._wheelWeights = data.wheel_weights;
    await animateWheelWeights(canvas, pool, getWheelDPR(), data.wheel_weights);
  } catch (e) {
    if (token !== weightResizeToken) return;
    resetWheelWraps();
    if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
    if (!currentCardData && spinMode === "wheel" && currentView === "spin") showIdleWheel(currentCat);
  }
}
