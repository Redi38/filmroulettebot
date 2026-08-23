function loadResolvedMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(RESOLVED_HIST_KEY) || "{}");
    if (Array.isArray(raw)) return {};
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}
function saveResolvedMap(map) {
  try { localStorage.setItem(RESOLVED_HIST_KEY, JSON.stringify(map)); } catch {}
}
function histKey(e) { return `${e.category}|${e.title}|${e.timestamp}`; }

let historyItems = [];
let historyFilter = initial.cat && CATS[initial.cat] ? initial.cat : "movies";
let historyTabsRendered = false;

async function loadHistory() {
  const container = document.getElementById("history-container");
  ensureHistoryShell();
  const list = document.getElementById("history-list");
  const isFreshView = list.dataset.loaded !== "1";
  if (isFreshView) {
    list.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api("/api/history?limit=50");
    historyItems = data.items.filter((e) => e.category !== "marvel" && e.category !== "dc");
    list.dataset.loaded = "1";
    await fadeOut(list);
    renderHistoryList();
    fadeIn(list);
  } catch (e) {
    list.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    list.style.opacity = "1";
  }
}

function ensureHistoryShell() {
  const container = document.getElementById("history-container");
  if (historyTabsRendered) return;
  container.innerHTML = "";

  const tabs = document.createElement("div");
  tabs.className = "hist-tabs";
  for (const [code, label] of Object.entries(CATS)) {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary" + (historyFilter === code ? " active" : "");
    btn.textContent = label;
    btn.onclick = async () => {
      if (historyFilter === code) return;
      historyFilter = code;
      [...tabs.children].forEach((c) => c.classList.toggle("active", c === btn));
      resetClearButton();
      const list = document.getElementById("history-list");
      await fadeOut(list);
      renderHistoryList();
      fadeIn(list);
    };
    tabs.appendChild(btn);
  }
  container.appendChild(tabs);

  const clearRow = document.createElement("div");
  clearRow.className = "hist-clear-row";
  const clearBtn = document.createElement("button");
  clearBtn.id = "hist-clear-btn";
  clearBtn.className = "btn btn-danger";
  clearBtn.textContent = "Очистить историю";
  clearBtn.disabled = true;
  clearBtn.onclick = () => handleClearClick(clearBtn);
  clearRow.appendChild(clearBtn);
  container.appendChild(clearRow);

  const list = document.createElement("div");
  list.id = "history-list";
  container.appendChild(list);

  historyTabsRendered = true;
}

let clearConfirmTimer = null;
function resetClearButton() {
  clearTimeout(clearConfirmTimer);
  const btn = document.getElementById("hist-clear-btn");
  if (!btn) return;
  btn.textContent = "Очистить историю";
  btn.classList.remove("confirming");
}

function updateClearButtonState(hasItems) {
  const btn = document.getElementById("hist-clear-btn");
  if (!btn) return;
  btn.disabled = !hasItems;
  if (!hasItems) resetClearButton();
}

function handleClearClick(btn) {
  if (!btn.classList.contains("confirming")) {
    btn.classList.add("confirming");
    btn.textContent = "Точно очистить? Нажмите ещё раз";
    clearConfirmTimer = setTimeout(() => resetClearButton(), 3000);
    return;
  }
  clearTimeout(clearConfirmTimer);
  clearHistoryCategory(historyFilter);
}

async function clearHistoryCategory(cat) {
  const btn = document.getElementById("hist-clear-btn");
  const list = document.getElementById("history-list");
  try {
    await api(`/api/history/${cat}/clear`, {method: "POST"});
    historyItems = historyItems.filter((e) => e.category !== cat);
    resetClearButton();
    await fadeOut(list);
    renderHistoryList();
    fadeIn(list);
    showToast(`История «${CATS[cat]}» очищена`);
  } catch (e) {
    resetClearButton();
    showToast(e.message);
  }
}

function renderHistoryList() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  const filtered = historyItems
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e.category === historyFilter);

  if (!filtered.length) {
    list.innerHTML = placeholderHtml(`В категории «${CATS[historyFilter]}» пока нет истории — она появится после первого ролла 🎲`, "📜");
    updateClearButtonState(false);
    return;
  }
  updateClearButtonState(true);

  const resolved = loadResolvedMap();
  filtered.forEach(({ e, idx }) => {
    const div = document.createElement("div");
    const key = histKey(e);
    const serverOutcome = e.resolved_type
      ? { type: e.resolved_type, newTitle: e.resolved_new_title }
      : null;
    const outcome = serverOutcome || resolved[key];
    const isResolved = !!outcome;
    div.className = "hist-item" + (isResolved ? " resolved" : "");
    div.dataset.category = e.category;
    div.dataset.title = e.title;
    div.dataset.timestamp = e.timestamp;
    div.dataset.key = key;
    const date = new Date(e.timestamp * 1000).toLocaleString("ru-RU");
    const actionsHtml = isResolved
      ? `<span class="muted">${resolvedOutcomeLabel(e.title, outcome)}</span>`
      : `<button class="btn btn-success" onclick="histConfirm(${idx})">Подтвердить</button>`;
    div.innerHTML = `
      <div class="hist-title">${escapeHtml(e.title)}</div>
      <div class="hist-meta">${date}</div>
      <div class="hist-actions" id="hist-actions-${idx}">
        ${actionsHtml}
        <button class="btn btn-danger hist-clear-entry-btn" onclick="histClearEntry(${idx})" title="Удалить эту запись из истории">Очистить</button>
      </div>`;
    list.appendChild(div);
  });
}

async function histClearEntry(idx) {
  const entry = historyItems[idx];
  if (!entry) return;
  try {
    await api("/api/history/delete", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        category: entry.category, title: entry.title, timestamp: Number(entry.timestamp),
      }),
    });
    historyItems = historyItems.filter((_, i) => i !== idx);
    const list = document.getElementById("history-list");
    await fadeOut(list);
    renderHistoryList();
    fadeIn(list);
    showToast(`Запись «${entry.title}» удалена из истории`);
  } catch (e) { showToast(e.message); }
}
function resolvedOutcomeLabel(title, outcome) {
  if (outcome.type === "sequel" && outcome.newTitle) {
    return `🔄 ${escapeHtml(title)} → ${escapeHtml(outcome.newTitle)}`;
  }
  if (outcome.type === "delete") {
    return `❌ Удалено`;
  }
  return `Обработано ✅`;
}

function histConfirm(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  actionsEl.innerHTML = `
    <button class="btn btn-success" onclick="histSequel(${idx})">Сиквел</button>
    <button class="btn btn-danger" onclick="histDelete(${idx})">Удалить</button>
    <button class="btn btn-danger hist-clear-entry-btn" onclick="histClearEntry(${idx})" title="Удалить эту запись из истории">Очистить</button>`;
}

function markResolved(key, outcome) {
  const map = loadResolvedMap();
  map[key] = outcome || { type: "unknown" };
  saveResolvedMap(map);
}

async function resolveOnServer(category, title, timestamp, resolvedType, newTitle) {
  try {
    await api("/api/history/resolve", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        category, title, timestamp: Number(timestamp),
        resolved_type: resolvedType, new_title: newTitle || null,
      }),
    });
  } catch {
  }
}

async function histSequel(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  const div = actionsEl.closest(".hist-item");
  const {category, title, timestamp, key} = div.dataset;
  try {
    const r = await api(`/api/${category}/sequel`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title}),
    });
    showToast(`${title} → ${r.new_title}`);
    markResolved(key, { type: "sequel", newTitle: r.new_title });
    resolveOnServer(category, title, timestamp, "sequel", r.new_title);
    div.classList.add("resolved");
    actionsEl.innerHTML = `
      <span class="muted">${resolvedOutcomeLabel(title, { type: "sequel", newTitle: r.new_title })}</span>
      <button class="btn btn-danger hist-clear-entry-btn" onclick="histClearEntry(${idx})" title="Удалить эту запись из истории">Очистить</button>`;
  } catch (e) { showToast(e.message); }
}

async function histDelete(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  const div = actionsEl.closest(".hist-item");
  const {category, title, timestamp, key} = div.dataset;
  try {
    await api(`/api/${category}/delete`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title}),
    });
    showToast(`${title} удалён`);
    markResolved(key, { type: "delete" });
    resolveOnServer(category, title, timestamp, "delete", null);
    div.classList.add("resolved");
    actionsEl.innerHTML = `
      <span class="muted">${resolvedOutcomeLabel(title, { type: "delete" })}</span>
      <button class="btn btn-danger hist-clear-entry-btn" onclick="histClearEntry(${idx})" title="Удалить эту запись из истории">Очистить</button>`;
  } catch (e) { showToast(e.message); }
}
