// Roulette wheel: canvas drawing, spin animation, pointer title tracking.

async function showIdleWheel(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap) return;
  try {
    const data = await api(`/api/${cat}/wheel-preview`);
    const pool = data.wheel_pool;
    if (!pool || pool.length < 2) return;
    wrap.classList.remove("wheel-done");
    buildWheel("spin-wheel-wrap", pool);
    document.getElementById("spin-result").innerHTML = "";
  } catch (e) {
  }
}

function resetWheelWraps() {
  for (const id of ["random-wheel-wrap", "spin-wheel-wrap"]) {
    const wrap = document.getElementById(id);
    if (!wrap) continue;
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    wrap.style.display = "none";
    wrap.style.minHeight = "";
  }
}

const WHEEL_COLORS = [
  "#8b7cf6", "#5b8def", "#34d399", "#f2596b",
  "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a",
  "#a78bfa", "#4fb8f7", "#67e08a", "#f4738c",
  "#ffd166", "#d67cf0", "#45d4c9", "#ff9f68"
];
const WHEEL_MIN_SIZE = 260;
const WHEEL_MAX_SIZE = 960;

function buildWheel(wrapId, items) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.minHeight = "";
  wrap.style.display = "flex";

  const top = wrap.getBoundingClientRect().top;
  const pageBottomGap = 12;
  const availableHeight = window.innerHeight - top - pageBottomGap;
  const availableWidth = wrap.clientWidth;
  const cssSize = Math.min(
    Math.max(Math.min(availableWidth, availableHeight) - 4, WHEEL_MIN_SIZE),
    WHEEL_MAX_SIZE
  );
  wrap.style.minHeight = cssSize + "px";

  const titleEl = document.createElement("div");
  titleEl.className = "wheel-current-title";
  wrap.appendChild(titleEl);

  const holder = document.createElement("div");
  holder.className = "wheel-holder";
  const pointer = document.createElement("div");
  pointer.className = "wheel-pointer";
  const canvas = document.createElement("canvas");
  canvas.className = "wheel-canvas";
  const dpr = window.devicePixelRatio || 1;
  holder.style.width = cssSize + "px";
  holder.style.height = cssSize + "px";
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  holder.appendChild(canvas);
  holder.appendChild(pointer);
  wrap.appendChild(holder);

  drawWheel(canvas, items, dpr);
  canvas._wheelItems = items;
  canvas._wheelTitleEl = titleEl;
  updatePointerTitle(canvas, 0);
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

function updatePointerTitle(canvas, rotationDeg) {
  const items = canvas._wheelItems;
  const titleEl = canvas._wheelTitleEl;
  if (!items || !titleEl || !items.length) return;
  const n = items.length;
  const segDeg = 360 / n;
  const angleAtPointer = ((360 - rotationDeg) % 360 + 360) % 360;
  let idx = Math.floor(angleAtPointer / segDeg) % n;
  if (idx < 0) idx += n;
  const label = items[idx] || "";
  if (titleEl.textContent !== label) titleEl.textContent = label;
}

function drawWheel(canvas, items, dpr) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.scale(dpr, dpr);
  const cssSize = size / dpr;
  const cx = cssSize / 2, cy = cssSize / 2, r = cssSize / 2 - 3;
  const n = items.length;
  const seg = (Math.PI * 2) / n;

  const arcLen = seg * r;
  const fontSize = Math.max(8, Math.min(22, arcLen * 0.55));
  const maxChars = Math.max(4, Math.min(28, Math.floor((r * 0.66) / (fontSize * 0.56))));

  for (let i = 0; i < n; i++) {
    const start = -Math.PI / 2 + i * seg;
    const end = start + seg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(9,12,22,0.55)";
    ctx.lineWidth = n > 40 ? 1 : 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + seg / 2);
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

function spinWheelTo(canvas, n, winnerIndex, durationMs) {
  return new Promise((resolve) => {
    const segDeg = 360 / n;
    const centerDeg = winnerIndex * segDeg + segDeg / 2;
    const jitter = (Math.random() - 0.5) * (segDeg * 0.5);
    const finalMod = ((360 - centerDeg - jitter) % 360 + 360) % 360;
    const extraSpins = 6;
    const totalDeg = extraSpins * 360 + finalMod;

    canvas.style.transition = "none";
    canvas.style.transform = "rotate(0deg)";
    void canvas.offsetWidth;
    canvas.style.transition = `transform ${durationMs}ms cubic-bezier(0.11, 0.82, 0.2, 1)`;
    requestAnimationFrame(() => {
      canvas.style.transform = `rotate(${totalDeg}deg)`;
    });

    let rafId;
    const startTime = performance.now();
    const tick = () => {
      const rotDeg = getCanvasRotationDeg(canvas);
      updatePointerTitle(canvas, rotDeg);
      if (performance.now() - startTime < durationMs) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);

    setTimeout(() => {
      cancelAnimationFrame(rafId);
      updatePointerTitle(canvas, ((totalDeg % 360) + 360) % 360);
      resolve();
    }, durationMs);
  });
}
