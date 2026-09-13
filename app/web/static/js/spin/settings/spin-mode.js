// ---- spin mode (classic / wheel) -----------------------------------------
const SPIN_MODE_KEY = "filmroulette_spin_mode";
function loadSpinMode() {
  const v = getLS(SPIN_MODE_KEY);
  return v === "wheel" ? "wheel" : "classic";
}
function saveSpinMode(mode) {
  setLS(SPIN_MODE_KEY, mode);
}
let spinMode = loadSpinMode();

function renderSpinModeToggle(containerId) {
  renderChoiceToggle(containerId, {
    options: [["classic", "🎲 Классика"], ["wheel", "🎡 Колесо"]],
    value: spinMode,
    groupClass: "spin-mode-toggle--mode",
    onChange: (value) => {
      spinMode = value;
      saveSpinMode(value);
      for (const prefix of DOCK_PREFIXES) renderAllDockControls(prefix);

      requestAnimationFrame(() => {
        resetWheelWraps();
        if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();

        if (currentCardData) return;

        if (currentView !== "spin") return;
        // "Наугад" has no single list to preview, so it stays on the
        // placeholder until the spin picks a category for you.
        if (spinMode === "wheel" && !isRandomSpin()) showIdleWheel(spinCat);
        else resetSpinResult();
      });
    },
  });
}
