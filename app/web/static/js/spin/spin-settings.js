// Spin mode (classic/wheel) toggle, weighted-mode toggle, wheel sound
// mute + sound-theme toggles, and spin speed control — every dock setting
// that persists to localStorage.

const SPIN_COOLDOWN_SECONDS = 1.5;
let spinCooldownUntil = 0;
let spinCooldownTimer = null;

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
  try {
    const v = localStorage.getItem(SPIN_MODE_KEY);
    return v === "wheel" ? "wheel" : "classic";
  } catch { return "classic"; }
}
function saveSpinMode(mode) {
  try { localStorage.setItem(SPIN_MODE_KEY, mode); } catch {}
}
let spinMode = loadSpinMode();

function renderSpinModeToggle(containerId) {
  renderChoiceToggle(containerId, {
    options: [["classic", "🎲 Классика"], ["wheel", "🎡 Колесо"]],
    value: spinMode,
    onChange: (value) => {
      spinMode = value;
      saveSpinMode(value);
      renderSpinModeToggle("random-mode-toggle");
      renderSpinModeToggle("spin-mode-toggle");
      renderWeightToggle("random-weight-toggle");
      renderWeightToggle("spin-weight-toggle");
      renderSpinSpeedControl("random-spin-speed");
      renderSpinSpeedControl("spin-spin-speed");
      renderWheelMuteToggle("random-mute-toggle");
      renderWheelMuteToggle("spin-mute-toggle");
      renderSoundThemeToggle("random-sound-theme-toggle");
      renderSoundThemeToggle("spin-sound-theme-toggle");
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
  try { return localStorage.getItem(WEIGHTED_MODE_KEY) === "1"; } catch { return false; }
}
function saveWeightedMode(v) {
  try { localStorage.setItem(WEIGHTED_MODE_KEY, v ? "1" : "0"); } catch {}
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
      renderWeightToggle("random-weight-toggle");
      renderWeightToggle("spin-weight-toggle");
      resetWheelWraps();
      if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();

      if (currentCardData) return;
      if (spinMode === "wheel" && currentView === "spin") showIdleWheel(currentCat);
    },
  });
}

// ---- wheel sound mute -------------------------------------------------------
const WHEEL_MUTED_KEY = "filmroulette_wheel_muted";
function loadWheelMuted() {
  try { return localStorage.getItem(WHEEL_MUTED_KEY) === "1"; } catch { return false; }
}
function saveWheelMuted(v) {
  try { localStorage.setItem(WHEEL_MUTED_KEY, v ? "1" : "0"); } catch {}
}
let wheelMuted = loadWheelMuted();
function isWheelMuted() { return wheelMuted; }
function setWheelMuted(v) {
  wheelMuted = v;
  saveWheelMuted(v);
  renderWheelMuteToggle("random-mute-toggle");
  renderWheelMuteToggle("spin-mute-toggle");
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
  try {
    const v = localStorage.getItem(WHEEL_SOUND_THEME_KEY);
    return WHEEL_SOUND_THEME_OPTIONS.some(([val]) => val === v) ? v : "classic";
  } catch { return "classic"; }
}
function saveWheelSoundTheme(v) {
  try { localStorage.setItem(WHEEL_SOUND_THEME_KEY, v); } catch {}
}
let wheelSoundTheme = loadWheelSoundTheme();
function getWheelSoundTheme() { return wheelSoundTheme; }

function renderSoundThemeToggle(containerId) {
  renderChoiceToggle(containerId, {
    options: WHEEL_SOUND_THEME_OPTIONS,
    value: wheelSoundTheme,
    containerClass: "spin-sound-theme-wrap",
    visible: spinMode === "wheel",
    onChange: (value) => {
      wheelSoundTheme = value;
      saveWheelSoundTheme(value);
      renderSoundThemeToggle("random-sound-theme-toggle");
      renderSoundThemeToggle("spin-sound-theme-toggle");
    },
  });
}

// ---- spin speed --------------------------------------------------------------
const SPIN_SPEED_KEY = "filmroulette_spin_speed";
const SPIN_SPEED_MIN = 1;
const SPIN_SPEED_MAX = 60;
const SPIN_SPEED_DEFAULT = 4;
function loadSpinSpeed() {
  try {
    const v = parseFloat(localStorage.getItem(SPIN_SPEED_KEY));
    if (Number.isFinite(v) && v >= SPIN_SPEED_MIN && v <= SPIN_SPEED_MAX) return v;
  } catch {}
  return SPIN_SPEED_DEFAULT;
}
function saveSpinSpeed(v) {
  try { localStorage.setItem(SPIN_SPEED_KEY, String(v)); } catch {}
}
let spinSpeedSeconds = loadSpinSpeed();

function renderSpinSpeedControl(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "spin-speed-wrap" + (spinMode === "wheel" ? " visible" : "");

  const control = document.createElement("div");
  control.className = "spin-speed-control";

  const label = document.createElement("span");
  label.className = "spin-speed-label";
  label.textContent = "⏱️";
  control.appendChild(label);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(SPIN_SPEED_MIN);
  input.max = String(SPIN_SPEED_MAX);
  input.step = "0.5";
  input.value = String(spinSpeedSeconds);
  input.className = "spin-speed-slider";

  const value = document.createElement("span");
  value.className = "spin-speed-value";
  value.textContent = `${spinSpeedSeconds}с`;

  input.oninput = () => {
    spinSpeedSeconds = parseFloat(input.value);
    value.textContent = `${spinSpeedSeconds}с`;
  };
  input.onchange = () => {
    saveSpinSpeed(spinSpeedSeconds);
  };

  control.appendChild(input);
  control.appendChild(value);

  const unit = document.createElement("span");
  unit.className = "spin-speed-unit";
  control.appendChild(unit);
  el.appendChild(control);
}
