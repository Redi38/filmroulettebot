// Shared render plumbing for every dock setting toggle: the two spin
// docks (random/spin) that every setting renders itself onto, and the
// two generic toggle-button renderers (choice row / single icon button)
// that each individual setting file in spin/settings/ builds on.

const SPIN_COOLDOWN_SECONDS = 1.5;
let spinCooldownUntil = 0;
let spinCooldownTimer = null;

// ---- shared dock render helpers ------------------------------------------
const DOCK_PREFIXES = ["random", "spin"];

function renderAllDockControls(prefix) {
  renderSpinModeToggle(`${prefix}-mode-toggle`);
  renderWeightToggle(`${prefix}-weight-toggle`);
  renderConfettiToggle(`${prefix}-confetti-toggle`);
  renderWheelAppearanceToggle(`${prefix}-appearance-toggle`);
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
