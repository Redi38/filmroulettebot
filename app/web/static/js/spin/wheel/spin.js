import { predictWheelSize } from "./layout.js";
import { playWheelStop } from "./wheel-audio.js";
import { buildSettledWheel, buildWheel } from "./wheel-build.js";
import { WHEEL_WRAP_IDS, getWheelDPR, wheelSpinState } from "./wheel-constants.js";
import { drawWheel, drawWheelSegments, getCanvasRotationDeg, updatePointerTitle } from "./wheel-draw.js";
import { hideWheelHoverLabel, stopWheelIdle, wheelIdleRedraw } from "./wheel-idle.js";

const WHEEL_REDUCED_MOTION_SPIN_MS = 500;
const WHEEL_EXTRA_SPINS = 6;

function scheduleWheelFrame(cb) {
  return document.hidden
    ? {timeoutId: setTimeout(() => cb(performance.now()), 16)}
    : {rafId: requestAnimationFrame(cb)};
}
function cancelWheelFrame(handle) {
  if (!handle) return;
  if (handle.rafId != null) cancelAnimationFrame(handle.rafId);
  if (handle.timeoutId != null) clearTimeout(handle.timeoutId);
}

export function wheelPrefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Friction-like deceleration: fast start, long smooth tail. Quartic ease-out
// keeps the last ~20% of the spin slow enough to read, without the "instant
// stop" feel of a cubic-bezier that has already flattened at 50%.
function wheelSpinEase(t) {
  return 1 - Math.pow(1 - t, 4);
}

export function setCanvasRotation(canvas, deg) {
  // Kept alongside the style so a rebuild can carry the angle over without
  // parsing it back out of a computed matrix.
  canvas._rotationDeg = deg;
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

// The wheel overshoots its resting angle by this much and then eases back,
// so the stop reads as momentum being absorbed rather than the animation
// simply reaching the end of its timeline. Overshooting *forward* and
// settling back means the final angle is still exactly the winning one.
const WHEEL_SETTLE_REBOUND_DEG = 1.6;
const WHEEL_SETTLE_REBOUND_MS = 260;

function settleWheelRebound(canvas, fromDeg, toDeg, onFrame) {
  return new Promise((resolve) => {
    const start = performance.now();
    const delta = toDeg - fromDeg;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - start) / WHEEL_SETTLE_REBOUND_MS);
      const deg = fromDeg + delta * ease(t);
      setCanvasRotation(canvas, deg);
      if (onFrame) onFrame(deg);
      if (t < 1) scheduleWheelFrame(step);
      else resolve();
    };
    scheduleWheelFrame(step);
  });
}

export function spinWheelTo(canvas, n, winnerIndex, durationMs) {
  wheelSpinState.active = true;
  if (typeof stopWheelIdle === "function") stopWheelIdle(canvas);
  if (typeof hideWheelHoverLabel === "function") hideWheelHoverLabel(canvas);
  canvas._idleHovering = false;
  canvas._hoverLocked = true;
  canvas._idleHoverIdx = -1;
  if (typeof wheelIdleRedraw === "function") wheelIdleRedraw(canvas, -1);
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
    const endDeg = startDeg + extraSpins * 360 + deltaToTarget;
    // Aim past the winning angle; the rebound below walks the difference off.
    const overshoot = reduced ? 0 : WHEEL_SETTLE_REBOUND_DEG;
    const overshootDeg = endDeg + overshoot;
    const totalDelta = overshootDeg - startDeg;

    const onCross = reduced ? null : () => flickWheelPointer(canvas);
    const startTime = performance.now();
    let frameHandle;

    const finish = () => {
      cancelWheelFrame(frameHandle);
      setCanvasRotation(canvas, overshootDeg);
      updatePointerTitle(canvas, ((overshootDeg % 360) + 360) % 360, true, onCross);
      playWheelStop();
      const settle = overshoot
        ? settleWheelRebound(canvas, overshootDeg, endDeg, (deg) => {
            updatePointerTitle(canvas, ((deg % 360) + 360) % 360, false, null);
          })
        : Promise.resolve();
      settle.then(() => {
        setCanvasRotation(canvas, endDeg);
        updatePointerTitle(canvas, ((endDeg % 360) + 360) % 360, false, null);
        wheelSpinState.active = false;
        resolve();
      });
    };

    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const deg = startDeg + totalDelta * wheelSpinEase(t);
      setCanvasRotation(canvas, deg);
      updatePointerTitle(canvas, ((deg % 360) + 360) % 360, true, onCross);
      if (t < 1) frameHandle = scheduleWheelFrame(tick);
      else finish();
    };
    frameHandle = scheduleWheelFrame(tick);
  });
}

// Landing sequence: dim the losing segments, glow the winner, let the
// pointer title pop. Resolves once the highlight has had time to register.
const WHEEL_WINNER_HOLD_MS = 700;

export function highlightWheelWinner(canvas, winnerIndex) {
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

// Both go through buildSettledWheel rather than buildWheel: a rebuild is a
// re-measurement, and painting the result before checking it is exactly how
// the wheel ended up visibly growing on screen. The wheel is hidden for the
// frame or two the check takes, and its rotation carries over, so a rebuild
// at the same size is invisible.
export function rebuildVisibleWheels() {
  if (wheelSpinState.active) return;
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    if (wrap.classList.contains("wheel-wrap--settling")) continue; // already re-measuring
    const predicted = predictWheelSize(wrap);
    if (Math.abs(predicted - (wrap._wheelBuiltSize || 0)) < 3) continue;
    buildSettledWheel(id, wrap._wheelPool, wrap._wheelWeights, wrap._wheelPosters);
  }
}

export function forceRebuildVisibleWheels() {
  if (wheelSpinState.active) return;
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    buildSettledWheel(id, wrap._wheelPool, wrap._wheelWeights, wrap._wheelPosters);
  }
}

export function redrawVisibleWheelCanvases() {
  if (wheelSpinState.active) return;
  const dpr = getWheelDPR();
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    const canvas = wrap.querySelector(".wheel-canvas");
    if (!canvas) continue;
    drawWheel(canvas, wrap._wheelPool, dpr, wrap._wheelWeights);
  }
}
