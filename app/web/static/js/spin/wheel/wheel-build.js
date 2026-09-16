import { api } from "../../core/api.js";
import { overlay } from "../../core/menu.js";
import { skeletonWheelHtml } from "../../core/skeleton.js";
import { resetSpinResult } from "../settings/spin-category.js";
import { isWeightedMode } from "../settings/weighted-mode.js";
import { getWheelHubImage } from "./hub-upload.js";
import { WHEEL_MIN_SIZE, WHEEL_VERTICAL_RESERVE, computeDockClearance, computeWheelSize, getWheelBottomGap, nextSettledFrame, predictWheelSize } from "./layout.js";
import { setCanvasRotation } from "./spin.js";
import { syncSpinResultClearance, wheelLayoutQuietFor } from "./viewport.js";
import { WHEEL_HUB_GIF_URL, WHEEL_WRAP_IDS, getWheelDPR, getWheelStyle } from "./wheel-constants.js";
import { drawWheel, getCanvasRotationDeg, updatePointerTitle } from "./wheel-draw.js";
import { attachWheelHover, startWheelIdle } from "./wheel-idle.js";

// Roulette wheel: DOM construction — the wrap/holder/canvas/hub markup
// and the wrap-reset / idle-preview flows around it. Canvas drawing itself
// lives in wheel-draw.js (loaded after this file).

export function getDockFor(wrap) {
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

export function resetWheelWraps() {
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap) continue;
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done", "wheel-wrap--settling");
    wrap.style.display = "none";
    wrap.style.minHeight = "";
    wrap.style.paddingTop = "";
    wrap._wheelPool = null;
    wrap._wheelWeights = null;
    wrap._wheelCat = null;
    wrap._wheelSkeletonShownAt = null;
    wrap._settleToken = (wrap._settleToken || 0) + 1;
  }
  updateWheelScrollLock();
}

export function updateWheelScrollLock() {
}

function isWheelWrapRendered(wrap) {
  return !!wrap && wrap.isConnected && wrap.style.display !== "none"
    && wrap.getClientRects().length > 0;
}

function sameWheelContents(shownPool, shownWeights, pool, weights) {
  if (!shownPool || shownPool.length !== pool.length) return false;
  const weightOf = (arr, w, i) => (w && w.length === arr.length ? w[i] : 1);
  const counts = new Map();
  shownPool.forEach((t, i) => {
    const key = `${t}\u0000${weightOf(shownPool, shownWeights, i)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  for (let i = 0; i < pool.length; i++) {
    const key = `${pool[i]}\u0000${weightOf(pool, weights, i)}`;
    const n = counts.get(key);
    if (!n) return false;
    counts.set(key, n - 1);
  }
  return true;
}

function canReuseIdleWheel(wrap, cat, pool, weights) {
  if (!wrap.querySelector(".wheel-canvas")) return false;
  if (!isWheelWrapRendered(wrap)) return false;
  if (wrap.classList.contains("wheel-wrap--settling")) return false;
  if (wrap._wheelCat !== cat) return false;
  if (!sameWheelContents(wrap._wheelPool, wrap._wheelWeights, pool, weights)) return false;
  const predicted = predictWheelSize(wrap);
  return Math.abs(predicted - (wrap._wheelBuiltSize || 0)) < WHEEL_SETTLE_TOLERANCE_PX;
}

const WHEEL_LAYOUT_READY_TIMEOUT_MS = 1500;
const WHEEL_LAYOUT_QUIET_MS = 200;
const WHEEL_SKELETON_MIN_MS = 450;

function awaitWheelLayoutReady() {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const ready = document.body.classList.contains("dock-ready")
        && wheelLayoutQuietFor() >= WHEEL_LAYOUT_QUIET_MS;
      if (ready || performance.now() - started > WHEEL_LAYOUT_READY_TIMEOUT_MS) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

export function prepIdleWheelSkeleton(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap || wrap.querySelector(".wheel-settle-skeleton")) return;
  const hadWheel = !!wrap.querySelector(".wheel-canvas");
  if (!hadWheel) {
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    wrap.style.display = "flex";
    if (wrap._wheelMetrics) applyWheelWrapMetrics(wrap, wrap._wheelMetrics);
    else applyWheelWrapMetrics(wrap);
    const result = document.getElementById("spin-result");
    if (result) result.innerHTML = "";
  }
  wrap.classList.add("wheel-wrap--settling");
  mountWheelSettleSkeleton(wrap, {animate: !hadWheel});
  wrap._wheelSkeletonShownAt = performance.now();
}

export async function showIdleWheel(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap) return;
  prepIdleWheelSkeleton(cat);
  const skeletonShownAt = wrap._wheelSkeletonShownAt || 0;
  try {
    const weighted = typeof isWeightedMode === "function" ? isWeightedMode() : false;
    const data = await api(`/api/${cat}/wheel-preview?weighted=${weighted}`);
    const pool = data.wheel_pool;
    if (!pool || pool.length < 2) {
      resetWheelWraps();
      if (typeof resetSpinResult === "function") resetSpinResult();
      return;
    }
    if (document.getElementById("spin-wheel-wrap") !== wrap || !wrap.isConnected) return;
    document.getElementById("spin-result").innerHTML = "";
    wrap.classList.remove("wheel-done");
    await nextSettledFrame();
    await awaitWheelLayoutReady();
    if (skeletonShownAt) {
      const remaining = WHEEL_SKELETON_MIN_MS - (performance.now() - skeletonShownAt);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    }
    if (!wrap.isConnected || document.getElementById("spin-wheel-wrap") !== wrap) return;
    wrap.classList.remove("wheel-wrap--settling");
    if (canReuseIdleWheel(wrap, cat, pool, data.wheel_weights)) {
      revealSettledWheel(wrap);
      if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
      return;
    }
    buildSettledWheel("spin-wheel-wrap", pool, data.wheel_weights);
    wrap._wheelCat = cat;
    if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
  } catch (e) {
    resetWheelWraps();
    if (typeof resetSpinResult === "function") resetSpinResult();
  }
}

function applyWheelWrapMetrics(wrap, known) {
  wrap.style.minHeight = "";
  wrap.style.paddingTop = "";
  if (known) {
    wrap.style.paddingTop = known.dockClearance + "px";
    wrap.style.minHeight = (known.cssSize + known.dockClearance + WHEEL_VERTICAL_RESERVE) + "px";
    wrap._wheelMetrics = {cssSize: known.cssSize, dockClearance: known.dockClearance};
    return wrap._wheelMetrics;
  }
  const dock = getDockFor(wrap);
  const dockClearance = computeDockClearance(wrap, dock);
  wrap.style.paddingTop = dockClearance + "px";

  const top = wrap.getBoundingClientRect().top;
  const pageBottomGap = getWheelBottomGap(wrap);
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const availableHeight = viewportHeight - top - pageBottomGap - dockClearance;
  const availableWidth = wrap.clientWidth;
  if (availableWidth < WHEEL_MIN_SIZE) {
    if (wrap._wheelMetrics) {
      wrap.style.paddingTop = wrap._wheelMetrics.dockClearance + "px";
      wrap.style.minHeight = (wrap._wheelMetrics.cssSize + wrap._wheelMetrics.dockClearance + WHEEL_VERTICAL_RESERVE) + "px";
      return wrap._wheelMetrics;
    }
    wrap.style.paddingTop = "";
    wrap.style.minHeight = "";
    return null;
  }
  const cssSize = computeWheelSize(availableWidth, availableHeight);
  const heightBudget = Math.max(0, viewportHeight - top - pageBottomGap);
  wrap.style.minHeight = Math.min(cssSize + dockClearance + WHEEL_VERTICAL_RESERVE, heightBudget) + "px";
  wrap._wheelMetrics = {cssSize, dockClearance};
  return wrap._wheelMetrics;
}

export function buildWheel(wrapId, items, weights, opts) {
  const skipEnter = !!(opts && opts.skipEnter);
  const wrap = document.getElementById(wrapId);

  const prevCanvas = wrap.querySelector(".wheel-canvas");
  const prevPool = wrap._wheelPool;
  const samePool = !!prevCanvas && Array.isArray(prevPool)
    && prevPool.length === items.length && prevPool.every((t, i) => t === items[i]);
  const carriedRotation = samePool
    ? (typeof prevCanvas._rotationDeg === "number"
      ? prevCanvas._rotationDeg
      : getCanvasRotationDeg(prevCanvas))
    : 0;

  wrap.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.display = "flex";
  wrap._wheelPool = items;
  wrap._wheelWeights = weights;

  const metrics = applyWheelWrapMetrics(wrap) || {cssSize: WHEEL_MIN_SIZE};
  const cssSize = metrics.cssSize;
  wrap._wheelBuiltSize = cssSize;

  const titleEl = document.createElement("div");
  titleEl.className = "wheel-current-title";
  wrap.appendChild(titleEl);

  const holder = document.createElement("div");
  holder.className = "wheel-holder" + (skipEnter ? "" : " wheel-holder--enter") + " wheel-holder--" + getWheelStyle();
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
  if (carriedRotation) setCanvasRotation(canvas, carriedRotation);
  updatePointerTitle(canvas, carriedRotation);
  updateWheelScrollLock();

  if (typeof startWheelIdle === "function") {
    attachWheelHover(canvas, canvasMask);
    startWheelIdle(canvas);
  }

  if (!skipEnter && !wrap.classList.contains("wheel-wrap--settling")) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => holder.classList.remove("wheel-holder--enter"));
    });
  }

  return canvas;
}

const WHEEL_SETTLE_MAX_ATTEMPTS = 3;
const WHEEL_SETTLE_TOLERANCE_PX = 3;

export function buildSettledWheel(wrapId, items, weights, attempt = 0, token = null, skipEnter = null) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return null;
  if (attempt === 0) {
    token = wrap._settleToken = (wrap._settleToken || 0) + 1;
    skipEnter = !!wrap.querySelector(".wheel-canvas");
  } else if (token !== wrap._settleToken) return null;

  const hadWheel = attempt === 0 ? skipEnter : true;
  wrap.classList.add("wheel-wrap--settling");
  const canvas = buildWheel(wrapId, items, weights, {skipEnter});
  if (!hadWheel) mountWheelSettleSkeleton(wrap);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (token !== wrap._settleToken) return;
      if (!wrap.isConnected || wrap._wheelPool !== items) {
        revealSettledWheel(wrap);
        return;
      }
      const predicted = predictWheelSize(wrap);
      const drift = Math.abs(predicted - (wrap._wheelBuiltSize || 0));
      if (drift >= WHEEL_SETTLE_TOLERANCE_PX && attempt < WHEEL_SETTLE_MAX_ATTEMPTS) {
        buildSettledWheel(wrapId, items, weights, attempt + 1, token, skipEnter);
        return;
      }
      revealSettledWheel(wrap);
    });
  });

  return canvas;
}

function mountWheelSettleSkeleton(wrap, opts) {
  if (typeof skeletonWheelHtml !== "function") return;
  const animate = !!(opts && opts.animate);
  const skel = document.createElement("div");
  skel.className = "wheel-settle-skeleton";
  skel.innerHTML = skeletonWheelHtml();
  const group = skel.querySelector(".skel-wheel-wrap");
  if (group && !animate) group.style.animation = "none";
  const metrics = wrap._wheelMetrics;
  if (metrics) {
    skel.style.top = metrics.dockClearance + "px";
    const disc = skel.querySelector(".skel-wheel-disc");
    if (disc) { disc.style.width = metrics.cssSize + "px"; disc.style.height = metrics.cssSize + "px"; }
  }
  wrap.appendChild(skel);
}

function revealSettledWheel(wrap) {
  wrap.classList.remove("wheel-wrap--settling");
  const skel = wrap.querySelector(".wheel-settle-skeleton");
  if (skel) skel.remove();
  wrap._wheelSkeletonShownAt = null;
  const holder = wrap.querySelector(".wheel-holder");
  if (!holder) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => holder.classList.remove("wheel-holder--enter"));
  });
}
