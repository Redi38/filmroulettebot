// History module state + local/server resolution storage.
// Shared by history-shell.js and history-list.js (loaded after this file).

let historyItems = [];
let historyFilter = initial.cat && CATS[initial.cat] ? initial.cat : "movies";
let historyTabsRendered = false;

function loadResolvedMap() {
  const raw = getLSJSON(RESOLVED_HIST_KEY, {});
  if (Array.isArray(raw)) return {};
  return raw && typeof raw === "object" ? raw : {};
}

function saveResolvedMap(map) {
  setLSJSON(RESOLVED_HIST_KEY, map);
}

function histKey(e) {
  return `${e.category}|${e.title}|${e.timestamp}`;
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
