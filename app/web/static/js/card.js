const SPIN_COOLDOWN_SECONDS = 1.5;
let spinCooldownUntil = 0;
let spinCooldownTimer = null;

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
    void btn.offsetWidth; // restart the animation if already mid-cooldown
    btn.classList.add("cooldown-anim", "wipe");
  }
  spinCooldownTimer = setTimeout(() => {
    for (const btn of [randomBtn, spinBtn]) {
      btn.disabled = false;
      btn.classList.remove("wipe");
    }
  }, seconds * 1000);
}

function renderCard(data, opts) {
  opts = opts || {};
  const showActions = opts.actions !== false;
  const poster = data.poster_url ? `<img class="poster fade-in" src="${data.poster_url}">` : "";
  const rating = data.rating !== "—" ? `⭐️ ${data.rating}/10` : "⭐️ —";
  let extra = "";
  if (data.runtime) extra += `<div class="meta">⏳ ${data.runtime} мин.</div>`;
  if (data.seasons) extra += `<div class="meta">📚 Сезонов: ${data.seasons} · 🎥 Эпизодов: ${data.episodes ?? "—"}</div>`;
  const link = data.watch_link ? `<a class="watch-link" href="${data.watch_link}" target="_blank">Смотреть онлайн</a>` : "";
  const catLabel = ALL_CATS[data.category] || data.category;
  const actionsHtml = showActions ? `
      <div class="card-actions">
        <button class="btn btn-success btn" onclick="confirmPick()">Подтвердить</button>
        <button class="btn btn-primary btn" onclick="rerollPick('${data.category}')">Перекрутить</button>
      </div>
      <div class="sequel-prompt" id="sequel-prompt" style="display:none"></div>` : "";
  // Title first, then the category it came from underneath it.
  return `
    <div class="card fade-in">
      ${poster}
      <div class="title copy-title" onclick="copyToClipboard('${escapeAttr(data.title)}', this)" title="Нажмите, чтобы скопировать">${escapeHtml(data.title)}</div>
      <span class="cat-badge">${catLabel}</span>
      <div class="meta">${rating}</div>
      <div class="meta">🗓 ${escapeHtml(String(data.release_date))}</div>
      ${extra}
      <div class="meta">🎭 ${escapeHtml(data.genres)}</div>
      <div class="meta">👥 ${escapeHtml(data.actors)}</div>
      <div class="overview">${escapeHtml(data.overview)}</div>
      ${link}
      ${actionsHtml}
    </div>`;
}

function resultEl() {
  return document.getElementById(currentView === "random" ? "random-spin-result" : "spin-result");
}

async function doSpin(cat) {
  if (spinCooldownUntil > Date.now()) return;
  const result = resultEl();
  const prevHtml = result.innerHTML;
  result.innerHTML = '<div class="spinner">🌀 Крутим…</div>';
  applySpinCooldown(SPIN_COOLDOWN_SECONDS);
  try {
    const data = await api(`/api/${cat}/spin`, {method: "POST"});
    currentCardData = data;
    result.innerHTML = renderCard(data);
  } catch (e) {
    if (e.status === 429) {
      result.innerHTML = prevHtml;
      const m = e.message.match(/[\d.]+/);
      applySpinCooldown(m ? parseFloat(m[0]) : SPIN_COOLDOWN_SECONDS);
      showToast(e.message);
    } else {
      result.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    }
  }
}

async function doRandomSpin() {
  if (spinCooldownUntil > Date.now()) return;
  const result = document.getElementById("random-spin-result");
  const prevHtml = result.innerHTML;
  result.innerHTML = '<div class="spinner">🌀 Крутим…</div>';
  applySpinCooldown(SPIN_COOLDOWN_SECONDS);
  try {
    const data = await api("/api/random-spin", {method: "POST"});
    currentCardData = data;
    result.innerHTML = renderCard(data);
  } catch (e) {
    if (e.status === 429) {
      result.innerHTML = prevHtml;
      const m = e.message.match(/[\d.]+/);
      applySpinCooldown(m ? parseFloat(m[0]) : SPIN_COOLDOWN_SECONDS);
      showToast(e.message);
    } else {
      result.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    }
  }
}

document.getElementById("spin-btn").onclick = () => doSpin(currentCat);
document.getElementById("random-spin-btn").onclick = doRandomSpin;

function confirmPick() {
  const prompt = document.getElementById("sequel-prompt");
  prompt.style.display = "block";
  prompt.innerHTML = `
    <p>Добавить продолжение (сиквел)?</p>
    <div class="card-actions">
      <button class="btn btn-success btn" onclick="sequelYes()">Да, сиквел</button>
      <button class="btn btn-danger btn" onclick="sequelNo()">Нет, удалить</button>
    </div>`;
}

function markCurrentPickResolved(outcome) {
  if (!currentCardData || currentCardData.history_timestamp == null) return;
  const key = `${currentCardData.category}|${currentCardData.original_title}|${currentCardData.history_timestamp}`;
  markResolved(key, outcome);
}

async function sequelYes() {
  if (!currentCardData) return;
  try {
    const r = await api(`/api/${currentCardData.category}/sequel`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title: currentCardData.original_title}),
    });
    markCurrentPickResolved({ type: "sequel", newTitle: r.new_title });
    resultEl().innerHTML =
      `<div class="card"><div class="title">🔄 ${escapeHtml(currentCardData.original_title)} → ${escapeHtml(r.new_title)}</div></div>`;
    currentCardData = null;
  } catch (e) { showToast(e.message); }
}

async function sequelNo() {
  if (!currentCardData) return;
  try {
    await api(`/api/${currentCardData.category}/delete`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title: currentCardData.original_title}),
    });
    markCurrentPickResolved({ type: "delete" });
    resultEl().innerHTML =
      `<div class="card"><div class="title">❌ ${escapeHtml(currentCardData.original_title)} удалён</div></div>`;
    currentCardData = null;
  } catch (e) { showToast(e.message); }
}

function rerollPick(cat) { doSpin(cat); }
