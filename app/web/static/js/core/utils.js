// api(), performSequel(), performDelete() moved to core/api.js (typed
// against the backend's OpenAPI schema — see that file's header comment).
// This file keeps the untyped DOM/UI helpers that don't touch the network.

function ensureFilterPanel(panelId, sectionId, beforeId) {
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

function showToast(msg, type) {
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
  // The pill takes the place of a row that is collapsing to zero height at
  // this very moment, so it has to grow into the gap rather than appear at
  // full height — otherwise the row visibly "comes back" as the pill pops in.
  expandRowIn(wrap);

  let dismissed = false;
  let timer;
  const dismiss = (fireCallback) => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    pill.style.opacity = "0";
    // Collapse the pill's own height too, so the rows below glide up instead
    // of jumping the moment the node leaves the flow.
    collapseAndRemoveRow(wrap, () => {
      if (fireCallback && onDismiss) onDismiss();
    }, {fadeMs: 120});
  };
  requestAnimationFrame(() => btn.classList.add("wipe"));
  btn.onclick = () => {
    dismiss(false);
    onAction();
  };
  timer = setTimeout(() => dismiss(true), ms);
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

// Fades `el` to opacity 0 and resolves once its CSS transition has actually
// finished, so callers can swap innerHTML while it is fully invisible.
// Previously this waited a fixed 90 ms while the containers transition over
// 220 ms — the new content was inserted at ~40% opacity and then finished
// fading, which read as a visible jump.
function maxTransitionMs(el) {
  const cs = getComputedStyle(el);
  const parse = (v) => v.split(",").map((s) => {
    s = s.trim();
    return s.endsWith("ms") ? parseFloat(s) : parseFloat(s) * 1000;
  });
  const durs = parse(cs.transitionDuration);
  const delays = parse(cs.transitionDelay);
  let max = 0;
  for (let i = 0; i < durs.length; i++) {
    const d = (durs[i] || 0) + (delays[i % delays.length] || 0);
    if (d > max) max = d;
  }
  return max;
}
function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Page navigation slides the old page out and the new one in along the
// direction of travel instead of cross-fading in place. paginationRow()
// tags the container it lives in; fadeOut() reads the tag and fadeIn()
// clears it, so an untagged container keeps the plain cross-fade.
const NAV_SLIDE_PX = 22;

function setNavDirection(el, dir) {
  if (el) el._navDir = dir;
}

async function fadeOut(el) {
  const dir = reducedMotion() ? 0 : (el._navDir || 0);
  const ms = maxTransitionMs(el);
  el.style.opacity = "0";
  if (dir) el.style.transform = `translateX(${-dir * NAV_SLIDE_PX}px)`;
  await nextFrame();
  await new Promise((r) => setTimeout(r, Math.min(400, Math.max(60, ms + 20))));
}

function fadeIn(el) {
  const dir = reducedMotion() ? 0 : (el._navDir || 0);
  el._navDir = 0;
  if (dir) {
    // Jump to the far edge with the transition suppressed, then animate home
    // on the next frame — otherwise the element would slide back across from
    // where fadeOut() left it.
    el.style.transition = "none";
    el.style.transform = `translateX(${dir * NAV_SLIDE_PX}px)`;
    void el.offsetWidth;
    el.style.transition = "";
  }
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "";
  });
}

// Fades a row out and then collapses its height to zero, so the rows below
// glide up into the gap instead of jumping the moment the node is removed.
const ROW_FADE_MS = 140;
const ROW_COLLAPSE_MS = 200;

// Inline styles left behind by a collapse. Cleared before a node that was
// collapsed is put back into the flow (undo), otherwise it would return with
// height: 0 and stay invisible.
const ROW_COLLAPSE_PROPS = [
  "overflow", "boxSizing", "height", "marginTop", "marginBottom",
  "paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth",
  "transition", "opacity", "transform",
];

function resetRowCollapse(el) {
  if (!el) return;
  for (const prop of ROW_COLLAPSE_PROPS) el.style[prop] = "";
}

// Grows `el` from zero height to its natural height. Used for anything that
// appears where a row just was (the undo pill), so the two animations cancel
// out and the surrounding rows never move.
function expandRowIn(el) {
  if (!el || reducedMotion()) return;
  const cs = getComputedStyle(el);
  const target = el.getBoundingClientRect().height;
  if (!target) return;
  const marginTop = cs.marginTop;
  const marginBottom = cs.marginBottom;
  const paddingTop = cs.paddingTop;
  const paddingBottom = cs.paddingBottom;

  el.style.overflow = "hidden";
  el.style.boxSizing = "border-box";
  el.style.height = "0px";
  el.style.marginTop = "0px";
  el.style.marginBottom = "0px";
  el.style.paddingTop = "0px";
  el.style.paddingBottom = "0px";
  el.style.opacity = "0";

  requestAnimationFrame(() => {
    el.style.transition =
      `height ${ROW_COLLAPSE_MS}ms var(--ease-standard), ` +
      `margin ${ROW_COLLAPSE_MS}ms var(--ease-standard), ` +
      `padding ${ROW_COLLAPSE_MS}ms var(--ease-standard), ` +
      `opacity ${ROW_FADE_MS}ms ease ${ROW_COLLAPSE_MS * 0.4}ms`;
    el.style.height = `${target}px`;
    el.style.marginTop = marginTop;
    el.style.marginBottom = marginBottom;
    el.style.paddingTop = paddingTop;
    el.style.paddingBottom = paddingBottom;
    el.style.opacity = "1";
  });
  // Hand the box back to the layout engine once it has arrived, so later
  // content changes are not pinned to a stale pixel height.
  setTimeout(() => resetRowCollapse(el), ROW_COLLAPSE_MS + ROW_FADE_MS + 40);
}

// `opts.onCollapseStart` fires on the frame the collapse begins, so a caller
// can insert a replacement (the undo pill) that expands in step with it.
function collapseAndRemoveRow(row, onRemoved, opts) {
  const options = opts || {};
  const fadeMs = options.fadeMs === undefined ? ROW_FADE_MS : options.fadeMs;
  const done = () => {
    row.remove();
    if (onRemoved) onRemoved();
  };
  if (reducedMotion()) {
    if (options.onCollapseStart) options.onCollapseStart();
    done();
    return;
  }

  const cs = getComputedStyle(row);
  const height = row.getBoundingClientRect().height;
  row.style.overflow = "hidden";
  row.style.boxSizing = "border-box";
  row.style.height = `${height}px`;
  row.style.marginTop = cs.marginTop;
  row.style.marginBottom = cs.marginBottom;
  row.style.paddingTop = cs.paddingTop;
  row.style.paddingBottom = cs.paddingBottom;

  requestAnimationFrame(() => {
    if (options.onCollapseStart) options.onCollapseStart();
    row.style.transition =
      `opacity ${fadeMs}ms ease, transform ${fadeMs}ms ease, ` +
      `height ${ROW_COLLAPSE_MS}ms var(--ease-standard) ${fadeMs * 0.5}ms, ` +
      `margin ${ROW_COLLAPSE_MS}ms var(--ease-standard) ${fadeMs * 0.5}ms, ` +
      `padding ${ROW_COLLAPSE_MS}ms var(--ease-standard) ${fadeMs * 0.5}ms, ` +
      `border-width ${ROW_COLLAPSE_MS}ms var(--ease-standard) ${fadeMs * 0.5}ms`;
    row.style.opacity = "0";
    row.style.transform = "translateX(10px)";
    row.style.height = "0px";
    row.style.marginTop = "0px";
    row.style.marginBottom = "0px";
    row.style.paddingTop = "0px";
    row.style.paddingBottom = "0px";
    row.style.borderTopWidth = "0px";
    row.style.borderBottomWidth = "0px";
  });
  setTimeout(done, fadeMs * 0.5 + ROW_COLLAPSE_MS + 20);
}

function removeRowOptimistically(row, deleteRequest, onRemoved, opts) {
  collapseAndRemoveRow(row, onRemoved, opts);
  deleteRequest().catch((e) => {
    showToast(e.message || "Не удалось удалить");
  });
}

// Swaps a container's contents with the outgoing and incoming markup
// overlapping, so a skeleton hands over to the real card instead of being
// replaced between two frames. The outgoing copy is taken out of the flow
// while it fades, so the box is sized by the incoming content throughout.
const CROSSFADE_MS = 220;

function crossfadeContent(container, html) {
  if (!container) return;
  if (reducedMotion() || !container.firstChild) {
    container.innerHTML = html;
    return;
  }
  const outgoing = document.createElement("div");
  outgoing.className = "xfade-layer xfade-out";
  while (container.firstChild) outgoing.appendChild(container.firstChild);

  const incoming = document.createElement("div");
  incoming.className = "xfade-layer xfade-in";
  incoming.innerHTML = html;

  container.classList.add("xfade-host");
  container.appendChild(outgoing);
  container.appendChild(incoming);

  requestAnimationFrame(() => {
    outgoing.style.opacity = "0";
    incoming.style.opacity = "1";
  });

  setTimeout(() => {
    outgoing.remove();
    // Unwrap the incoming layer so callers keep querying a flat container.
    while (incoming.firstChild) container.insertBefore(incoming.firstChild, incoming);
    incoming.remove();
    container.classList.remove("xfade-host");
  }, CROSSFADE_MS + 30);
}

// Runs `update` inside a View Transition when the browser has one, with
// `vtClass` on <html> for the duration so the transition's CSS can be scoped
// to this particular navigation. Falls back to running `update` directly.
function runViewTransition(update, vtClass) {
  if (reducedMotion() || typeof document.startViewTransition !== "function") {
    update();
    return Promise.resolve();
  }
  document.documentElement.classList.add(vtClass);
  let vt;
  try {
    vt = document.startViewTransition(update);
  } catch (e) {
    document.documentElement.classList.remove(vtClass);
    return Promise.resolve();
  }
  // `finished` rejects when a transition is interrupted by the next one; the
  // DOM update itself has already run either way.
  return vt.finished
    .catch(() => {})
    .then(() => { document.documentElement.classList.remove(vtClass); });
}

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

const PENCIL_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="M15 5l4 4"></path></svg>`;
