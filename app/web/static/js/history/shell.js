import { api, apiPost } from "../core/api.js";
import { CATS } from "../core/constants.js";
import { skeletonHistoryHtml } from "../core/skeleton.js";
import { showToast } from "../core/toast.js";
import { fadeIn, fadeOut, setNavDirection } from "../core/transitions.js";
import { errorHtml } from "../core/utils.js";
import { animatePanelHeight } from "./height-anim.js";
import { renderHistoryList } from "./list.js";
import { historyState } from "./state.js";

// History module: panel content shell (tabs + clear button) and data loading.
// Opened and closed by history/panel.js.
// Relies on state/storage from history-state.js and renderHistoryList()
// from history-list.js (loaded after this file).

export async function loadHistory() {
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
    animatePanelHeight(renderHistoryList);
    fadeIn(list);
  } catch (e) {
    list.innerHTML = errorHtml(e);
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
      // The new list slides in from the side the picked tab is on.
      const codes = Object.keys(CATS);
      const dir = Math.sign(codes.indexOf(code) - codes.indexOf(historyState.filter));
      historyState.filter = code;
      [...tabs.children].forEach((c) => c.classList.toggle("active", c === btn));
      resetClearButton();
      const list = document.getElementById("history-list");
      setNavDirection(list, dir);
      await fadeOut(list);
      // Out of sight now: start the next list from the top, and let the panel
      // glide to the new list's height while the list fades back in.
      container.scrollTop = 0;
      animatePanelHeight(renderHistoryList);
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
    await apiPost(`/api/history/${cat}/clear`);
    historyState.items = historyState.items.filter((e) => e.category !== cat);
    resetClearButton();
    await fadeOut(list);
    animatePanelHeight(renderHistoryList);
    fadeIn(list);
    showToast(`История «${CATS[cat]}» очищена`);
  } catch (e) {
    resetClearButton();
    showToast(e.message);
  }
}
