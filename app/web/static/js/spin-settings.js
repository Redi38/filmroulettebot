// Spin mode (classic/wheel) toggle + spin speed control, persisted to localStorage.

const SPIN_COOLDOWN_SECONDS = 1.5;
let spinCooldownUntil = 0;
let spinCooldownTimer = null;

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

const SPIN_SPEED_KEY = "filmroulette_spin_speed";
const SPIN_SPEED_MIN = 1;
const SPIN_SPEED_MAX = 60;
const SPIN_SPEED_DEFAULT = 5;
const SPIN_SPEED_STEP = 0.1;

function loadSpinSpeed() {
  try {
    const v = parseFloat(localStorage.getItem(SPIN_SPEED_KEY));
    if (!isNaN(v) && v >= SPIN_SPEED_MIN && v <= SPIN_SPEED_MAX) return v;
  } catch {}
  return SPIN_SPEED_DEFAULT;
}
function saveSpinSpeed(seconds) {
  try { localStorage.setItem(SPIN_SPEED_KEY, String(seconds)); } catch {}
}
let spinSpeedSeconds = loadSpinSpeed();

function clampSpinSpeed(v) {
  if (isNaN(v)) return spinSpeedSeconds;
  return Math.min(SPIN_SPEED_MAX, Math.max(SPIN_SPEED_MIN, v));
}
function formatSpinSpeed(v) {
  const rounded = Math.round(v * 10) / 10;
  return String(rounded);
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

function renderSpinModeToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  const outer = document.createElement("div");
  outer.className = "spin-mode-toggle-wrap";
  const row = document.createElement("div");
  row.className = "spin-mode-toggle";
  for (const [value, label] of [["classic", "🎲 Классика"], ["wheel", "🎡 Колесо"]]) {
    const btn = document.createElement("button");
    btn.className = "showcase-filter-btn" + (spinMode === value ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => {
      if (spinMode === value) return;
      spinMode = value;
      saveSpinMode(value);
      renderSpinModeToggle("random-mode-toggle");
      renderSpinModeToggle("spin-mode-toggle");
      renderSpinSpeedControl("random-spin-speed");
      renderSpinSpeedControl("spin-spin-speed");
      resetWheelWraps();
    };
    row.appendChild(btn);
  }
  outer.appendChild(row);
  el.appendChild(outer);
}
