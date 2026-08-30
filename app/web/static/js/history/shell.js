// History module: page shell (tabs + clear button) and data loading.
// Relies on state/storage from history-state.js and renderHistoryList()
// from history-list.js (loaded after this file).

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
