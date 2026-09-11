// Spin flow orchestration: classic + wheel spins, cooldown, button wiring.

const AUTO_WATCH_OPEN_DELAY_SEC = 3;
let autoWatchOpenInterval = null;
let autoWatchOpenToken = 0;

function cancelAutoWatchOpen() {
  clearInterval(autoWatchOpenInterval);
  autoWatchOpenInterval = null;
  autoWatchOpenToken++;
}

function scheduleAutoWatchOpen(data, result) {
  if (!data || !data.watch_link || !result) return;
  if (typeof isAutoWatchEnabled === "function" && !isAutoWatchEnabled()) return;
  const hint = result.querySelector(".auto-watch-hint");
  const textEl = hint && hint.querySelector(".auto-watch-hint-text");

  const token = ++autoWatchOpenToken;
  let secondsLeft = AUTO_WATCH_OPEN_DELAY_SEC;
  const renderCountdown = () => {
    if (textEl) textEl.textContent = `Автооткрытие сайта через ${secondsLeft} с`;
  };
  renderCountdown();

  clearInterval(autoWatchOpenInterval);
  autoWatchOpenInterval = setInterval(() => {
    if (token !== autoWatchOpenToken) { clearInterval(autoWatchOpenInterval); return; }
    secondsLeft--;
    if (secondsLeft > 0) { renderCountdown(); return; }

    clearInterval(autoWatchOpenInterval);
    if (currentCardData !== data) return; // safety net
    const win = window.open(data.watch_link, "_blank", "noopener");
    if (textEl) textEl.textContent = "";
    if (!win) showToast("Не удалось открыть вкладку — разрешите всплывающие окна");
  }, 1000);
}

let dockLocked = false;

function setDockLocked(locked) {
  dockLocked = locked;
  for (const dockId of ["random-spin-section", "spin-section"]) {
    const dock = document.querySelector(`#${dockId} .spin-controls-dock`);
    if (!dock) continue;
    dock.querySelectorAll("button, input").forEach((el) => {
      if (el.classList.contains("wheel-mute-btn")) return;
      el.disabled = locked;
    });
  }
  applySpinButtonLockState();
}

function applySpinButtonLockState() {
  const cooldownActive = spinCooldownUntil > Date.now();
  const disabled = dockLocked || cooldownActive;
  for (const btn of [document.getElementById("random-spin-btn"), document.getElementById("spin-btn")]) {
    if (btn) btn.disabled = disabled;
  }
}

const RANDOM_CATEGORY_ORDER = ["movies", "cartoons", "series"];

async function spinCategoryWheel(wheelWrapId, category) {
  const labels = RANDOM_CATEGORY_ORDER.map((c) => (typeof CATS !== "undefined" && CATS[c]) || c);
  let winnerIndex = RANDOM_CATEGORY_ORDER.indexOf(category);
  if (winnerIndex === -1) winnerIndex = 0;

  const canvas = buildWheel(wheelWrapId, labels);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const categorySpinMs = Math.max(1200, Math.round(spinSpeedSeconds * 1000 * 0.6));
  await spinWheelTo(canvas, labels.length, winnerIndex, categorySpinMs);
  await new Promise((r) => setTimeout(r, 550));
}

async function doWheelSpin(cat, isRandom) {
  if (spinCooldownUntil > Date.now()) return;
  cancelAutoWatchOpen();
  primeWheelAudio();
  const prefix = isRandom ? "random" : "spin";
  const result = isRandom ? document.getElementById("random-spin-result") : resultEl();
  const wheelWrapId = `${prefix}-wheel-wrap`;
  const prevResultHtml = result.innerHTML;
  const wrap = document.getElementById(wheelWrapId);
  const prevWrapHtml = wrap.innerHTML;
  const prevWrapDisplay = wrap.style.display;

  applySpinCooldown(SPIN_COOLDOWN_SECONDS);
  setDockLocked(true);
  result.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.display = "flex";
  wrap.innerHTML = skeletonWheelHtml();

  try {
    const endpoint = isRandom ? "/api/random-spin" : `/api/${cat}/spin`;
    const data = await api(endpoint, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({weighted: isWeightedMode()}),
    });
    currentCardData = data;

    if (isRandom) {
      await spinCategoryWheel(wheelWrapId, data.category);
    }

    const pool = (data.wheel_pool && data.wheel_pool.length >= 2) ? data.wheel_pool : [data.original_title, data.original_title];
    const weights = (data.wheel_pool && data.wheel_pool.length >= 2) ? data.wheel_weights : undefined;
    let winnerIndex = pool.indexOf(data.original_title);
    if (winnerIndex === -1) winnerIndex = 0;

    const canvas = buildWheel(wheelWrapId, pool, weights);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await spinWheelTo(canvas, pool.length, winnerIndex, Math.round(spinSpeedSeconds * 1000));
    if (typeof fireWheelConfetti === "function" && (typeof isConfettiEnabled !== "function" || isConfettiEnabled())) {
      fireWheelConfetti(wheelWrapId);
    }

    // Landing: pop the wheel, dim losers / glow the winner, hold, then
    // morph the wheel into the result card (View Transitions when available).
    wrap.classList.add("wheel-done");
    await highlightWheelWinner(canvas, winnerIndex);
    await swapWheelForCard(wrap, result, data);
    scheduleAutoWatchOpen(data, result);
  } catch (e) {
    wrap.innerHTML = prevWrapHtml;
    wrap.style.display = prevWrapDisplay;
    updateWheelScrollLock();
    handleSpinError(e, result, prevResultHtml);
  } finally {
    setDockLocked(false);
  }
}

// Replaces the wheel with the rendered card. With the View Transitions API
// the wheel holder and the card poster share `view-transition-name: spin-hero`
// (see spin-wheel.css / buttons-cards.css), so the browser animates one into
// the other. Falls back to the old fade when the API is missing.
async function swapWheelForCard(wrap, result, data) {
  const applyDom = () => {
    wrap.style.display = "none";
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    updateWheelScrollLock();
    result.innerHTML = renderCard(data);
    result.style.opacity = "1";
  };
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && typeof document.startViewTransition === "function") {
    document.documentElement.classList.add("vt-spin-landing");
    try {
      const vt = document.startViewTransition(applyDom);
      await vt.finished;
    } catch (e) {
      // startViewTransition rejects if a transition was interrupted; the DOM
      // update itself still ran.
    } finally {
      document.documentElement.classList.remove("vt-spin-landing");
    }
    return;
  }
  wrap.style.display = "none";
  wrap.innerHTML = "";
  wrap.classList.remove("wheel-done");
  updateWheelScrollLock();
  await fadeOut(result);
  result.innerHTML = renderCard(data);
  fadeIn(result);
}

function handleSpinError(e, result, prevHtml) {
  if (e.status === 429) {
    result.innerHTML = prevHtml;
    const m = e.message.match(/[\d.]+/);
    applySpinCooldown(m ? parseFloat(m[0]) : SPIN_COOLDOWN_SECONDS);
    showToast(e.message);
  } else {
    result.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
  }
}

function applySpinCooldown(seconds) {
  const until = Date.now() + seconds * 1000;
  if (until <= spinCooldownUntil) return;
  spinCooldownUntil = until;
  startSpinCooldownAnim(seconds);
}

function startSpinCooldownAnim(seconds) {
  const randomBtn = document.getElementById("random-spin-btn");
  const spinBtn = document.getElementById("spin-btn");
  clearTimeout(spinCooldownTimer);
  for (const btn of [randomBtn, spinBtn]) {
    btn.disabled = true;
    btn.classList.remove("wipe");
    btn.style.setProperty("--cooldown-duration", seconds + "s");
    void btn.offsetWidth;
    btn.classList.add("cooldown-anim", "wipe");
  }
  spinCooldownTimer = setTimeout(() => {
    for (const btn of [randomBtn, spinBtn]) {
      btn.classList.remove("wipe");
    }
    applySpinButtonLockState();
  }, seconds * 1000);
}
function resultEl() {
  return document.getElementById(currentView === "random" ? "random-spin-result" : "spin-result");
}

async function doClassicSpin(cat, isRandom) {
  if (spinCooldownUntil > Date.now()) return;
  cancelAutoWatchOpen();
  const result = isRandom ? document.getElementById("random-spin-result") : resultEl();
  const prevHtml = result.innerHTML;
  result.innerHTML = skeletonCardHtml();
  applySpinCooldown(SPIN_COOLDOWN_SECONDS);
  setDockLocked(true);
  try {
    const endpoint = isRandom ? "/api/random-spin" : `/api/${cat}/spin`;
    const data = await api(endpoint, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({weighted: isWeightedMode()}),
    });
    currentCardData = data;
    await fadeOut(result);
    result.innerHTML = renderCard(data);
    fadeIn(result);
    scheduleAutoWatchOpen(data, result);
  } catch (e) {
    handleSpinError(e, result, prevHtml);
  } finally {
    setDockLocked(false);
  }
}

function doSpin(cat) {
  return spinMode === "wheel" ? doWheelSpin(cat, false) : doClassicSpin(cat, false);
}

function doRandomSpin() {
  return spinMode === "wheel" ? doWheelSpin(null, true) : doClassicSpin(null, true);
}

document.getElementById("spin-btn").onclick = () => doSpin(currentCat);
document.getElementById("random-spin-btn").onclick = doRandomSpin;
