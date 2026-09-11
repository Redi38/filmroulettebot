// Roulette wheel: spin animation and rebuild/redraw triggers for visible wheels.
//
// The spin is driven from JS (rAF) rather than a CSS transition so that:
//   * the deceleration follows a friction curve (ticks are evenly spaced in
//     "distance", not bunched at the start);
//   * we know the exact angle every frame without forcing style recalc via
//     getComputedStyle();
//   * the pointer can "flick" on every segment boundary it passes;
//   * prefers-reduced-motion can shorten the spin without touching CSS.

const WHEEL_REDUCED_MOTION_SPIN_MS = 500;
const WHEEL_EXTRA_SPINS = 6;

function wheelPrefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Friction-like deceleration: fast start, long smooth tail. Quartic ease-out
// keeps the last ~20% of the spin slow enough to read, without the "instant
// stop" feel of a cubic-bezier that has already flattened at 50%.
function wheelSpinEase(t) {
  return 1 - Math.pow(1 - t, 4);
}

function setCanvasRotation(canvas, deg) {
  canvas.style.transform = `rotate(${deg}deg)`;
}

function flickWheelPointer(canvas) {
  const holder = canvas.closest(".wheel-holder");
  const pointer = holder && holder.querySelector(".wheel-pointer");
  if (!pointer) return;
  pointer.classList.remove("wheel-pointer--flick");
  void pointer.offsetWidth;
  pointer.classList.add("wheel-pointer--flick");
}

function spinWheelTo(canvas, n, winnerIndex, durationMs) {
  wheelSpinActive = true;
  return new Promise((resolve) => {
    const boundaries = canvas._wheelBoundaries || Array.from({length: n}, (_, i) => ({start: i * (360 / n), end: (i + 1) * (360 / n)}));
    const seg = boundaries[winnerIndex];
    const segSpan = seg.end - seg.start;
    const centerDeg = seg.start + segSpan / 2;
    const jitter = (Math.random() - 0.5) * (segSpan * 0.5);
    const finalMod = ((360 - centerDeg - jitter) % 360 + 360) % 360;

    // Continue from the current angle (e.g. after a re-spin) rather than
    // snapping back to 0° first.
    const startDeg = getCanvasRotationDeg(canvas);
    canvas.style.transition = "none";
    setCanvasRotation(canvas, startDeg);

    const reduced = wheelPrefersReducedMotion();
    const duration = reduced ? Math.min(durationMs, WHEEL_REDUCED_MOTION_SPIN_MS) : durationMs;
    const extraSpins = reduced ? 1 : WHEEL_EXTRA_SPINS;
    const startMod = ((startDeg % 360) + 360) % 360;
    const deltaToTarget = ((finalMod - startMod) % 360 + 360) % 360;
    const totalDelta = extraSpins * 360 + deltaToTarget;
    const endDeg = startDeg + totalDelta;

    const onCross = reduced ? null : () => flickWheelPointer(canvas);
    const startTime = performance.now();
    let rafId;

    const finish = () => {
      cancelAnimationFrame(rafId);
      setCanvasRotation(canvas, endDeg);
      updatePointerTitle(canvas, ((endDeg % 360) + 360) % 360, true, onCross);
      wheelSpinActive = false;
      playWheelStop();
      resolve();
    };

    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const deg = startDeg + totalDelta * wheelSpinEase(t);
      setCanvasRotation(canvas, deg);
      updatePointerTitle(canvas, ((deg % 360) + 360) % 360, true, onCross);
      if (t < 1) rafId = requestAnimationFrame(tick);
      else finish();
    };
    rafId = requestAnimationFrame(tick);
  });
}

// Landing sequence: dim the losing segments, glow the winner, let the
// pointer title pop. Resolves once the highlight has had time to register.
const WHEEL_WINNER_HOLD_MS = 700;

function highlightWheelWinner(canvas, winnerIndex) {
  const items = canvas._wheelItems;
  if (!items || !canvas._wheelBoundaries) return Promise.resolve();
  const dpr = getWheelDPR();
  drawWheelSegments(canvas, items, dpr, canvas._wheelBoundaries, {highlightIndex: winnerIndex});
  const titleEl = canvas._wheelTitleEl;
  if (titleEl) {
    titleEl.classList.remove("wheel-current-title--win");
    void titleEl.offsetWidth;
    titleEl.classList.add("wheel-current-title--win");
  }
  const hold = wheelPrefersReducedMotion() ? 200 : WHEEL_WINNER_HOLD_MS;
  return new Promise((r) => setTimeout(r, hold));
}

function rebuildVisibleWheels() {
  if (wheelSpinActive) return;
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    const predicted = predictWheelSize(wrap);
    if (Math.abs(predicted - (wrap._wheelBuiltSize || 0)) < 3) continue;
    buildWheel(id, wrap._wheelPool, wrap._wheelWeights);
  }
}

function forceRebuildVisibleWheels() {
  if (wheelSpinActive) return;
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    buildWheel(id, wrap._wheelPool, wrap._wheelWeights);
  }
}

function redrawVisibleWheelCanvases() {
  if (wheelSpinActive) return;
  const dpr = getWheelDPR();
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    const canvas = wrap.querySelector(".wheel-canvas");
    if (!canvas) continue;
    drawWheel(canvas, wrap._wheelPool, dpr, wrap._wheelWeights);
  }
}
