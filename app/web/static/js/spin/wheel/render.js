// Roulette wheel: DOM construction and canvas rendering.

let wheelSpinActive = false;

const WHEEL_COLORS = [
  "#8b7cf6", "#5b8def", "#34d399", "#f2596b",
  "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a",
  "#a78bfa", "#4fb8f7", "#67e08a", "#f4738c",
  "#ffd166", "#d67cf0", "#45d4c9", "#ff9f68"
];
const WHEEL_HUB_GIF_URL = "";
const WHEEL_WRAP_IDS = ["random-wheel-wrap", "spin-wheel-wrap"];

function getWheelStyle() {
  return typeof getWheelAppearance === "function" ? getWheelAppearance() : "classic";
}

function getWheelDPR() {
  const raw = window.devicePixelRatio || 1;
  return Math.min(3, Math.max(2, raw));
}

function getDockFor(wrap) {
  return wrap.parentElement && wrap.parentElement.querySelector(".spin-controls-dock");
}

function pluralizeTitles(n) {
  const mod10 = n % 10, mod100 = n % 100;
  let word;
  if (mod10 === 1 && mod100 !== 11) word = "позиция";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = "позиции";
  else word = "позиций";
  return `${n} ${word}`;
}

function resetWheelWraps() {
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap) continue;
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    wrap.style.display = "none";
    wrap.style.minHeight = "";
    wrap.style.paddingTop = "";
    wrap._wheelPool = null;
    wrap._wheelWeights = null;
  }
  updateWheelScrollLock();
}

function updateWheelScrollLock() {
}

async function showIdleWheel(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap) return;
  try {
    const weighted = typeof isWeightedMode === "function" ? isWeightedMode() : false;
    const data = await api(`/api/${cat}/wheel-preview?weighted=${weighted}`);
    const pool = data.wheel_pool;
    if (!pool || pool.length < 2) return;
    wrap.classList.remove("wheel-done");
    await nextSettledFrame();
    if (!wrap.isConnected || document.getElementById("spin-wheel-wrap") !== wrap) return;
    buildWheel("spin-wheel-wrap", pool, data.wheel_weights);
    document.getElementById("spin-result").innerHTML = "";
    if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
  } catch (e) {
  }
}

function buildWheel(wrapId, items, weights) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.minHeight = "";
  wrap.style.paddingTop = "";
  wrap.style.display = "flex";
  wrap._wheelPool = items;
  wrap._wheelWeights = weights;

  const dock = getDockFor(wrap);
  const dockClearance = computeDockClearance(wrap, dock);
  wrap.style.paddingTop = dockClearance + "px";

  const top = wrap.getBoundingClientRect().top;
  const pageBottomGap = getWheelBottomGap(wrap);
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const availableHeight = viewportHeight - top - pageBottomGap - dockClearance;
  const availableWidth = wrap.clientWidth;
  const cssSize = computeWheelSize(availableWidth, availableHeight);
  const heightBudget = Math.max(0, viewportHeight - top - pageBottomGap);
  wrap.style.minHeight = Math.min(cssSize + dockClearance + WHEEL_VERTICAL_RESERVE, heightBudget) + "px";
  wrap._wheelBuiltSize = cssSize;

  const titleEl = document.createElement("div");
  titleEl.className = "wheel-current-title";
  wrap.appendChild(titleEl);

  const holder = document.createElement("div");
  holder.className = "wheel-holder wheel-holder--" + getWheelStyle();
  const pointer = document.createElement("div");
  pointer.className = "wheel-pointer";
  const canvasMask = document.createElement("div");
  canvasMask.className = "wheel-canvas-mask";
  const canvas = document.createElement("canvas");
  canvas.className = "wheel-canvas";
  const dpr = getWheelDPR();
  holder.style.width = cssSize + "px";
  holder.style.height = cssSize + "px";
  canvasMask.style.width = cssSize + "px";
  canvasMask.style.height = cssSize + "px";
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  canvasMask.appendChild(canvas);
  holder.appendChild(canvasMask);
  holder.appendChild(pointer);
  const hubUrl = typeof getWheelHubImage === "function" ? getWheelHubImage() : WHEEL_HUB_GIF_URL;
  const hubMedia = document.createElement("div");
  hubMedia.className = "wheel-hub-media";
  hubMedia.tabIndex = 0;
  const overlay = document.createElement("div");
  overlay.className = "wheel-hub-overlay";
  overlay.textContent = "Изменить";
  if (hubUrl) {
    const img = document.createElement("img");
    img.src = hubUrl;
    img.alt = "";
    img.onerror = () => { img.remove(); hubMedia.classList.add("wheel-hub-empty"); };
    hubMedia.appendChild(img);
  } else {
    hubMedia.classList.add("wheel-hub-empty");
  }
  hubMedia.appendChild(overlay);
  holder.appendChild(hubMedia);
  wrap.appendChild(holder);

  const countEl = document.createElement("div");
  countEl.className = "wheel-count-label";
  countEl.textContent = pluralizeTitles(items.length);
  wrap.appendChild(countEl);

  drawWheel(canvas, items, dpr, weights);
  canvas._wheelItems = items;
  canvas._wheelTitleEl = titleEl;
  updatePointerTitle(canvas, 0);
  updateWheelScrollLock();
  return canvas;
}

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
