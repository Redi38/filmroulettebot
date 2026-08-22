// Roulette wheel: canvas drawing, spin animation, pointer title tracking.

let wheelSpinActive = false;

function fontsSettled() {
  const fontsReady = (document.fonts && document.fonts.ready)
    ? document.fonts.ready
    : Promise.resolve();
  return Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, 800))]);
}

function nextSettledFrame() {
  return fontsSettled().then(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function showIdleWheel(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap) return;
  try {
    const data = await api(`/api/${cat}/wheel-preview`);
    const pool = data.wheel_pool;
    if (!pool || pool.length < 2) return;
    wrap.classList.remove("wheel-done");
    await nextSettledFrame();
    if (!wrap.isConnected || document.getElementById("spin-wheel-wrap") !== wrap) return;
    buildWheel("spin-wheel-wrap", pool);
    document.getElementById("spin-result").innerHTML = "";
  } catch (e) {
  }
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
  for (const id of ["random-wheel-wrap", "spin-wheel-wrap"]) {
    const wrap = document.getElementById(id);
    if (!wrap) continue;
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    wrap.style.display = "none";
    wrap.style.minHeight = "";
    wrap.style.paddingTop = "";
    wrap._wheelPool = null;
  }
  updateWheelScrollLock();
}

function updateWheelScrollLock() {
  const anyWheelOpen = ["random-wheel-wrap", "spin-wheel-wrap"].some((id) => {
    const wrap = document.getElementById(id);
    return !!wrap && wrap.style.display !== "none" && wrap.offsetParent !== null;
  });
  document.documentElement.classList.toggle("wheel-scroll-lock", anyWheelOpen);
  document.body.classList.toggle("wheel-scroll-lock", anyWheelOpen);
}

const WHEEL_COLORS = [
  "#8b7cf6", "#5b8def", "#34d399", "#f2596b",
  "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a",
  "#a78bfa", "#4fb8f7", "#67e08a", "#f4738c",
  "#ffd166", "#d67cf0", "#45d4c9", "#ff9f68"
];
const WHEEL_MIN_SIZE = 260;
const WHEEL_MAX_SIZE = 1100;
const WHEEL_HUB_GIF_URL = "";
const WHEEL_VERTICAL_RESERVE = 70;

function computeWheelSize(availableWidth, availableHeight) {
  return Math.min(
    Math.max(Math.min(availableWidth, availableHeight - WHEEL_VERTICAL_RESERVE) - 4, WHEEL_MIN_SIZE),
    WHEEL_MAX_SIZE
  );
}

function computeDockClearance(wrap, dock) {
  if (!dock) return 0;
  const dockPos = getComputedStyle(dock).position;
  if (dockPos !== "absolute" && dockPos !== "fixed") return 0;
  const dockRect = dock.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const wrapTop = wrapRect.top - (parseFloat(wrap.style.paddingTop) || 0);
  if (dockRect.bottom <= wrapTop) return 0;
  const availableWidth = wrap.clientWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const provisionalHeight = viewportHeight - wrapTop - 16;
  const provisionalSize = computeWheelSize(availableWidth, provisionalHeight);
  const contentCenterX = wrapRect.left + wrapRect.width / 2;
  const contentRight = contentCenterX + provisionalSize / 2;
  if (contentRight <= dockRect.left) return 0;
  return Math.max(0, Math.ceil(dockRect.bottom - wrapTop) + 14);
}

function buildWheel(wrapId, items) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.minHeight = "";
  wrap.style.paddingTop = "";
  wrap.style.display = "flex";
  wrap._wheelPool = items;

  const dock = wrap.parentElement && wrap.parentElement.querySelector(".spin-controls-dock");
  const dockClearance = computeDockClearance(wrap, dock);
  wrap.style.paddingTop = dockClearance + "px";

  const top = wrap.getBoundingClientRect().top;
  const pageBottomGap = 16;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const availableHeight = viewportHeight - top - pageBottomGap - dockClearance;
  const availableWidth = wrap.clientWidth;
  const cssSize = computeWheelSize(availableWidth, availableHeight);
  wrap.style.minHeight = (cssSize + dockClearance + WHEEL_VERTICAL_RESERVE) + "px";
  wrap._wheelBuiltSize = cssSize;

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

  drawWheel(canvas, items, dpr);
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
  wheelSpinActive = true;
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
      wheelSpinActive = false;
      resolve();
    }, durationMs);
  });
}

function predictWheelSize(wrap) {
  const dock = wrap.parentElement && wrap.parentElement.querySelector(".spin-controls-dock");
  const dockClearance = computeDockClearance(wrap, dock);
  const top = wrap.getBoundingClientRect().top - (parseFloat(wrap.style.paddingTop) || 0);
  const pageBottomGap = 16;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const availableHeight = viewportHeight - top - pageBottomGap - dockClearance;
  const availableWidth = wrap.clientWidth;
  return computeWheelSize(availableWidth, availableHeight);
}

function rebuildVisibleWheels() {
  if (wheelSpinActive) return;
  for (const id of ["random-wheel-wrap", "spin-wheel-wrap"]) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    const predicted = predictWheelSize(wrap);
    if (Math.abs(predicted - (wrap._wheelBuiltSize || 0)) < 3) continue;
    buildWheel(id, wrap._wheelPool);
  }
}

function forceRebuildVisibleWheels() {
  if (wheelSpinActive) return;
  for (const id of ["random-wheel-wrap", "spin-wheel-wrap"]) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    buildWheel(id, wrap._wheelPool);
  }
}

const SPIN_RESULT_MAX_WIDTH = 860;
const SPIN_RESULT_PAIRS = [
  { sectionId: "random-spin-section", resultId: "random-spin-result" },
  { sectionId: "spin-section", resultId: "spin-result" },
];

function syncSpinResultClearance() {
  const isDesktop = window.matchMedia("(min-width: 900px)").matches;
  for (const { sectionId, resultId } of SPIN_RESULT_PAIRS) {
    const section = document.getElementById(sectionId);
    const result = document.getElementById(resultId);
    if (!section || !result) continue;
    result.style.paddingTop = "";
    result.style.width = "";
    result.style.maxWidth = "";
    result.style.marginLeft = "";
    result.style.marginRight = "";

    const dock = section.querySelector(".spin-controls-dock");
    if (!dock || !section.classList.contains("active")) continue;
    const dockPos = getComputedStyle(dock).position;
    if (dockPos !== "fixed" && dockPos !== "absolute") continue;
    const dockRect = dock.getBoundingClientRect();

    if (isDesktop) {
      const sectionRect = section.getBoundingClientRect();
      const centerX = (sectionRect.left + sectionRect.right) / 2;
      const gap = 28;
      const safeWidth = Math.floor((dockRect.left - centerX - gap) * 2);
      const width = Math.max(320, Math.min(SPIN_RESULT_MAX_WIDTH, safeWidth));
      result.style.width = width + "px";
      result.style.maxWidth = width + "px";
      result.style.marginLeft = "auto";
      result.style.marginRight = "auto";
      if (safeWidth < 320) {
        const resultRect = result.getBoundingClientRect();
        result.style.paddingTop = Math.max(0, Math.ceil(dockRect.bottom - resultRect.top) + 16) + "px";
      }
    } else {
      const resultRect = result.getBoundingClientRect();
      result.style.paddingTop = Math.max(0, Math.ceil(dockRect.bottom - resultRect.top) + 16) + "px";
    }
  }
}

const debouncedSyncSpinResultClearance = typeof debounce === "function"
  ? debounce(syncSpinResultClearance, 150)
  : syncSpinResultClearance;
window.addEventListener("resize", debouncedSyncSpinResultClearance);
window.addEventListener("orientationchange", debouncedSyncSpinResultClearance);

let dockRevealToken = 0;
let dockRevealed = false;
function scheduleDockReveal() {
  if (dockRevealed) return;
  const myToken = ++dockRevealToken;
  nextSettledFrame().then(() => {
    if (myToken !== dockRevealToken || dockRevealed) return;
    dockRevealed = true;
    document.body.classList.add("dock-ready");
    syncSpinResultClearance();
    rebuildVisibleWheels();
  });
}
window.addEventListener("resize", scheduleDockReveal);
window.addEventListener("orientationchange", scheduleDockReveal);
scheduleDockReveal();

const debouncedRebuildVisibleWheels = typeof debounce === "function"
  ? debounce(rebuildVisibleWheels, 150)
  : rebuildVisibleWheels;
window.addEventListener("resize", debouncedRebuildVisibleWheels);
window.addEventListener("orientationchange", debouncedRebuildVisibleWheels);

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(forceRebuildVisibleWheels).catch(() => {});
}

if (typeof ResizeObserver !== "undefined") {
  const wheelLayoutObserver = new ResizeObserver(() => {
    debouncedRebuildVisibleWheels();
  });
  for (const sectionId of ["random-spin-section", "spin-section"]) {
    const section = document.getElementById(sectionId);
    const dock = section && section.querySelector(".spin-controls-dock");
    if (dock) wheelLayoutObserver.observe(dock);
  }
}
