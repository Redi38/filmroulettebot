// History module: rendering the entry list and per-entry actions
// (confirm / sequel / delete / remove-from-history).
// Relies on state/storage from history-state.js and the shell helpers
// from history-shell.js (both loaded before this file).

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

function resolvedOutcomeLabel(title, outcome) {
  if (outcome.type === "sequel" && outcome.newTitle) {
    return `🔄 ${escapeHtml(title)} → ${escapeHtml(outcome.newTitle)}`;
  }
  if (outcome.type === "delete") {
    return `❌ Удалено`;
  }
  return `Обработано ✅`;
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

function histConfirm(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  actionsEl.innerHTML = `
    <button class="btn btn-success" onclick="histSequel(${idx})">Сиквел</button>
    <button class="btn btn-danger" onclick="histDelete(${idx})">Удалить</button>
    <button class="btn btn-danger hist-clear-entry-btn" onclick="histClearEntry(${idx})" title="Удалить эту запись из истории">Очистить</button>`;
}

async function histSequel(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  const div = actionsEl.closest(".hist-item");
  const {category, title, timestamp, key} = div.dataset;
  try {
    const newTitle = await performSequel(category, title);
    showToast(`${title} → ${newTitle}`);
    markResolved(key, { type: "sequel", newTitle });
    resolveOnServer(category, title, timestamp, "sequel", newTitle);
    div.classList.add("resolved");
    actionsEl.innerHTML = `
      <span class="muted">${resolvedOutcomeLabel(title, { type: "sequel", newTitle })}</span>
      <button class="btn btn-danger hist-clear-entry-btn" onclick="histClearEntry(${idx})" title="Удалить эту запись из истории">Очистить</button>`;
  } catch (e) { showToast(e.message); }
}

async function histDelete(idx) {
  const actionsEl = document.getElementById(`hist-actions-${idx}`);
  const div = actionsEl.closest(".hist-item");
  const {category, title, timestamp, key} = div.dataset;
  try {
    await performDelete(category, title);
    showToast(`${title} удалён`);
    markResolved(key, { type: "delete" });
    resolveOnServer(category, title, timestamp, "delete", null);
    div.classList.add("resolved");
    actionsEl.innerHTML = `
      <span class="muted">${resolvedOutcomeLabel(title, { type: "delete" })}</span>
      <button class="btn btn-danger hist-clear-entry-btn" onclick="histClearEntry(${idx})" title="Удалить эту запись из истории">Очистить</button>`;
  } catch (e) { showToast(e.message); }
}
