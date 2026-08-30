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

function updatePointerTitle(canvas, rotationDeg, playTick) {
  const items = canvas._wheelItems;
  const boundaries = canvas._wheelBoundaries;
  const titleEl = canvas._wheelTitleEl;
  if (!items || !boundaries || !titleEl || !items.length) return;
  const angleAtPointer = ((360 - rotationDeg) % 360 + 360) % 360;
  let idx = boundaries.findIndex((b) => angleAtPointer >= b.start && angleAtPointer < b.end);
  if (idx === -1) idx = angleAtPointer < boundaries[0].start ? 0 : boundaries.length - 1;
  if (playTick && canvas._wheelPointerIdx !== undefined && canvas._wheelPointerIdx !== idx) {
    playWheelTick();
  }
  canvas._wheelPointerIdx = idx;
  const label = items[idx] || "";
  if (titleEl.textContent !== label) titleEl.textContent = label;
}

function drawWheel(canvas, items, dpr, weights) {
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
  const boundaries = computeWheelBoundaries(n, weights);
  canvas._wheelBoundaries = boundaries;

  for (let i = 0; i < n; i++) {
    const start = -Math.PI / 2 + boundaries[i].start * Math.PI / 180;
    const end = -Math.PI / 2 + boundaries[i].end * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(9,12,22,0.55)";
    ctx.lineWidth = n > 40 ? 1 : 2;
    ctx.stroke();

    const segDeg = boundaries[i].end - boundaries[i].start;
    const arcLen = (segDeg * Math.PI / 180) * r;
    const fontSize = Math.max(8, Math.min(22, arcLen * 0.55));
    const maxChars = Math.max(4, Math.min(28, Math.floor((r * 0.66) / (fontSize * 0.56))));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((start + end) / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${fontSize}px Manrope, sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 2;
    let label = items[i] || "";
    if (label.length > maxChars) label = label.slice(0, Math.max(maxChars - 1, 1)) + "…";
    ctx.fillText(label, r - 10, fontSize * 0.32);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(16, cssSize * 0.045), 0, Math.PI * 2);
  ctx.fillStyle = "#17132c";
  ctx.fill();
  ctx.strokeStyle = "#342a5c";
  ctx.lineWidth = 2;
  ctx.stroke();
}
