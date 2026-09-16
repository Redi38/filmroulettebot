import { getLS, setLS } from "../../core/storage.js";
import { renderControlOnAllDocks } from "./dock-controls.js";
import { spinMode } from "./spin-mode.js";
import { loadWheel } from "../wheel/loader.js";

// ---- wheel appearance (neon on/off) ---------------------------------------
const WHEEL_APPEARANCE_KEY = "filmroulette_wheel_appearance";
function loadWheelAppearance() {
  return getLS(WHEEL_APPEARANCE_KEY) === "neon";
}
function saveWheelAppearance(isNeon) {
  setLS(WHEEL_APPEARANCE_KEY, isNeon ? "neon" : "classic");
}
let wheelAppearance = loadWheelAppearance() ? "neon" : "classic";
export function getWheelAppearance() { return wheelAppearance; }
let wheelAppearanceJustToggled = false;

export function renderWheelAppearanceToggle(containerId) {
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
  if (wheelAppearanceJustToggled) btn.classList.add("fx-toggle-pop");
  btn.onclick = async () => {
    const turningOff = wheelAppearance === "neon";
    wheelAppearance = wheelAppearance === "neon" ? "classic" : "neon";
    saveWheelAppearance(wheelAppearance === "neon");
    wheelAppearanceJustToggled = true;
    renderControlOnAllDocks(renderWheelAppearanceToggle, "appearance-toggle");
    wheelAppearanceJustToggled = false;
    const wheel = await loadWheel();
    for (const id of wheel.WHEEL_WRAP_IDS) {
      const wrap = document.getElementById(id);
      if (!wrap || !wrap._wheelPool) continue;
      const holder = wrap.querySelector(".wheel-holder");
      if (holder) {
        holder.className = "wheel-holder wheel-holder--" + wheelAppearance
          + (turningOff ? " wheel-holder--neon-exit" : "");
        if (turningOff) {
          setTimeout(() => holder.classList.remove("wheel-holder--neon-exit"), 520);
        }
      }
      const canvas = wrap.querySelector("canvas");
      if (canvas) wheel.drawWheel(canvas, wrap._wheelPool, wheel.getWheelDPR(), wrap._wheelWeights);
    }
  };

  el.appendChild(btn);
}
