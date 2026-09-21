// List-row animations: fade + collapse on delete, expand on undo, and the
// inline undo pill that sits where the deleted row was.

import { showToast } from "./toast.js";
import { reducedMotion } from "./transitions.js";
import { escapeHtml } from "./utils.js";

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

export function resetRowCollapse(el) {
  if (!el) return;
  for (const prop of ROW_COLLAPSE_PROPS) el.style[prop] = "";
}

export function expandRowIn(el) {
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
export function collapseAndRemoveRow(row, onRemoved, opts) {
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

export function removeRowOptimistically(row, deleteRequest, onRemoved, opts) {
  collapseAndRemoveRow(row, onRemoved, opts);
  deleteRequest().catch((e) => {
    showToast(e.message || "Не удалось удалить");
  });
}

export function showInlineUndo(parent, referenceNode, msg, actionLabel, onAction, onDismiss, duration) {
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
  expandRowIn(wrap);

  let dismissed = false;
  let timer;
  const dismiss = (fireCallback) => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    pill.style.opacity = "0";
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
