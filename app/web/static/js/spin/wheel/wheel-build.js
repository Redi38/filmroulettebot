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
    wrap.classList.remove("wheel-done", "wheel-wrap--settling");
    wrap.style.display = "none";
    wrap.style.minHeight = "";
    wrap.style.paddingTop = "";
    wrap._wheelPool = null;
    wrap._wheelWeights = null;
    wrap._wheelCat = null;
    wrap._settleToken = (wrap._settleToken || 0) + 1; // cancel any settle loop
  }
  updateWheelScrollLock();
}

function updateWheelScrollLock() {
}

// True when the wheel already on screen is the one we were about to build.
// Leaving the roulette tab and coming back re-requests the same pool for the
// same category more often than not, and rebuilding it from scratch is what
// the user sees as a flicker.
//
// The wrap is shared by every category now (WHEEL_WRAP_IDS has a single
// entry), so "the same pool is already showing" is not enough on its own —
// it may have been measured for a layout (viewport size, dock height) that
// no longer holds by the time this category comes back around. Reusing it
// as-is then means showing a wrong-size wheel with no correction in sight,
// since the caller skips the whole settle/rebuild path on a cache hit.
function canReuseIdleWheel(wrap, cat, pool, weights) {
  if (!wrap.querySelector(".wheel-canvas")) return false;
  if (wrap.style.display === "none") return false;
  if (wrap.classList.contains("wheel-wrap--settling")) return false;
  if (wrap._wheelCat !== cat) return false;
  const shown = wrap._wheelPool;
  if (!shown || shown.length !== pool.length) return false;
  if (shown.some((title, i) => title !== pool[i])) return false;
  if (JSON.stringify(wrap._wheelWeights || null) !== JSON.stringify(weights || null)) return false;
  const predicted = predictWheelSize(wrap);
  return Math.abs(predicted - (wrap._wheelBuiltSize || 0)) < WHEEL_SETTLE_TOLERANCE_PX;
}

// body.dock-ready is the app's own "chrome has landed" signal (viewport.js
// sets it once fonts have settled and the dock has been laid out). Measuring
// the wheel before it flips means measuring against a layout that is still
// moving — which is how the first build came out small and then had to be
// redone at full size in front of the user. Capped so a page where the flag
// never arrives still gets a wheel.
const WHEEL_LAYOUT_READY_TIMEOUT_MS = 1500;
const WHEEL_LAYOUT_QUIET_MS = 200;

// Two conditions, because dock-ready alone was not enough: the flag flips as
// soon as fonts settle, but the dock's own ResizeObserver is debounced by
// 150ms behind it, so a measurement taken right after the flag could still be
// invalidated a moment later — and the user watched the wheel grow.
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

async function showIdleWheel(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap) return;
  try {
    const weighted = typeof isWeightedMode === "function" ? isWeightedMode() : false;
    const data = await api(`/api/${cat}/wheel-preview?weighted=${weighted}`);
    const pool = data.wheel_pool;
    if (!pool || pool.length < 2) {
      // Nothing to spin — fall back to the empty state the caller skipped.
      resetWheelWraps();
      if (typeof resetSpinResult === "function") resetSpinResult();
      return;
    }
    if (document.getElementById("spin-wheel-wrap") !== wrap || !wrap.isConnected) return;
    document.getElementById("spin-result").innerHTML = "";
    wrap.classList.remove("wheel-done");
    if (canReuseIdleWheel(wrap, cat, pool, data.wheel_weights)) {
      if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
      return;
    }
    await nextSettledFrame();
    await awaitWheelLayoutReady();
    if (!wrap.isConnected || document.getElementById("spin-wheel-wrap") !== wrap) return;
    // canReuseIdleWheel() already ruled out "this is the same pool at the
    // same size" — but that's not the same as "nothing usable is on screen".
    // buildSettledWheel() itself tells a true cold start (wrap has never
    // held a canvas) from a revisit/category-switch (it holds someone else's
    // canvas) and only skeletons the former; the latter gets the quiet
    // hidden-and-swapped treatment so repeat visits stay instant.
    buildSettledWheel("spin-wheel-wrap", pool, data.wheel_weights);
    wrap._wheelCat = cat;
    if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
  } catch (e) {
    resetWheelWraps();
    if (typeof resetSpinResult === "function") resetSpinResult();
  }
}

function buildWheel(wrapId, items, weights) {
  const wrap = document.getElementById(wrapId);

  // A rebuild (resize, DPR change, re-measure) throws the old canvas away and
  // starts the new one at rotation 0. With the same titles in the same order
  // that reads as the wedges having swapped places — the wheel visibly jumps
  // back to where it started. Carry the angle over when the pool is unchanged
  // so a rebuild is invisible; a genuinely different pool starts fresh.
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
  holder.className = "wheel-holder wheel-holder--enter wheel-holder--" + getWheelStyle();
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

  // The resting wheel drifts and responds to the cursor — see wheel-idle.js.
  if (typeof startWheelIdle === "function") {
    attachWheelHover(canvas, canvasMask);
    startWheelIdle(canvas);
  }

  // While settling, buildSettledWheel() owns the reveal — otherwise the enter
  // animation would play behind `visibility: hidden` and the wheel would
  // simply pop into place at the end.
  if (!wrap.classList.contains("wheel-wrap--settling")) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => holder.classList.remove("wheel-holder--enter"));
    });
  }

  return canvas;
}

const WHEEL_SETTLE_MAX_ATTEMPTS = 3;
const WHEEL_SETTLE_TOLERANCE_PX = 3;

function buildSettledWheel(wrapId, items, weights, attempt = 0, token = null) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return null;
  if (attempt === 0) token = wrap._settleToken = (wrap._settleToken || 0) + 1;
  else if (token !== wrap._settleToken) return null;

  const hadWheel = !!wrap.querySelector(".wheel-canvas");
  wrap.classList.add("wheel-wrap--settling");
  const canvas = buildWheel(wrapId, items, weights);
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
        buildSettledWheel(wrapId, items, weights, attempt + 1, token);
        return;
      }
      revealSettledWheel(wrap);
    });
  });

  return canvas;
}

function mountWheelSettleSkeleton(wrap) {
  if (typeof skeletonWheelHtml !== "function") return;
  const skel = document.createElement("div");
  skel.className = "wheel-settle-skeleton";
  skel.innerHTML = skeletonWheelHtml();
  const group = skel.querySelector(".skel-wheel-wrap");
  if (group) group.style.animation = "none";
  wrap.appendChild(skel);
}

function revealSettledWheel(wrap) {
  wrap.classList.remove("wheel-wrap--settling");
  const skel = wrap.querySelector(".wheel-settle-skeleton");
  if (skel) skel.remove();
  const holder = wrap.querySelector(".wheel-holder");
  if (!holder) return;
  // Play the entry animation now that there is something to see.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => holder.classList.remove("wheel-holder--enter"));
  });
}
