// Toast notifications.

// Toasts stack rather than overwrite one another: a second message used to
// replace the text of the toast already on screen, so the first one was
// never read. Each call now appends its own element; at most TOAST_MAX are
// kept and the oldest is retired early once that many pile up.
const TOAST_MAX = 3;
const TOAST_LEAVE_MS = 260;

function dismissToast(el) {
  if (!el || el._dismissed) return;
  el._dismissed = true;
  clearTimeout(el._hideTimer);
  el.classList.remove("show");
  setTimeout(() => el.remove(), TOAST_LEAVE_MS);
}

export function showToast(msg, type) {
  const isError = type === "error";
  const stack = document.getElementById(isError ? "toast-stack-error" : "toast-stack");
  if (!stack) return null;

  // Everything already on screen is a previous message — recede it so the
  // newest toast is the one that reads as current.
  for (const prev of stack.children) prev.classList.add("toast--stale");

  const el = document.createElement("div");
  el.className = "toast" + (isError ? " toast--error" : "");
  el.setAttribute("role", isError ? "alert" : "status");
  el.textContent = msg;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  const live = [...stack.children].filter((c) => !c._dismissed);
  for (const extra of live.slice(0, Math.max(0, live.length - TOAST_MAX))) dismissToast(extra);

  el._hideTimer = setTimeout(() => dismissToast(el), isError ? 3000 : 1400);
  return el;
}
