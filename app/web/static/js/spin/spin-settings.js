// Spin mode (classic/wheel) toggle, weighted-mode toggle, wheel sound
// mute + sound-theme toggles, and spin speed control — every dock setting
// that persists to localStorage.

const SPIN_COOLDOWN_SECONDS = 1.5;
let spinCooldownUntil = 0;
let spinCooldownTimer = null;

// ---- shared dock render helpers ------------------------------------------
const DOCK_PREFIXES = ["random", "spin"];

function renderAllDockControls(prefix) {
  renderSpinModeToggle(`${prefix}-mode-toggle`);
  renderWeightToggle(`${prefix}-weight-toggle`);
  renderConfettiToggle(`${prefix}-confetti-toggle`);
  renderSpinSpeedControl(`${prefix}-spin-speed`);
  renderWheelMuteToggle(`${prefix}-mute-toggle`);
  renderSoundThemeToggle(`${prefix}-sound-theme-toggle`);
}

function renderControlOnAllDocks(renderFn, suffix) {
  for (const prefix of DOCK_PREFIXES) renderFn(`${prefix}-${suffix}`);
}

// ---- generic toggle renderers -------------------------------------------
function renderChoiceToggle(containerId, { options, value, onChange, containerClass, visible }) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  if (containerClass) el.className = containerClass + (visible ? " visible" : "");
  const outer = document.createElement("div");
  outer.className = "spin-mode-toggle-wrap";
  const row = document.createElement("div");
  row.className = "spin-mode-toggle";
  for (const [val, label] of options) {
    const btn = document.createElement("button");
    btn.className = "showcase-filter-btn" + (value === val ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => { if (value !== val) onChange(val); };
    row.appendChild(btn);
  }
  outer.appendChild(row);
  el.appendChild(outer);
}

function renderIconToggle(containerId, { containerClass, visible, active, btnClass, activeClass, iconOn, iconOff, labelOn, labelOff, onClick }) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = containerClass + (visible ? " visible" : "");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = btnClass + (active ? " " + activeClass : "");
  const label = active ? labelOn : labelOff;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = active ? iconOn : iconOff;
  btn.onclick = onClick;
  el.appendChild(btn);
}

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
  renderChoiceToggle(containerId, {
    options: [[false, "🎲 Обычный"], [true, "⚖️ Весовой"]],
    value: weightedMode,
    containerClass: "spin-weight-wrap",
    visible: spinMode === "wheel",
    onChange: (value) => {
      weightedMode = value;
      saveWeightedMode(value);
      renderControlOnAllDocks(renderWeightToggle, "weight-toggle");
      resetWheelWraps();
      if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();

      if (currentCardData) return;
      if (spinMode === "wheel" && currentView === "spin") showIdleWheel(currentCat);
    },
  });
}

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
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "confetti-toggle-wrap" + (spinMode === "wheel" ? " visible" : "");

  const outer = document.createElement("div");
  outer.className = "spin-mode-toggle-wrap";
  const row = document.createElement("div");
  row.className = "spin-mode-toggle";

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

  row.appendChild(btn);
  outer.appendChild(row);
  el.appendChild(outer);
}

// ---- wheel sound mute -------------------------------------------------------
const WHEEL_MUTED_KEY = "filmroulette_wheel_muted";
function loadWheelMuted() {
  return getLS(WHEEL_MUTED_KEY) === "1";
}
function saveWheelMuted(v) {
  setLS(WHEEL_MUTED_KEY, v ? "1" : "0");
}
let wheelMuted = loadWheelMuted();
function isWheelMuted() { return wheelMuted; }
function setWheelMuted(v) {
  wheelMuted = v;
  saveWheelMuted(v);
  renderControlOnAllDocks(renderWheelMuteToggle, "mute-toggle");
  if (v) closeSoundThemeMenus();
  renderControlOnAllDocks(renderSoundThemeToggle, "sound-theme-toggle");
}
function toggleWheelMuted() { setWheelMuted(!wheelMuted); }

const WHEEL_ICON_VOLUME =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>' +
  '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>' +
  '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>' +
  "</svg>";
const WHEEL_ICON_MUTED =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>' +
  '<line x1="23" y1="9" x2="17" y2="15"></line>' +
  '<line x1="17" y1="9" x2="23" y2="15"></line>' +
  "</svg>";

function renderWheelMuteToggle(containerId) {
  renderIconToggle(containerId, {
    containerClass: "wheel-mute-wrap",
    visible: spinMode === "wheel",
    active: wheelMuted,
    btnClass: "wheel-mute-btn",
    activeClass: "muted",
    iconOn: WHEEL_ICON_MUTED,
    iconOff: WHEEL_ICON_VOLUME,
    labelOn: "Включить звук колеса",
    labelOff: "Выключить звук колеса",
    onClick: toggleWheelMuted,
  });
}

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

// ---- spin speed --------------------------------------------------------------
const SPIN_SPEED_KEY = "filmroulette_spin_speed";
const SPIN_SPEED_MIN = 1;
const SPIN_SPEED_MAX = 60;
const SPIN_SPEED_DEFAULT = 4;
const SPIN_SPEED_STEP = 0.1;
function loadSpinSpeed() {
  const v = parseFloat(getLS(SPIN_SPEED_KEY));
  if (Number.isFinite(v) && v >= SPIN_SPEED_MIN && v <= SPIN_SPEED_MAX) return v;
  return SPIN_SPEED_DEFAULT;
}
function saveSpinSpeed(v) {
  setLS(SPIN_SPEED_KEY, String(v));
}
let spinSpeedSeconds = loadSpinSpeed();

function clampSpinSpeed(v) {
  if (!Number.isFinite(v)) return spinSpeedSeconds;
  return Math.min(SPIN_SPEED_MAX, Math.max(SPIN_SPEED_MIN, v));
}
function formatSpinSpeed(v) {
  return String(Math.round(v * 10) / 10);
}

function renderSpinSpeedControl(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "spin-speed-wrap" + (spinMode === "wheel" ? " visible" : "");

  const control = document.createElement("div");
  control.className = "spin-speed-control";

  const label = document.createElement("label");
  label.textContent = "⏱ Скорость колеса";

  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "decimal";
  input.min = String(SPIN_SPEED_MIN);
  input.max = String(SPIN_SPEED_MAX);
  input.step = String(SPIN_SPEED_STEP);
  input.value = formatSpinSpeed(spinSpeedSeconds);

  const unit = document.createElement("span");
  unit.className = "spin-speed-unit";
  unit.textContent = "сек";

  const commit = () => {
    const v = clampSpinSpeed(parseFloat(input.value.replace(",", ".")));
    spinSpeedSeconds = v;
    input.value = formatSpinSpeed(v);
    saveSpinSpeed(v);
  };
  input.onchange = commit;
  input.onblur = commit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") { commit(); input.blur(); }
  };

  control.appendChild(label);
  control.appendChild(input);
  control.appendChild(unit);
  el.appendChild(control);
}
