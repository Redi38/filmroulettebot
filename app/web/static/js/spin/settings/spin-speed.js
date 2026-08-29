// ---- spin speed --------------------------------------------------------------
const SPIN_SPEED_KEY = "filmroulette_spin_speed";
const SPIN_SPEED_MIN = 1;
const SPIN_SPEED_MAX = 60;
const SPIN_SPEED_DEFAULT = 10;
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
