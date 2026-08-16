async function api(path, opts) {
  const resp = await fetch(path, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({detail: resp.statusText}));
    const e = new Error(err.detail || "Ошибка запроса");
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1400);
}

let _actionToastTimer = null;
function showActionToast(msg, actionLabel, onAction, duration) {
  const t = document.getElementById("action-toast");
  const text = document.getElementById("action-toast-text");
  const btn = document.getElementById("action-toast-btn");
  const ms = duration || 4500;
  clearTimeout(_actionToastTimer);
  text.textContent = msg;
  btn.innerHTML = `<span>${escapeHtml(actionLabel)}</span>`;
  btn.style.setProperty("--toast-duration", ms + "ms");
  btn.classList.remove("wipe");
  void btn.offsetWidth;
  btn.classList.add("wipe");
  btn.onclick = () => {
    t.classList.remove("show");
    clearTimeout(_actionToastTimer);
    onAction();
  };
  t.classList.add("show");
  _actionToastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function copyToClipboard(text, el) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
  if (ok) {
    showToast("Скопировано: " + text);
  } else if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast("Скопировано: " + text))
      .catch(() => showToast("Не удалось скопировать"));
  } else {
    showToast("Не удалось скопировать");
  }
  if (el) {
    el.classList.add("copied");
    setTimeout(() => el.classList.remove("copied"), 300);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function escapeAttr(s) { return String(s).replace(/'/g, "\\'"); }

function placeholderHtml(text, icon) {
  return `<div class="placeholder"><span class="big">${icon || "🎲"}</span>${text}</div>`;
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;
