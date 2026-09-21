import { apiPost } from "../core/api.js";
import { CATS } from "../core/constants.js";
import { RESOLVED_HIST_KEY, initial } from "../core/state.js";
import { getLSJSON, setLSJSON } from "../core/storage.js";

// History module state + local/server resolution storage.
// Shared by history-shell.js and history-list.js (loaded after this file).

// Mutated from history/shell.js and history/list.js, so it has to be a
// shared object rather than plain `let` exports.
export const historyState = {
  items: [],
  filter: initial.cat && CATS[initial.cat] ? initial.cat : "movies",
  tabsRendered: false,
  // Raw items from the last successful /api/history fetch (pre-filter,
  // marvel/dc already stripped), used by loadHistory() to detect a
  // no-op reload and skip the fade/re-render — see history/shell.js.
  lastLoadedRaw: null,
};

export function loadResolvedMap() {
  const raw = getLSJSON(RESOLVED_HIST_KEY, {});
  if (Array.isArray(raw)) return {};
  return raw && typeof raw === "object" ? raw : {};
}

function saveResolvedMap(map) {
  setLSJSON(RESOLVED_HIST_KEY, map);
}

export function histKey(e) {
  return `${e.category}|${e.title}|${e.timestamp}`;
}

export function markResolved(key, outcome) {
  const map = loadResolvedMap();
  map[key] = outcome || { type: "unknown" };
  saveResolvedMap(map);
}

export async function resolveOnServer(category, title, timestamp, resolvedType, newTitle) {
  try {
    await apiPost("/api/history/resolve", {
      category, title, timestamp: Number(timestamp),
      resolved_type: resolvedType, new_title: newTitle || null,
    });
  } catch {
  }
}
