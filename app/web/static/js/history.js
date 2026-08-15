function loadResolvedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(RESOLVED_HIST_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveResolvedSet(set) {
  try { localStorage.setItem(RESOLVED_HIST_KEY, JSON.stringify([...set])); } catch {}
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
    btn.className = "btn btn-primary btn-sm" + (historyFilter === code ? " active" : "");
    btn.textContent = label;
    btn.onclick = async () => {
      if (historyFilter === code) return;
      historyFilter = code;
      [...tabs.children].forEach((c) => c.classList.toggle("active", c === btn));
      const list = document.getElementById("history-list");
      await fadeOut(list);
      renderHistoryList();
      fadeIn(list);
    };
    tabs.appendChild(btn);
  }
  container.appendChild(tabs);

  const list = document.createElement("div");
  list.id = "history-list";
  container.appendChild(list);

  historyTabsRendered = true;
}

function renderHistoryList() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  const filtered = historyItems
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e.category === historyFilter);

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "История пуста";
    list.appendChild(empty);
    return;
  }

  const resolved = loadResolvedSet();
  filtered.forEach(({ e, idx }) => {
    const div = document.createElement("div");
    const key = histKey(e);
    const isResolved = resolved.has(key);
    div.className = "hist-item" + (isResolved ? " resolved" : "");
    div.dataset.category = e.category;
    div.dataset.title = e.title;
    div.dataset.key = key;
    const date = new Date(e.timestamp * 1000).toLocaleString("ru-RU");
    const actionsHtml = isResolved
      ? `<span class="muted">Обработано ✅</span>`
      : `<button class="btn btn-success btn-sm" onclick="histConfirm(${idx})">Подтвердить</button>`;
    div.innerHTML = `
      <div class="hist-title">${escapeHtml(e.title)}</div>
      <div class="hist-meta">${date}</div>
      <div class="hist-actions" id="hist-actions-${idx}">${actionsHtml}</div>`;
    list.appendChild(div);
  });
}

function histConfirm(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  const div = actionsEl.closest(".hist-item");
  markResolved(div.dataset.key);
  actionsEl.innerHTML = `
    <button class="btn btn-success btn-sm" onclick="histSequel(${idx})">Сиквел</button>
    <button class="btn btn-danger btn-sm" onclick="histDelete(${idx})">Удалить</button>`;
}

function markResolved(key) {
  const set = loadResolvedSet();
  set.add(key);
  saveResolvedSet(set);
}

async function histSequel(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  const div = actionsEl.closest(".hist-item");
  const {category, title, key} = div.dataset;
  try {
    const r = await api(`/api/${category}/sequel`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title}),
    });
    showToast(`${title} → ${r.new_title}`);
    markResolved(key);
    div.classList.add("resolved");
    actionsEl.innerHTML = `<span class="muted">Обработано ✅</span>`;
  } catch (e) { showToast(e.message); }
}

async function histDelete(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  const div = actionsEl.closest(".hist-item");
  const {category, title, key} = div.dataset;
  try {
    await api(`/api/${category}/delete`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title}),
    });
    showToast(`${title} удалён`);
    markResolved(key);
    div.classList.add("resolved");
    actionsEl.innerHTML = `<span class="muted">Обработано ✅</span>`;
  } catch (e) { showToast(e.message); }
}
