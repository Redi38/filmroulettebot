import { showToast } from "./toast.js";

// Small DOM / string helpers. Toasts live in toast.js, fades and transitions
// in transitions.js, row animations in rows.js, row-button icons in icons.js.

export function ensureFilterPanel(panelId, sectionId, beforeId) {
  const section = document.getElementById(sectionId);
  let panel = document.getElementById(panelId);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = panelId;
    panel.className = "filter-panel";
    section.insertBefore(panel, document.getElementById(beforeId));
  }
  return panel;
}

export function copyToClipboard(text, el) {
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

// Safe in both text content and double- or single-quoted attribute values
// (data-title="..."), so templates need only one escaper. The old
// escapeAttr() that produced a JS string literal for inline onclick="..."
// handlers is gone along with those handlers.
const HTML_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function placeholderHtml(text, icon) {
  const fixedText = String(text).replace(/ ([\p{Extended_Pictographic}\uFE0F\u200d]+)$/u, "\u00A0$1");
  return `<div class="placeholder"><span class="big">${icon || "🎲"}</span>${fixedText}</div>`;
}

// The inline "request failed" line that replaces a section's content.
// `fallback` covers an error with no message of its own.
export function errorHtml(err, fallback = "") {
  return `<div class="muted">❌ ${escapeHtml(err.message || fallback)}</div>`;
}

export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
