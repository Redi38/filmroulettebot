// ---- confetti effect ---------------------------------------------------
const CONFETTI_ENABLED_KEY = "filmroulette_confetti_enabled";
function loadConfettiEnabled() {
  const v = getLS(CONFETTI_ENABLED_KEY);
  return v === null ? true : v === "1";
}
function saveConfettiEnabled(v) {
  setLS(CONFETTI_ENABLED_KEY, v ? "1" : "0");
}
let confettiEnabled = loadConfettiEnabled();
function isConfettiEnabled() { return confettiEnabled; }

function renderConfettiToggle(containerId) {
  const fxSection = document.getElementById(containerId.replace(/-confetti-toggle$/, "-fx-section"));
  if (fxSection) fxSection.classList.toggle("visible", spinMode === "wheel");

  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "confetti-toggle-wrap" + (spinMode === "wheel" ? " visible" : "");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "showcase-filter-btn" + (confettiEnabled ? " active" : "");
  btn.textContent = "🎊 Конфетти";
  btn.setAttribute("aria-pressed", confettiEnabled ? "true" : "false");
  btn.onclick = () => {
    confettiEnabled = !confettiEnabled;
    saveConfettiEnabled(confettiEnabled);
    renderControlOnAllDocks(renderConfettiToggle, "confetti-toggle");
  };

  el.appendChild(btn);
}
