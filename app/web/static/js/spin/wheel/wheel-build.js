// Roulette wheel: DOM construction — the wrap/holder/canvas/hub markup
// and the wrap-reset / idle-preview flows around it. Canvas drawing itself
// lives in wheel-draw.js (loaded after this file).

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
