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
function getWheelSoundTheme() { return wheelSoundTheme; }

const SOUND_THEME_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="6 9 12 15 18 9"></polyline>' +
  "</svg>";

function closeSoundThemeMenus(exceptWrap) {
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

function renderSoundThemeToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "sound-theme-wrap" + (spinMode === "wheel" && !wheelMuted ? " visible" : "");

  const current =
    WHEEL_SOUND_THEME_OPTIONS.find(([val]) => val === wheelSoundTheme) ||
    WHEEL_SOUND_THEME_OPTIONS[0];

  const wrap = document.createElement("div");
  wrap.className = "sound-theme-dropdown";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sound-theme-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.title = "Тема звука колеса";
  btn.innerHTML =
    `<span class="sound-theme-btn-label">${current[1]}</span>` +
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
    item.className = "sound-theme-item" + (val === wheelSoundTheme ? " active" : "");
    item.textContent = label;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", val === wheelSoundTheme ? "true" : "false");
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
  el.appendChild(wrap);
}
