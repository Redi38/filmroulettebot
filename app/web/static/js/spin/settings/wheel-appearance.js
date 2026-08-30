// ---- wheel appearance (neon on/off) ---------------------------------------
const WHEEL_APPEARANCE_KEY = "filmroulette_wheel_appearance";
function loadWheelAppearance() {
  return getLS(WHEEL_APPEARANCE_KEY) === "neon";
}
function saveWheelAppearance(isNeon) {
  setLS(WHEEL_APPEARANCE_KEY, isNeon ? "neon" : "classic");
}
let wheelAppearance = loadWheelAppearance() ? "neon" : "classic";
function getWheelAppearance() { return wheelAppearance; }

function renderWheelAppearanceToggle(containerId) {
  const fxSection = document.getElementById(containerId.replace(/-appearance-toggle$/, "-fx-section"));
  if (fxSection) fxSection.classList.toggle("visible", spinMode === "wheel");

  const el = document.getElementById(containerId);
  if (!el) return;
  const isNeon = wheelAppearance === "neon";
  el.innerHTML = "";
  el.className = "spin-appearance-wrap" + (spinMode === "wheel" ? " visible" : "");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "showcase-filter-btn" + (isNeon ? " active" : "");
  btn.textContent = "✨ Неон";
  btn.setAttribute("aria-pressed", isNeon ? "true" : "false");
  btn.onclick = () => {
    wheelAppearance = wheelAppearance === "neon" ? "classic" : "neon";
    saveWheelAppearance(wheelAppearance === "neon");
    renderControlOnAllDocks(renderWheelAppearanceToggle, "appearance-toggle");
    for (const id of WHEEL_WRAP_IDS) {
      const wrap = document.getElementById(id);
      if (!wrap || !wrap._wheelPool) continue;
      const holder = wrap.querySelector(".wheel-holder");
      if (holder) holder.className = "wheel-holder wheel-holder--" + wheelAppearance;
      const canvas = wrap.querySelector("canvas");
      if (canvas) drawWheel(canvas, wrap._wheelPool, getWheelDPR(), wrap._wheelWeights);
    }
  };

  el.appendChild(btn);
}
