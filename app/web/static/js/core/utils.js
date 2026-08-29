const API_TIMEOUT_MS = 15000;

async function api(path, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  const callerSignal = opts && opts.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort());
  }

  let resp;
  try {
    resp = await fetch(path, {...opts, signal: controller.signal});
  } catch (e) {
    if (e.name === "AbortError") {
      const timeoutErr = new Error("Сервер не отвечает. Проверь соединение и попробуй ещё раз.");
      timeoutErr.status = 0;
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({detail: resp.statusText}));
    const e = new Error(err.detail || "Ошибка запроса");
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

async function performSequel(category, title) {
  const r = await api(`/api/${category}/sequel`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({title}),
  });
  return r.new_title;
}

async function performDelete(category, title) {
  await api(`/api/${category}/delete-by-title`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({title}),
  });
}

function ensureFilterPanel(panelId, sectionId, beforeId) {
  const section = document.getElementById(sectionId);
  let panel = document.getElementById(panelId);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = panelId;
    panel.className = "filter-panel";
    section.insertBefore(panel, document.getElementById(beforeId));
  }
  panel.innerHTML = "";
  return panel;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1400);
}

function showInlineUndo(parent, referenceNode, msg, actionLabel, onAction, onDismiss, duration) {
  const ms = duration || 4500;
  const wrap = document.createElement("div");
  wrap.className = "inline-undo-row";
  const pill = document.createElement("div");
  pill.className = "inline-undo-pill";
  const text = document.createElement("span");
  text.className = "undo-text";
  text.textContent = msg;
  const btn = document.createElement("button");
  btn.innerHTML = `<span>${escapeHtml(actionLabel)}</span>`;
  btn.style.setProperty("--toast-duration", ms + "ms");
  pill.appendChild(text);
  pill.appendChild(btn);
  wrap.appendChild(pill);
  parent.insertBefore(wrap, referenceNode && referenceNode.isConnected ? referenceNode : null);

  let dismissed = false;
  let timer;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    pill.style.opacity = "0";
    setTimeout(() => {
      wrap.remove();
      if (onDismiss) onDismiss();
    }, 200);
  };
  requestAnimationFrame(() => btn.classList.add("wipe"));
  btn.onclick = () => {
    dismiss();
    onAction();
  };
  timer = setTimeout(dismiss, ms);
  return dismiss;
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

function escapeAttr(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function placeholderHtml(text, icon) {
  const fixedText = String(text).replace(/ ([\p{Extended_Pictographic}\uFE0F\u200d]+)$/u, "\u00A0$1");
  return `<div class="placeholder"><span class="big">${icon || "🎲"}</span>${fixedText}</div>`;
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(r)); }

async function fadeOut(el) {
  el.style.opacity = "0";
  await nextFrame();
  await new Promise((r) => setTimeout(r, 90));
}
function fadeIn(el) { requestAnimationFrame(() => { el.style.opacity = "1"; }); }

function removeRowOptimistically(row, deleteRequest, onRemoved) {
  row.style.transition = "opacity .15s ease, transform .15s ease";
  row.style.opacity = "0";
  row.style.transform = "translateX(10px)";
  setTimeout(() => {
    row.remove();
    if (onRemoved) onRemoved();
  }, 150);
  deleteRequest().catch((e) => {
    showToast(e.message || "Не удалось удалить");
  });
}

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

const PENCIL_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="M15 5l4 4"></path></svg>`;
