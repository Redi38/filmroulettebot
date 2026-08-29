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
    onChange: (value) => {
      spinMode = value;
      saveSpinMode(value);
      for (const prefix of DOCK_PREFIXES) renderAllDockControls(prefix);
      resetWheelWraps();
      if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();

      if (currentCardData) return;

      if (spinMode === "wheel" && currentView === "spin") {
        showIdleWheel(currentCat);
      } else if (currentView === "spin") {
        document.getElementById("spin-result").innerHTML =
          placeholderHtml("Нажми «Крутить», чтобы узнать, что посмотреть 🎬");
      } else if (currentView === "random") {
        document.getElementById("random-spin-result").innerHTML =
          placeholderHtml("Нажми «Крутить», и рулетка выберет фильм, сериал или мультфильм 🍿");
      }
    },
  });
}
