import { getLS, setLS } from "../../core/storage.js";
import { loadWheel } from "../wheel/loader.js";
import { renderControlOnAllDocks } from "./dock-controls.js";

// ---- wheel poster segments ----------------------------------------------
// Segments can show each title's cached TMDb poster instead of a flat color
// (see wheel-draw.js). Optional, since posters on 40+ tiny segments can read
// as busy — default on, since it's the point of the feature; off falls back
// to the plain color wheel.
const WHEEL_POSTERS_ENABLED_KEY = "filmroulette_wheel_posters_enabled";
function loadWheelPostersEnabled() {
  const v = getLS(WHEEL_POSTERS_ENABLED_KEY);
  return v === null ? true : v === "1";
}
function saveWheelPostersEnabled(v) {
  setLS(WHEEL_POSTERS_ENABLED_KEY, v ? "1" : "0");
}
let wheelPostersEnabled = loadWheelPostersEnabled();
export function isWheelPostersEnabled() { return wheelPostersEnabled; }
let posterToggleJustToggled = false;

export function renderPosterToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "wheel-poster-toggle-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "showcase-filter-btn" + (wheelPostersEnabled ? " active" : "");
  btn.textContent = "🖼️ Постеры";
  btn.setAttribute("aria-pressed", wheelPostersEnabled ? "true" : "false");
  if (posterToggleJustToggled) btn.classList.add("fx-toggle-pop");
  btn.onclick = async () => {
    wheelPostersEnabled = !wheelPostersEnabled;
    saveWheelPostersEnabled(wheelPostersEnabled);
    posterToggleJustToggled = true;
    renderControlOnAllDocks(renderPosterToggle, "poster-toggle");
    posterToggleJustToggled = false;
    // Segments already on screen need to swap poster/flat-color styling in
    // place — same redraw wheel-appearance.js does for the neon toggle.
    const wheel = await loadWheel();
    for (const id of wheel.WHEEL_WRAP_IDS) {
      const wrap = document.getElementById(id);
      if (!wrap || !wrap._wheelPool) continue;
      const canvas = wrap.querySelector(".wheel-canvas");
      if (canvas) wheel.drawWheel(canvas, wrap._wheelPool, wheel.getWheelDPR(), wrap._wheelWeights);
    }
  };

  el.appendChild(btn);
}
