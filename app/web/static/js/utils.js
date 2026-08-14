async function api(path, opts) {
  const resp = await fetch(path, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({detail: resp.statusText}));
    throw new Error(err.detail || "Ошибка запроса");
  }
  return resp.json();
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1400);
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

function placeholderHtml(text) {
  return `<div class="placeholder"><span class="big">🎲</span>${text}</div>`;
}
