import { renderCard } from "../card/card-render.js";
import { api } from "../core/api.js";
import { skeletonCardHtml } from "../core/skeleton.js";
import { isRandomSpin, uiState } from "../core/state.js";
import { escapeHtml, fadeIn, fadeOut, showToast } from "../core/utils.js";
import { isAutoWatchEnabled } from "./settings/auto-watch-toggle.js";
import { isConfettiEnabled } from "./settings/confetti-toggle.js";
import { SPIN_COOLDOWN_SECONDS, spinCooldown } from "./settings/dock-controls.js";
import { spinMode } from "./settings/spin-mode.js";
import { spinSpeedSeconds } from "./settings/spin-speed.js";
import { isWeightedMode } from "./settings/weighted-mode.js";
import { loadWheel } from "./wheel/loader.js";

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
    if (uiState.currentCardData !== data) return; // safety net
    const win = window.open(data.watch_link, "_blank", "noopener");
    if (textEl) textEl.textContent = "";
    if (!win) showToast("Не удалось открыть вкладку — разрешите всплывающие окна");
  }, 1000);
}

let dockLocked = false;

function setDockLocked(locked) {
  dockLocked = locked;
  const dock = document.querySelector("#spin-section .spin-controls-dock");
  if (dock) {
    dock.querySelectorAll("button, input").forEach((el) => {
      if (el.classList.contains("wheel-mute-btn")) return;
      el.disabled = locked;
    });
  }
  applySpinButtonLockState();
}

function applySpinButtonLockState() {
  const cooldownActive = spinCooldown.until > Date.now();
  const disabled = dockLocked || cooldownActive;
  const btn = document.getElementById("spin-btn");
  if (btn) btn.disabled = disabled;
}

async function doWheelSpin(cat, isRandom) {
  if (spinCooldown.until > Date.now()) return;
  cancelAutoWatchOpen();
  const wheel = await loadWheel();
  wheel.primeWheelAudio();
  const result = resultEl();
  const wheelWrapId = "spin-wheel-wrap";
  const prevResultHtml = result.innerHTML;
  const wrap = document.getElementById(wheelWrapId);
  const prevWrapHtml = wrap.innerHTML;
  const prevWrapDisplay = wrap.style.display;

  applySpinCooldown(SPIN_COOLDOWN_SECONDS);
  setDockLocked(true);
  result.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.display = "flex";
  // Mount the same metrics-aware skeleton prepIdleWheelSkeleton() uses when
  // the tab first opens, instead of the bare skeletonWheelHtml() markup:
  // that one sizes its disc from wrap._wheelMetrics (the JS-computed final
  // wheel size for the current viewport), while the bare markup fell back
  // to a CSS-only min(62vh, 82vw, 520px) guess — so the "Крутить" skeleton
  // came out a visibly different size than the one shown on tab open.
  wheel.prepIdleWheelSkeleton(cat);

  try {
    const endpoint = isRandom ? "/api/random-spin" : `/api/${cat}/spin`;
    const data = await api(endpoint, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({weighted: isWeightedMode()}),
    });
    uiState.currentCardData = data;
    // prepIdleWheelSkeleton() above added wheel-wrap--settling, which hides
    // every child but the skeleton overlay (see
    // .wheel-wrap--settling > *:not(.wheel-settle-skeleton) in
    // spin-wheel.css). buildWheel() below builds the real canvas but never
    // clears that class — nothing else in this flow does either, since
    // doWheelSpin builds the wheel directly instead of going through
    // buildSettledWheel()/revealSettledWheel() — so the new wheel was
    // rendered invisible and the spin played out on a blank wrap.
    wrap.classList.remove("wheel-wrap--settling");

    const hasPool = !!(data.wheel_pool && data.wheel_pool.length >= 2);
    const pool = hasPool ? data.wheel_pool : [data.original_title, data.original_title];
    const weights = hasPool ? data.wheel_weights : undefined;
    // The movies and random wheels send the winner's segment explicitly: a
    // Marvel/DC lot is drawn as "Marvel"/"DC" while the card is for the first
    // title of that list, so the card's title can't be looked up on the wheel.
    let winnerIndex = (hasPool && Number.isInteger(data.wheel_winner_index))
      ? data.wheel_winner_index
      : pool.indexOf(data.original_title);
    if (winnerIndex === -1) winnerIndex = 0;

    const canvas = wheel.buildWheel(wheelWrapId, pool, weights);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await wheel.spinWheelTo(canvas, pool.length, winnerIndex, Math.round(spinSpeedSeconds * 1000));
    if (typeof isConfettiEnabled !== "function" || isConfettiEnabled()) {
      wheel.fireWheelConfetti(wheelWrapId);
    }

    // Landing: pop the wheel, dim losers / glow the winner, hold, then
    // morph the wheel into the result card (View Transitions when available).
    wrap.classList.add("wheel-done");
    await wheel.highlightWheelWinner(canvas, winnerIndex);
    await swapWheelForCard(wheel, wrap, result, data);
    scheduleAutoWatchOpen(data, result);
  } catch (e) {
    wrap.classList.remove("wheel-wrap--settling");
    wrap.innerHTML = prevWrapHtml;
    wrap.style.display = prevWrapDisplay;
    wheel.updateWheelScrollLock();
    handleSpinError(e, result, prevResultHtml);
  } finally {
    setDockLocked(false);
  }
}

// Replaces the wheel with the rendered card. With the View Transitions API
// the wheel holder and the card poster share `view-transition-name: spin-hero`
// (see spin-wheel.css / buttons-cards.css), so the browser animates one into
// the other. Falls back to the old fade when the API is missing.
async function swapWheelForCard(wheel, wrap, result, data) {
  const applyDom = () => {
    wrap.style.display = "none";
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    wheel.updateWheelScrollLock();
    result.innerHTML = renderCard(data);
    result.style.opacity = "1";
  };
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // View Transitions are compositor-driven the same way rAF is, and some
  // browsers hold them until the tab is visible again — exactly the kind of
  // block this function exists to avoid when the spin finished in the
  // background. The plain fadeOut/fadeIn fallback below already tolerates a
  // hidden tab (see nextFrame() in utils.js), so just skip straight to it.
  if (!reduced && !document.hidden && typeof document.startViewTransition === "function") {
    document.documentElement.classList.add("vt-spin-landing");
    try {
      const vt = document.startViewTransition(applyDom);
      vt.ready.catch(() => {}); // see runViewTransition in core/utils.js
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
  wheel.updateWheelScrollLock();
  await fadeOut(result);
  result.innerHTML = renderCard(data);
  fadeIn(result);
}

export function handleSpinError(e, result, prevHtml) {
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
  if (until <= spinCooldown.until) return;
  spinCooldown.until = until;
  startSpinCooldownAnim(seconds);
}

function startSpinCooldownAnim(seconds) {
  const spinBtn = document.getElementById("spin-btn");
  clearTimeout(spinCooldown.timer);
  if (!spinBtn) return;
  spinBtn.disabled = true;
  spinBtn.classList.remove("wipe");
  spinBtn.style.setProperty("--cooldown-duration", seconds + "s");
  void spinBtn.offsetWidth;
  spinBtn.classList.add("cooldown-anim", "wipe");
  spinCooldown.timer = setTimeout(() => {
    spinBtn.classList.remove("wipe");
    applySpinButtonLockState();
  }, seconds * 1000);
}
export function resultEl() {
  return document.getElementById("spin-result");
}

async function doClassicSpin(cat, isRandom) {
  if (spinCooldown.until > Date.now()) return;
  cancelAutoWatchOpen();
  const result = resultEl();
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
    uiState.currentCardData = data;
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

// One entry point for the one roulette: the picked category decides whether
// this is a random spin or a per-category one.
export function doSpin() {
  const isRandom = isRandomSpin();
  const cat = isRandom ? null : uiState.spinCat;
  return spinMode === "wheel" ? doWheelSpin(cat, isRandom) : doClassicSpin(cat, isRandom);
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#spin-btn")) doSpin();
});
