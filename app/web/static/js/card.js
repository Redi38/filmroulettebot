const SPIN_COOLDOWN_SECONDS = 1.5;
let spinCooldownUntil = 0;
let spinCooldownTimer = null;

const SPIN_MODE_KEY = "filmroulette_spin_mode";
function loadSpinMode() {
  try {
    const v = localStorage.getItem(SPIN_MODE_KEY);
    return v === "wheel" ? "wheel" : "classic";
  } catch { return "classic"; }
}
function saveSpinMode(mode) {
  try { localStorage.setItem(SPIN_MODE_KEY, mode); } catch {}
}
let spinMode = loadSpinMode();

const SPIN_SPEED_KEY = "filmroulette_spin_speed";
const SPIN_SPEED_MIN = 1;
const SPIN_SPEED_MAX = 60;
const SPIN_SPEED_DEFAULT = 5;
const SPIN_SPEED_STEP = 0.1;

function loadSpinSpeed() {
  try {
    const v = parseFloat(localStorage.getItem(SPIN_SPEED_KEY));
    if (!isNaN(v) && v >= SPIN_SPEED_MIN && v <= SPIN_SPEED_MAX) return v;
  } catch {}
  return SPIN_SPEED_DEFAULT;
}
function saveSpinSpeed(seconds) {
  try { localStorage.setItem(SPIN_SPEED_KEY, String(seconds)); } catch {}
}
let spinSpeedSeconds = loadSpinSpeed();

function clampSpinSpeed(v) {
  if (isNaN(v)) return spinSpeedSeconds;
  return Math.min(SPIN_SPEED_MAX, Math.max(SPIN_SPEED_MIN, v));
}

function renderSpinSpeedControl(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "spin-speed-wrap" + (spinMode === "wheel" ? " visible" : "");

  const control = document.createElement("div");
  control.className = "spin-speed-control";

  const label = document.createElement("label");
  label.textContent = "⏱ Скорость колеса";

  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "decimal";
  input.min = String(SPIN_SPEED_MIN);
  input.max = String(SPIN_SPEED_MAX);
  input.step = String(SPIN_SPEED_STEP);
  input.value = spinSpeedSeconds.toFixed(1);

  const unit = document.createElement("span");
  unit.className = "spin-speed-unit";
  unit.textContent = "сек";

  const commit = () => {
    const v = clampSpinSpeed(parseFloat(input.value.replace(",", ".")));
    spinSpeedSeconds = v;
    input.value = v.toFixed(1);
    saveSpinSpeed(v);
  };
  input.onchange = commit;
  input.onblur = commit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") { commit(); input.blur(); }
  };

  control.appendChild(label);
  control.appendChild(input);
  control.appendChild(unit);
  el.appendChild(control);
}

function renderSpinModeToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  const outer = document.createElement("div");
  outer.className = "spin-mode-toggle-wrap";
  const row = document.createElement("div");
  row.className = "spin-mode-toggle";
  for (const [value, label] of [["classic", "🎲 Классика"], ["wheel", "🎡 Колесо"]]) {
    const btn = document.createElement("button");
    btn.className = "showcase-filter-btn" + (spinMode === value ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => {
      if (spinMode === value) return;
      spinMode = value;
      saveSpinMode(value);
      renderSpinModeToggle("random-mode-toggle");
      renderSpinModeToggle("spin-mode-toggle");
      renderSpinSpeedControl("random-spin-speed");
      renderSpinSpeedControl("spin-spin-speed");
      resetWheelWraps();
    };
    row.appendChild(btn);
  }
  outer.appendChild(row);
  el.appendChild(outer);
}

function resetWheelWraps() {
  for (const id of ["random-wheel-wrap", "spin-wheel-wrap"]) {
    const wrap = document.getElementById(id);
    if (!wrap) continue;
    wrap.innerHTML = "";
    wrap.classList.remove("wheel-done");
    wrap.style.display = "none";
    wrap.style.minHeight = "";
  }
}

const WHEEL_COLORS = [
  "#8b7cf6", "#5b8def", "#34d399", "#f2596b",
  "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a",
  "#a78bfa", "#4fb8f7", "#67e08a", "#f4738c",
  "#ffd166", "#d67cf0", "#45d4c9", "#ff9f68"
];
const WHEEL_MIN_SIZE = 260;
const WHEEL_MAX_SIZE = 820;

function buildWheel(wrapId, items) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = "";
  wrap.classList.remove("wheel-done");
  wrap.style.minHeight = "";
  wrap.style.display = "flex";

  const top = wrap.getBoundingClientRect().top;
  const pageBottomGap = 24;
  const availableHeight = window.innerHeight - top - pageBottomGap;
  const availableWidth = wrap.clientWidth;
  const cssSize = Math.min(
    Math.max(Math.min(availableWidth, availableHeight) - 16, WHEEL_MIN_SIZE),
    WHEEL_MAX_SIZE
  );
  wrap.style.minHeight = cssSize + "px";

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
  wrap.appendChild(holder);

  drawWheel(canvas, items, dpr);
  canvas._wheelItems = items;
  canvas._wheelTitleEl = titleEl;
  updatePointerTitle(canvas, 0);
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
      resolve();
    }, durationMs);
  });
}

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
    result.innerHTML = renderCard(data);
  } catch (e) {
    wrap.innerHTML = prevWrapHtml;
    wrap.style.display = prevWrapDisplay;
    if (e.status === 429) {
      result.innerHTML = prevResultHtml;
      const m = e.message.match(/[\d.]+/);
      applySpinCooldown(m ? parseFloat(m[0]) : SPIN_COOLDOWN_SECONDS);
      showToast(e.message);
    } else {
      result.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    }
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
  if (spinMode === "wheel") return doWheelSpin(cat, false);
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
  if (spinMode === "wheel") return doWheelSpin(null, true);
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
