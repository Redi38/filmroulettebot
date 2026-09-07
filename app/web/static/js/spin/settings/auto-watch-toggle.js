// ---- auto watch-link redirect ------------------------------------------
const AUTO_WATCH_ENABLED_KEY = "filmroulette_auto_watch_enabled";
function loadAutoWatchEnabled() {
  const v = getLS(AUTO_WATCH_ENABLED_KEY);
  return v === null ? true : v === "1";
}
function saveAutoWatchEnabled(v) {
  setLS(AUTO_WATCH_ENABLED_KEY, v ? "1" : "0");
}
let autoWatchEnabled = loadAutoWatchEnabled();
function isAutoWatchEnabled() { return autoWatchEnabled; }

function renderAutoWatchToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "auto-watch-toggle-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "showcase-filter-btn" + (autoWatchEnabled ? " active" : "");
  btn.textContent = "🔗 Редирект";
  btn.setAttribute("aria-pressed", autoWatchEnabled ? "true" : "false");
  btn.onclick = () => {
    autoWatchEnabled = !autoWatchEnabled;
    saveAutoWatchEnabled(autoWatchEnabled);
    renderControlOnAllDocks(renderAutoWatchToggle, "watch-toggle");
  };

  el.appendChild(btn);
}
