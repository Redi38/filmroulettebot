import { api } from "../core/api.js";
import { CATS } from "../core/constants.js";
import { skeletonHistoryHtml } from "../core/skeleton.js";
import { escapeHtml, fadeIn, fadeOut, showToast } from "../core/utils.js";
import { renderHistoryList } from "./list.js";
import { historyState } from "./state.js";

// History module: page shell (tabs + clear button) and data loading.
// Relies on state/storage from history-state.js and renderHistoryList()
// from history-list.js (loaded after this file).

export async function loadHistory() {
  const container = document.getElementById("history-container");
  ensureHistoryShell();
  const list = document.getElementById("history-list");
  const isFreshView = list.dataset.loaded !== "1";
  if (isFreshView) {
    list.innerHTML = skeletonHistoryHtml();
  }
  try {
    const data = await api("/api/history?limit=50");
    const items = data.items.filter((e) => e.category !== "marvel" && e.category !== "dc");
    // Same shape as before (id-less objects with stable key order from the
    // API), so a plain JSON compare is enough to tell "nothing changed in
    // the DB" apart from a real update — skip the fade/re-render dance for
    // the former so revisiting the tab doesn't flicker for no reason.
    const unchanged = !isFreshView
      && historyState.lastLoadedRaw !== null
      && JSON.stringify(items) === JSON.stringify(historyState.lastLoadedRaw);
    historyState.items = items;
    historyState.lastLoadedRaw = items;
    list.dataset.loaded = "1";
    if (unchanged) return;
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
  if (historyState.tabsRendered) return;
  container.innerHTML = "";

  const tabs = document.createElement("div");
  tabs.className = "hist-tabs";
  for (const [code, label] of Object.entries(CATS)) {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary" + (historyState.filter === code ? " active" : "");
    btn.textContent = label;
    btn.onclick = async () => {
      if (historyState.filter === code) return;
      historyState.filter = code;
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

  historyState.tabsRendered = true;
}

let clearConfirmTimer = null;
function resetClearButton() {
  clearTimeout(clearConfirmTimer);
  const btn = document.getElementById("hist-clear-btn");
  if (!btn) return;
  btn.textContent = "Очистить историю";
  btn.classList.remove("confirming");
}

export function updateClearButtonState(hasItems) {
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
  clearHistoryCategory(historyState.filter);
}

async function clearHistoryCategory(cat) {
  const list = document.getElementById("history-list");
  try {
    await api(`/api/history/${cat}/clear`, {method: "POST"});
    historyState.items = historyState.items.filter((e) => e.category !== cat);
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
