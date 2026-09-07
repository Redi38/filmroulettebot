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

      requestAnimationFrame(() => {
        resetWheelWraps();
        if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();

        if (currentCardData) return;
        if (spinMode === "wheel" && currentView === "spin") showIdleWheel(currentCat);
      });
    },
  });
}
