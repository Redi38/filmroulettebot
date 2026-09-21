import { isWeightedMode } from "../settings/weighted-mode.js";
import { setCanvasRotation, wheelPrefersReducedMotion } from "./spin.js";
import { buildWheel } from "./wheel-build.js";
import { getWheelDPR, wheelSpinState } from "./wheel-constants.js";
import { drawWheelSegments, getCanvasRotationDeg, updatePointerTitle } from "./wheel-draw.js";

// Roulette wheel: the resting state. A wheel that nobody has spun yet used
// to sit perfectly still, which read as a static image rather than something
// you could touch. It now drifts very slowly, and highlights whichever
// segment the cursor is over with that title spelled out next to it.
//
// Loaded after spin.js because it uses setCanvasRotation() from there.

// Slow enough that it is not a distraction, fast enough to notice: at this
// rate a full turn takes twenty minutes.
const WHEEL_IDLE_DEG_PER_SEC = 0.3;

function wheelIdleSegmentAt(canvas, clientX, clientY) {
  const boundaries = canvas._wheelBoundaries;
  if (!boundaries || !boundaries.length) return -1;
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const radius = Math.sqrt(dx * dx + dy * dy);
  // Ignore the hub and anything outside the rim.
  if (radius > rect.width / 2 || radius < rect.width * 0.13) return -1;

  const screenDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  // Segment 0 starts at the top (-90deg on screen) of the *unrotated* canvas,
  // so undo the current rotation to get an angle in the wheel's own frame.
  const rotation = getCanvasRotationDeg(canvas);
  let localDeg = (screenDeg + 90 - rotation) % 360;
  if (localDeg < 0) localDeg += 360;

  let idx = boundaries.findIndex((b) => localDeg >= b.start && localDeg < b.end);
  if (idx === -1) idx = localDeg < boundaries[0].start ? 0 : boundaries.length - 1;
  return idx;
}

export function wheelIdleRedraw(canvas, highlightIndex) {
  const items = canvas._wheelItems;
  if (!items || !canvas._wheelBoundaries) return;
  drawWheelSegments(canvas, items, getWheelDPR(), canvas._wheelBoundaries, {
    highlightIndex: highlightIndex === undefined ? -1 : highlightIndex,
  });
}

// In weighted mode every segment has a different size, but a size on its
// own is hard to read as odds; the hover plaque spells them out. Returns
// "" in normal mode (equal segments — nothing to explain) and when the
// wheel is mid-resize between the two modes.
function wheelSegmentOddsText(canvas, idx) {
  if (!isWeightedMode()) return "";
  const b = canvas._wheelBoundaries && canvas._wheelBoundaries[idx];
  if (!b) return "";
  const pct = ((b.end - b.start) / 360) * 100;
  const shown = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  return `${shown}%`;
}

function positionWheelHoverLabel(canvas, clientX, clientY, text, odds) {
  const holder = canvas.closest(".wheel-holder");
  if (!holder) return;
  let label = holder.querySelector(".wheel-hover-label");
  if (!label) {
    label = document.createElement("div");
    label.className = "wheel-hover-label";
    const titleEl = document.createElement("div");
    titleEl.className = "wheel-hover-title";
    const oddsEl = document.createElement("div");
    oddsEl.className = "wheel-hover-odds";
    label.appendChild(titleEl);
    label.appendChild(oddsEl);
    holder.appendChild(label);
  }
  const rect = holder.getBoundingClientRect();
  const key = `${text}\u0000${odds || ""}`;
  if (label._contentKey !== key) {
    label._contentKey = key;
    label.querySelector(".wheel-hover-title").textContent = text;
    const oddsEl = label.querySelector(".wheel-hover-odds");
    oddsEl.textContent = odds || "";
    oddsEl.hidden = !odds;
    // Measure from the left edge, where the full holder width is available:
    // if `width: max-content` is not honoured, the box falls back to
    // shrink-to-fit and its width would otherwise depend on where it was
    // last placed. Only on a text change — reading offsetWidth forces a
    // synchronous layout, and this runs on every pointermove.
    label.style.left = "0px";
    label._plaqueHalfWidth = label.offsetWidth / 2;
  }
  label.style.top = `${clientY - rect.top}px`;

  // The plaque is centred on the cursor (translateX(-50%)), so near either
  // rim half of it would hang outside the holder. Slide it back in rather
  // than let it clip — the pointer is the cursor itself, so the plaque does
  // not have to stay perfectly centred under it.
  const halfWidth = label._plaqueHalfWidth || 0;
  const margin = 6;
  const min = halfWidth + margin;
  const max = rect.width - halfWidth - margin;
  let left = clientX - rect.left;
  // max < min means the plaque is wider than the holder; centre it and let
  // it overhang evenly rather than snapping it to one side.
  left = max >= min ? Math.min(Math.max(left, min), max) : rect.width / 2;
  label.style.left = `${left}px`;
  label.classList.add("visible");
}

export function hideWheelHoverLabel(canvas) {
  const holder = canvas.closest(".wheel-holder");
  const label = holder && holder.querySelector(".wheel-hover-label");
  if (label) label.classList.remove("visible");
}

export function stopWheelIdle(canvas) {
  if (!canvas || !canvas._idleRAF) return;
  cancelAnimationFrame(canvas._idleRAF);
  canvas._idleRAF = null;
}

// Called by buildWheel() once the canvas is drawn. Safe to call twice — the
// previous loop is cancelled first.
export function startWheelIdle(canvas) {
  if (!canvas) return;
  stopWheelIdle(canvas);
  if (wheelPrefersReducedMotion()) return;

  let last = performance.now();
  const tick = (now) => {
    // A spin owns the transform while it runs; the landing state should stay
    // put afterwards, so the drift does not resume on its own.
    if (wheelSpinState.active) {
      canvas._idleRAF = null;
      return;
    }
    const dt = (now - last) / 1000;
    last = now;
    if (!canvas._idleHovering && canvas.isConnected) {
      const deg = getCanvasRotationDeg(canvas) + WHEEL_IDLE_DEG_PER_SEC * dt;
      setCanvasRotation(canvas, deg);
      updatePointerTitle(canvas, ((deg % 360) + 360) % 360, false);
    }
    canvas._idleRAF = canvas.isConnected ? requestAnimationFrame(tick) : null;
  };
  canvas._idleRAF = requestAnimationFrame(tick);
}

// Hover highlighting lives on the mask rather than the canvas, because the
// canvas is rotating and its own box rotates with it.
export function attachWheelHover(canvas, mask) {
  if (!canvas || !mask) return;

  const isLocked = () => wheelSpinState.active || canvas._hoverLocked;

  const clear = () => {
    canvas._idleHovering = false;
    if (canvas._idleHoverIdx !== -1) {
      canvas._idleHoverIdx = -1;
      // Not while locked: that redraw would wipe the winner's highlight the
      // moment the cursor left the wheel.
      if (!isLocked()) wheelIdleRedraw(canvas, -1);
    }
    if (!isLocked()) hideWheelHoverLabel(canvas);
  };

  canvas._idleHoverIdx = -1;

  mask.addEventListener("pointermove", (ev) => {
    if (isLocked() || ev.pointerType === "touch") return;
    const idx = wheelIdleSegmentAt(canvas, ev.clientX, ev.clientY);
    if (idx === -1) { clear(); return; }
    // Pausing the drift while a segment is being read keeps the label from
    // changing out from under the cursor.
    canvas._idleHovering = true;
    if (idx !== canvas._idleHoverIdx) {
      canvas._idleHoverIdx = idx;
      wheelIdleRedraw(canvas, idx);
    }
    const items = canvas._wheelItems || [];
    positionWheelHoverLabel(canvas, ev.clientX, ev.clientY, items[idx] || "", wheelSegmentOddsText(canvas, idx));
  });

  mask.addEventListener("pointerleave", clear);
  mask.addEventListener("pointercancel", clear);
}
