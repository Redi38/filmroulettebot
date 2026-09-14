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
    wrap._wheelSkeletonShownAt = null;
    wrap._settleToken = (wrap._settleToken || 0) + 1;
  }
  updateWheelScrollLock();
}

function updateWheelScrollLock() {
}

// A wrap that is on screen for real: connected, not display:none itself, and
// not inside a hidden section. Measuring a wrap inside a display:none section
// reads clientWidth 0 and "predicts" the 260px minimum, which is how the wheel
// got rebuilt tiny while the user was on another tab.
function isWheelWrapRendered(wrap) {
  return !!wrap && wrap.isConnected && wrap.style.display !== "none"
    && wrap.getClientRects().length > 0;
}

// The preview endpoint shuffles the pool on every call, so the same set of
// titles comes back in a different order each time. Compare as a multiset,
// with weights keyed by title, so an unchanged roulette keeps the wheel it
// already shows instead of reshuffling the segments in place.
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
// The idle skeleton stays up at least this long. The preview request often
// lands in a couple of frames and the layout is already quiet on re-entry,
// so without a floor the skeleton flashed for ~30ms and the only thing the
// eye caught was the wheel's enter animation, which read as a small wheel
// growing rather than a placeholder being replaced.
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

// Synchronous "hide the stale wheel" step. Adds .wheel-wrap--settling (which
// hides every child except the skeleton via CSS) and mounts the skeleton.
// Idempotent — a no-op once the skeleton is already up.
//
// MUST run before the spin section is actually revealed to the user —
// including from *inside* the callback passed to a View Transition, before
// it snapshots the "after" state. If it only runs from showIdleWheel(),
// which is awaited after the transition finishes, the transition crossfades
// in the stale, wrong-sized wheel for the length of the animation, and only
// once that's done does the skeleton swap in — a small wheel, then a jump
// cut to skeleton, then the real wheel.
function prepIdleWheelSkeleton(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap || wrap.querySelector(".wheel-settle-skeleton")) return;
  const hadWheel = !!wrap.querySelector(".wheel-canvas");
  if (!hadWheel) {
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    wrap.style.display = "flex";
    // Same padding / min-height / size the real wheel will get, so the
    // skeleton is placed once and the wheel simply replaces it. Measuring
    // in the very tick the section became visible is unreliable (the
    // dock, the section transition and fonts are all still moving), so on
    // re-entry the metrics of the wheel that was on screen last time are
    // reused — same viewport, same size — and only a true cold start
    // measures fresh.
    if (wrap._wheelMetrics) applyWheelWrapMetrics(wrap, wrap._wheelMetrics);
    else applyWheelWrapMetrics(wrap);
    const result = document.getElementById("spin-result");
    if (result) result.innerHTML = "";
  }
  // Hides whatever is still in the wrap (nothing, or the stale wheel)
  // via the existing `.wheel-wrap--settling > *:not(.wheel-settle-skeleton)`
  // rule — the wheel itself isn't touched here, just covered.
  wrap.classList.add("wheel-wrap--settling");
  mountWheelSettleSkeleton(wrap, {animate: !hadWheel});
  wrap._wheelSkeletonShownAt = performance.now();
}

async function showIdleWheel(cat) {
  const wrap = document.getElementById("spin-wheel-wrap");
  if (!wrap) return;
  // No-op if the caller (showSection()'s applyDom) already prepped this
  // synchronously before the section became visible; otherwise does it now.
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
    // Drop the settling flag before checking reuse: canReuseIdleWheel()
    // treats "currently settling" as "don't reuse", which is right while a
    // rebuild is genuinely in flight but would always be true here since we
    // just set it above ourselves.
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

// Measures the space the wheel gets and sets the wrap's padding (clearance
// under an overlapping dock) and min-height for it. Shared by buildWheel()
// and the early skeleton in showIdleWheel(), so both lay out identically.
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
  const cssSize = computeWheelSize(availableWidth, availableHeight);
  const heightBudget = Math.max(0, viewportHeight - top - pageBottomGap);
  wrap.style.minHeight = Math.min(cssSize + dockClearance + WHEEL_VERTICAL_RESERVE, heightBudget) + "px";
  wrap._wheelMetrics = {cssSize, dockClearance};
  return wrap._wheelMetrics;
}

function buildWheel(wrapId, items, weights, opts) {
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

  const {cssSize} = applyWheelWrapMetrics(wrap);
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

function buildSettledWheel(wrapId, items, weights, attempt = 0, token = null, skipEnter = null) {
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
  // Only the very first skeleton fades in; re-mounts during settle attempts
  // must not replay the animation or the placeholder visibly blinks.
  if (group && !animate) group.style.animation = "none";
  // Sit exactly where the wheel will: below the dock clearance, with the
  // disc at the wheel's own size, instead of centred in whatever height the
  // wrap happens to have at the moment.
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
