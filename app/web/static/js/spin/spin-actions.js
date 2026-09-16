import { renderCard } from "../card/card-render.js";
import { api } from "../core/api.js";
import { CATS } from "../core/constants.js";
import { skeletonCardHtml, skeletonWheelHtml } from "../core/skeleton.js";
import { isRandomSpin, spinnableCats, uiState } from "../core/state.js";
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

// The pre-spin wheel that "Наугад" shows to reveal *which* category it landed
// on. Built from the categories the picker is currently offering, so a list
// that has been emptied out (no cartoons left to watch, say) is not shown as a
// segment the spin could never land on — the server skips empty categories in
// /api/random-spin for the same reason.
function randomCategoryOrder(category) {
  const cats = spinnableCats();
  if (category && !cats.includes(category)) cats.push(category);
  return cats.length ? cats : Object.keys(CATS);
}

async function spinCategoryWheel(wheel, wheelWrapId, category) {
  const order = randomCategoryOrder(category);
  const labels = order.map((c) => CATS[c] || c);
  let winnerIndex = order.indexOf(category);
  if (winnerIndex === -1) winnerIndex = 0;
  if (labels.length < 2) return; // nothing to reveal — one category is all there is

  const canvas = wheel.buildWheel(wheelWrapId, labels);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const categorySpinMs = Math.max(1200, Math.round(spinSpeedSeconds * 1000 * 0.6));
  await wheel.spinWheelTo(canvas, labels.length, winnerIndex, categorySpinMs);
  await new Promise((r) => setTimeout(r, 550));
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
  wrap.innerHTML = skeletonWheelHtml();

  try {
    const endpoint = isRandom ? "/api/random-spin" : `/api/${cat}/spin`;
    const data = await api(endpoint, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({weighted: isWeightedMode()}),
    });
    uiState.currentCardData = data;

    if (isRandom) {
      await spinCategoryWheel(wheel, wheelWrapId, data.category);
    }

    const pool = (data.wheel_pool && data.wheel_pool.length >= 2) ? data.wheel_pool : [data.original_title, data.original_title];
    const weights = (data.wheel_pool && data.wheel_pool.length >= 2) ? data.wheel_weights : undefined;
    let winnerIndex = pool.indexOf(data.original_title);
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
  if (!reduced && typeof document.startViewTransition === "function") {
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
