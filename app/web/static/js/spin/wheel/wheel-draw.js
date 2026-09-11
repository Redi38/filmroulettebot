// Roulette wheel: canvas rendering — drawing the segments/labels and
// tracking which segment the pointer currently sits over. DOM construction
// lives in wheel-build.js (loaded before this file, which calls into it).

function getCanvasRotationDeg(canvas) {
  const transform = getComputedStyle(canvas).transform;
  if (!transform || transform === "none") return 0;
  const match = transform.match(/matrix\(([^)]+)\)/);
  if (!match) return 0;
  const parts = match[1].split(",").map(Number);
  const [a, b] = parts;
  let deg = Math.atan2(b, a) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  return deg;
}

// `onCross` (optional) fires whenever the pointer moves onto a new segment —
// used by spin.js to flick the pointer in sync with the audio tick.
function updatePointerTitle(canvas, rotationDeg, playTick, onCross) {
  const items = canvas._wheelItems;
  const boundaries = canvas._wheelBoundaries;
  const titleEl = canvas._wheelTitleEl;
  if (!items || !boundaries || !titleEl || !items.length) return;
  const angleAtPointer = ((360 - rotationDeg) % 360 + 360) % 360;
  let idx = boundaries.findIndex((b) => angleAtPointer >= b.start && angleAtPointer < b.end);
  if (idx === -1) idx = angleAtPointer < boundaries[0].start ? 0 : boundaries.length - 1;
  if (canvas._wheelPointerIdx !== undefined && canvas._wheelPointerIdx !== idx) {
    if (playTick) playWheelTick();
    if (typeof onCross === "function") onCross(idx);
  }
  canvas._wheelPointerIdx = idx;
  const label = items[idx] || "";
  if (titleEl.textContent !== label) titleEl.textContent = label;
}

function animateWheelWeights(canvas, items, dpr, toWeights, duration = 420) {
  if (canvas._wheelResizeRAF) cancelAnimationFrame(canvas._wheelResizeRAF);
  const fromBoundaries = canvas._wheelBoundaries || computeWheelBoundaries(items.length, null);
  const toBoundaries = computeWheelBoundaries(items.length, toWeights);
  const n = items.length;
  const startTime = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  // A full redraw touches every segment (fill + stroke + two text passes)
  // over the whole canvas, so its cost scales with the backing-store pixel
  // count — at dpr 2-3 that's 4-9x the pixels of a 1x canvas. Doing that on
  // every animation frame is what reads as jank when switching normal/
  // weighted mode. So: animate at dpr 1 (the canvas is briefly upscaled by
  // the browser, which is imperceptible for a 420ms transition) and only
  // pay the full-resolution cost once, on the settled final frame.
  const cssSize = canvas.width / dpr;
  const animDpr = 1;
  canvas.width = canvas.height = Math.round(cssSize * animDpr);

  return new Promise((resolve) => {
    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const e = ease(t);
      const frameBoundaries = new Array(n);
      for (let i = 0; i < n; i++) {
        frameBoundaries[i] = {
          start: fromBoundaries[i].start + (toBoundaries[i].start - fromBoundaries[i].start) * e,
          end: fromBoundaries[i].end + (toBoundaries[i].end - fromBoundaries[i].end) * e,
        };
      }
      canvas._wheelBoundaries = frameBoundaries;
      drawWheelSegments(canvas, items, animDpr, frameBoundaries, {animating: true});
      if (t < 1) {
        canvas._wheelResizeRAF = requestAnimationFrame(step);
      } else {
        canvas._wheelResizeRAF = null;
        canvas.width = canvas.height = Math.round(cssSize * dpr);
        drawWheelSegments(canvas, items, dpr, toBoundaries);
        updatePointerTitle(canvas, getCanvasRotationDeg(canvas));
        resolve();
      }
    }
    canvas._wheelResizeRAF = requestAnimationFrame(step);
  });
}

function drawWheel(canvas, items, dpr, weights) {
  const boundaries = computeWheelBoundaries(items.length, weights);
  drawWheelSegments(canvas, items, dpr, boundaries);
  canvas._wheelBoundaries = boundaries;
}

// Labels narrower than this (in px of arc at the rim) are skipped: at that
// size they are unreadable anyway and just add visual noise. The current
// segment is always shown in the pointer title above the wheel.
const WHEEL_LABEL_MIN_ARC_PX = 14;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}
function shadeHex(hex, amount) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c + amount))));
  return `rgb(${r},${g},${b})`;
}

function drawWheelSegments(canvas, items, dpr, boundaries, {animating = false, highlightIndex = -1} = {}) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.scale(dpr, dpr);
  const cssSize = size / dpr;
  const cx = cssSize / 2, cy = cssSize / 2, r = cssSize / 2 - 3;
  const n = items.length;
  const highlighting = highlightIndex >= 0;

  // Rendering is identical whether or not we're mid-animation: switching
  // fills/strokes on and off between frames reads as flicker. Gradients are
  // shared per palette colour, so at most WHEEL_COLORS.length are built.
  const gradientCache = new Map();
  const segmentFill = (color) => {
    let g = gradientCache.get(color);
    if (!g) {
      g = ctx.createRadialGradient(cx, cy, r * 0.18, cx, cy, r);
      g.addColorStop(0, shadeHex(color, -34));
      g.addColorStop(0.55, color);
      g.addColorStop(1, shadeHex(color, 22));
      gradientCache.set(color, g);
    }
    return g;
  };

  for (let i = 0; i < n; i++) {
    const start = -Math.PI / 2 + boundaries[i].start * Math.PI / 180;
    const end = -Math.PI / 2 + boundaries[i].end * Math.PI / 180;
    const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    const dimmed = highlighting && i !== highlightIndex;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = segmentFill(color);
    ctx.fill();
    if (dimmed) {
      ctx.fillStyle = "rgba(9,12,22,0.68)";
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(9,12,22,0.55)";
    ctx.lineWidth = n > 40 ? 1 : 2;
    ctx.stroke();

    const segDeg = boundaries[i].end - boundaries[i].start;
    const arcLen = (segDeg * Math.PI / 180) * r;
    if (arcLen < WHEEL_LABEL_MIN_ARC_PX && !(highlighting && i === highlightIndex)) continue;

    // Round while animating so glyph sizes don't shimmer between frames.
    let fontSize = Math.max(9, Math.min(22, arcLen * 0.55));
    if (animating) fontSize = Math.round(fontSize);
    const maxChars = Math.max(4, Math.min(28, Math.floor((r * 0.66) / (fontSize * 0.56))));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((start + end) / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fontSize}px Manrope, sans-serif`;
    let label = items[i] || "";
    if (label.length > maxChars) label = label.slice(0, Math.max(maxChars - 1, 1)) + "…";
    // A thin dark stroke gives the same legibility as shadowBlur at a
    // fraction of the cost (shadowBlur is one of the slowest canvas ops).
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, fontSize * 0.18);
    ctx.strokeStyle = "rgba(9,12,22,0.55)";
    ctx.strokeText(label, r - 12, 0);
    ctx.fillStyle = dimmed ? "rgba(255,255,255,0.55)" : "#fff";
    ctx.fillText(label, r - 12, 0);
    ctx.restore();
  }

  if (highlighting) {
    // Glow ring on the winner's outer edge.
    const b = boundaries[highlightIndex];
    const start = -Math.PI / 2 + b.start * Math.PI / 180;
    const end = -Math.PI / 2 + b.end * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
  }

  // Outer bevel: a soft light rim on top, darker at the bottom.
  const rim = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  rim.addColorStop(0, "rgba(255,255,255,0.28)");
  rim.addColorStop(0.5, "rgba(255,255,255,0.04)");
  rim.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = rim;
  ctx.stroke();

  // Hub: a slightly larger dark disc with an inner ring, so the hub media
  // (which sits above it in the DOM) reads as set into the wheel.
  const hubR = Math.max(16, cssSize * 0.045);
  ctx.beginPath();
  ctx.arc(cx, cy, hubR + 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(9,12,22,0.35)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
  ctx.fillStyle = "#17132c";
  ctx.fill();
  ctx.strokeStyle = "#342a5c";
  ctx.lineWidth = 2;
  ctx.stroke();
}
