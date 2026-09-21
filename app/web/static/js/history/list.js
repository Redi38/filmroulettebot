import { apiPost, performDelete, performSequel } from "../core/api.js";
import { CATS } from "../core/constants.js";
import { showToast } from "../core/toast.js";
import { fadeIn, fadeOut } from "../core/transitions.js";
import { escapeHtml, placeholderHtml } from "../core/utils.js";
import { animatePanelHeight } from "./height-anim.js";
import { updateClearButtonState } from "./shell.js";
import { histKey, historyState, loadResolvedMap, markResolved, resolveOnServer } from "./state.js";

// History module: rendering the entry list and per-entry actions
// (confirm / sequel / delete / remove-from-history).
// Relies on state/storage from history-state.js and the shell helpers
// from history-shell.js (both loaded before this file).

export function renderHistoryList() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  const filtered = historyState.items
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e.category === historyState.filter);

  if (!filtered.length) {
    list.innerHTML = placeholderHtml(`В категории «${CATS[historyState.filter]}» пока нет истории — она появится после первого ролла 🎲`, "📜");
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
    div.className = "hist-item fade-in" + (isResolved ? " resolved" : "");
    div.style.setProperty("--row-i", Math.min(idx, 10));
    div.dataset.category = e.category;
    div.dataset.title = e.title;
    div.dataset.timestamp = e.timestamp;
    div.dataset.key = key;
    div.dataset.idx = String(idx);
    const date = new Date(e.timestamp * 1000).toLocaleString("ru-RU");
    const actionsHtml = isResolved
      ? `<span class="muted">${resolvedOutcomeLabel(e.title, outcome)}</span>`
      : `<button class="btn btn-success" data-hist-action="confirm">Подтвердить</button>`;
    div.innerHTML = `
      <div class="hist-title">${escapeHtml(e.title)}</div>
      <div class="hist-meta">${date}</div>
      <div class="hist-actions">
        ${actionsHtml}
        ${HIST_CLEAR_BTN}
      </div>`;
    list.appendChild(div);
  });
}

const HIST_CLEAR_BTN = `<button class="btn btn-danger hist-clear-entry-btn" data-hist-action="clear" title="Удалить эту запись из истории">Очистить</button>`;

// One delegated listener instead of an inline handler per button: the
// markup carries only a `data-hist-action`, the row it belongs to is found
// by walking up to `.hist-item`. Keeps the templates CSP-friendly and means
// the handlers no longer have to be globals.
const HIST_ACTIONS = {
  confirm: histConfirm, clear: histClearEntry,
  sequel: histSequel, delete: histDelete, watched: histWatched,
};
// Listens on the static panel: #history-list itself is created lazily by
// history/shell.js the first time the panel opens.
document.getElementById("history-panel").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-hist-action]");
  if (!btn) return;
  const row = btn.closest(".hist-item");
  const handler = row && HIST_ACTIONS[btn.dataset.histAction];
  if (handler) handler(row);
});

function resolvedOutcomeLabel(title, outcome) {
  if (outcome.type === "sequel" && outcome.newTitle) {
    return `🔄 ${escapeHtml(title)} → ${escapeHtml(outcome.newTitle)}`;
  }
  if (outcome.type === "delete") {
    return `❌ Удалено`;
  }
  if (outcome.type === "watched") {
    return `✅ Просмотрено`;
  }
  return `Обработано ✅`;
}

async function histClearEntry(row) {
  const idx = Number(row.dataset.idx);
  const entry = historyState.items[idx];
  if (!entry) return;
  try {
    await apiPost("/api/history/delete", {
      category: entry.category, title: entry.title, timestamp: Number(entry.timestamp),
    });
    historyState.items = historyState.items.filter((_, i) => i !== idx);
    const list = document.getElementById("history-list");
    await fadeOut(list);
    animatePanelHeight(renderHistoryList);
    fadeIn(list);
    showToast(`Запись «${entry.title}» удалена из истории`);
  } catch (e) { showToast(e.message); }
}

function histConfirm(row) {
  animatePanelHeight(() => {
    row.querySelector(".hist-actions").innerHTML = `
    <button class="btn btn-success" data-hist-action="sequel">Сиквел</button>
    <button class="btn btn-danger" data-hist-action="delete">Удалить</button>
    <button class="btn btn-primary" data-hist-action="watched" title="Просмотрено — без сиквела и без удаления из списка">Просмотрено</button>
    ${HIST_CLEAR_BTN}`;
  });
}

async function histWatched(div) {
  const actionsEl = div.querySelector(".hist-actions");
  const {category, title, timestamp, key} = div.dataset;
  markResolved(key, { type: "watched" });
  resolveOnServer(category, title, timestamp, "watched", null);
  animatePanelHeight(() => {
    div.classList.add("resolved");
    actionsEl.innerHTML = `
    <span class="muted">${resolvedOutcomeLabel(title, { type: "watched" })}</span>
    ${HIST_CLEAR_BTN}`;
  });
}

async function histSequel(div) {
  const actionsEl = div.querySelector(".hist-actions");
  const {category, title, timestamp, key} = div.dataset;
  try {
    const newTitle = await performSequel(category, title);
    showToast(`${title} → ${newTitle}`);
    markResolved(key, { type: "sequel", newTitle });
    resolveOnServer(category, title, timestamp, "sequel", newTitle);
    animatePanelHeight(() => {
      div.classList.add("resolved");
      actionsEl.innerHTML = `
      <span class="muted">${resolvedOutcomeLabel(title, { type: "sequel", newTitle })}</span>
      ${HIST_CLEAR_BTN}`;
    });
  } catch (e) { showToast(e.message); }
}

async function histDelete(div) {
  const actionsEl = div.querySelector(".hist-actions");
  const {category, title, timestamp, key} = div.dataset;
  try {
    await performDelete(category, title);
    showToast(`${title} удалён`);
    markResolved(key, { type: "delete" });
    resolveOnServer(category, title, timestamp, "delete", null);
    animatePanelHeight(() => {
      div.classList.add("resolved");
      actionsEl.innerHTML = `
      <span class="muted">${resolvedOutcomeLabel(title, { type: "delete" })}</span>
      ${HIST_CLEAR_BTN}`;
    });
  } catch (e) { showToast(e.message); }
}
