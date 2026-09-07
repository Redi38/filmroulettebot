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
  renderAutoWatchToggle(`${prefix}-watch-toggle`);
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
function renderChoiceToggle(containerId, { options, value, onChange, containerClass, visible, groupClass }) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (containerClass) el.className = containerClass + (visible ? " visible" : "");

  const keys = options.map(([val]) => String(val));
  let row = el.querySelector(".spin-mode-toggle");
  const sameShape = row && row.dataset.keys === keys.join("|");

  if (!sameShape) {
    el.innerHTML = "";
    const outer = document.createElement("div");
    outer.className = "spin-mode-toggle-wrap";
    row = document.createElement("div");
    row.className = "spin-mode-toggle" + (groupClass ? " " + groupClass : "");
    row.dataset.keys = keys.join("|");

    const thumb = document.createElement("div");
    thumb.className = "spin-mode-thumb";
    thumb.style.transition = "none";
    row.appendChild(thumb);

    for (const [, label] of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "showcase-filter-btn";
      btn.textContent = label;
      row.appendChild(btn);
    }
    outer.appendChild(row);
    el.appendChild(outer);
  }

  const buttons = row.querySelectorAll("button");
  let activeBtn = buttons[0];
  options.forEach(([val], i) => {
    const isActive = value === val;
    buttons[i].classList.toggle("active", isActive);
    buttons[i].onclick = () => { if (value !== val) onChange(val); };
    if (isActive) activeBtn = buttons[i];
  });

  const thumb = row.querySelector(".spin-mode-thumb");
  thumb.style.width = activeBtn.offsetWidth + "px";
  thumb.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
  if (!sameShape) {
    void thumb.offsetWidth;
    thumb.style.transition = "";
  }
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
