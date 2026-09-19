import { getLS, setLS } from "../../core/storage.js";
import { renderControlOnAllDocks } from "./dock-controls.js";
import { spinMode } from "./spin-mode.js";
import { wheelMuted } from "./wheel-mute.js";

// ---- wheel sound theme -------------------------------------------------------
const WHEEL_SOUND_THEME_KEY = "filmroulette_wheel_sound_theme";
const WHEEL_SOUND_THEME_OPTIONS = [
  ["classic", "🔔 Классика"],
  ["arcade", "🕹️ Аркада"],
  ["quiet", "🤫 Тихо"],
];
function loadWheelSoundTheme() {
  const v = getLS(WHEEL_SOUND_THEME_KEY);
  return WHEEL_SOUND_THEME_OPTIONS.some(([val]) => val === v) ? v : "classic";
}
function saveWheelSoundTheme(v) {
  setLS(WHEEL_SOUND_THEME_KEY, v);
}
let wheelSoundTheme = loadWheelSoundTheme();
export function getWheelSoundTheme() { return wheelSoundTheme; }

const SOUND_THEME_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="6 9 12 15 18 9"></polyline>' +
  "</svg>";

export function closeSoundThemeMenus(exceptWrap) {
  document.querySelectorAll(".sound-theme-dropdown.open").forEach((wrap) => {
    if (wrap === exceptWrap) return;
    wrap.classList.remove("open");
    const btn = wrap.querySelector(".sound-theme-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", () => closeSoundThemeMenus());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSoundThemeMenus();
});

export function renderSoundThemeToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.className = "sound-theme-wrap" + (spinMode === "wheel" && !wheelMuted ? " visible" : "");

  // Built once and then only updated: picking a theme re-renders this control,
  // and rebuilding it would cut the menu's close animation short (see
  // renderCatSelect for the same reasoning).
  let wrap = el.querySelector(":scope > .sound-theme-dropdown");
  if (!wrap) {
    wrap = buildSoundThemeDropdown();
    el.innerHTML = "";
    el.appendChild(wrap);
  }
  syncSoundThemeDropdown(wrap);
}

function buildSoundThemeDropdown() {
  const wrap = document.createElement("div");
  wrap.className = "sound-theme-dropdown";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sound-theme-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.title = "Тема звука колеса";
  btn.innerHTML =
    `<span class="sound-theme-btn-label"></span>` +
    `<span class="sound-theme-chevron">${SOUND_THEME_CHEVRON_SVG}</span>`;
  btn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains("open");
    closeSoundThemeMenus();
    if (!isOpen) {
      wrap.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }
  };

  const menu = document.createElement("div");
  menu.className = "sound-theme-menu";
  menu.setAttribute("role", "listbox");
  menu.onclick = (e) => e.stopPropagation();

  for (const [val, label] of WHEEL_SOUND_THEME_OPTIONS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "sound-theme-item";
    item.dataset.value = val;
    item.textContent = label;
    item.setAttribute("role", "option");
    item.onclick = () => {
      closeSoundThemeMenus();
      if (wheelSoundTheme !== val) {
        wheelSoundTheme = val;
        saveWheelSoundTheme(val);
        renderControlOnAllDocks(renderSoundThemeToggle, "sound-theme-toggle");
      }
    };
    menu.appendChild(item);
  }

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

function syncSoundThemeDropdown(wrap) {
  const current =
    WHEEL_SOUND_THEME_OPTIONS.find(([val]) => val === wheelSoundTheme) ||
    WHEEL_SOUND_THEME_OPTIONS[0];
  wrap.querySelector(".sound-theme-btn-label").textContent = current[1];
  for (const item of wrap.querySelectorAll(".sound-theme-item")) {
    const isActive = item.dataset.value === wheelSoundTheme;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-selected", isActive ? "true" : "false");
  }
}
