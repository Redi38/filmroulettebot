// Spin flow orchestration: classic + wheel spins, cooldown, button wiring.

async function doWheelSpin(cat, isRandom) {
  if (spinCooldownUntil > Date.now()) return;
  const prefix = isRandom ? "random" : "spin";
  const result = document.getElementById(isRandom ? "random-spin-result" : "spin-result");
  const wheelWrapId = `${prefix}-wheel-wrap`;
  const prevResultHtml = result.innerHTML;
  const wrap = document.getElementById(wheelWrapId);
  const prevWrapHtml = wrap.innerHTML;
  const prevWrapDisplay = wrap.style.display;

  applySpinCooldown(SPIN_COOLDOWN_SECONDS);
  result.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.display = "flex";
  wrap.innerHTML = '<div class="spinner">🌀 Готовим колесо…</div>';

  try {
    const endpoint = isRandom ? "/api/random-spin" : `/api/${cat}/spin`;
    const data = await api(endpoint, { method: "POST" });
    currentCardData = data;
    const pool = (data.wheel_pool && data.wheel_pool.length >= 2) ? data.wheel_pool : [data.original_title, data.original_title];
    let winnerIndex = pool.indexOf(data.original_title);
    if (winnerIndex === -1) winnerIndex = 0;

    const canvas = buildWheel(wheelWrapId, pool);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await spinWheelTo(canvas, pool.length, winnerIndex, Math.round(spinSpeedSeconds * 1000));

    wrap.classList.add("wheel-done");
    await new Promise((r) => setTimeout(r, 450));
    wrap.style.display = "none";
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    updateWheelScrollLock();
    result.innerHTML = renderCard(data);
  } catch (e) {
    wrap.innerHTML = prevWrapHtml;
    wrap.style.display = prevWrapDisplay;
    updateWheelScrollLock();
    handleSpinError(e, result, prevResultHtml);
  }
}

// Shared by every spin flow (classic + wheel): on a 429 cooldown, restore
// the previous result and re-arm the cooldown timer; otherwise show the error.
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
      btn.disabled = false;
      btn.classList.remove("wipe");
    }
  }, seconds * 1000);
}
function resultEl() {
  return document.getElementById(currentView === "random" ? "random-spin-result" : "spin-result");
}

// Classic (non-wheel) spin, shared by the per-category and random flows.
// isRandom picks the endpoint and, since a random spin only ever happens
// from the random-spin view, the result element directly (rather than via
// resultEl(), which is also used for classic-mode rerolls from either view).
async function doClassicSpin(cat, isRandom) {
  if (spinCooldownUntil > Date.now()) return;
  const result = isRandom ? document.getElementById("random-spin-result") : resultEl();
  const prevHtml = result.innerHTML;
  result.innerHTML = '<div class="spinner">🌀 Крутим…</div>';
  applySpinCooldown(SPIN_COOLDOWN_SECONDS);
  try {
    const endpoint = isRandom ? "/api/random-spin" : `/api/${cat}/spin`;
    const data = await api(endpoint, {method: "POST"});
    currentCardData = data;
    result.innerHTML = renderCard(data);
  } catch (e) {
    handleSpinError(e, result, prevHtml);
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
