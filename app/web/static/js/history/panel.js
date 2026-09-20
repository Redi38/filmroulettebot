import { loadHistory } from "./shell.js";

// History panel: the roulette screen's lower-right corner. A pill button
// (#history-fab) toggles a small panel anchored above it; the panel hosts the
// same tabs / clear button / list that used to be the separate "История" view
// (see shell.js and list.js). Markup lives in index.html inside #spin-section,
// so it only exists on screen while the roulette does.

const fab = document.getElementById("history-fab");
const panel = document.getElementById("history-panel");
const closeBtn = document.getElementById("history-panel-close");

let isOpen = false;

export function isHistoryPanelOpen() {
  return isOpen;
}

export function openHistoryPanel() {
  if (isOpen || !panel) return;
  isOpen = true;
  panel.classList.add("open");
  fab.classList.add("open");
  fab.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  document.addEventListener("keydown", onKeydown);
  // Always refetch on open: a spin since the last look has added an entry.
  // loadHistory() skips the re-render when nothing changed.
  loadHistory();
}

export function closeHistoryPanel() {
  if (!isOpen || !panel) return;
  isOpen = false;
  panel.classList.remove("open");
  fab.classList.remove("open");
  fab.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  document.removeEventListener("keydown", onKeydown);
}

export function toggleHistoryPanel() {
  if (isOpen) closeHistoryPanel();
  else openHistoryPanel();
}

// Tapping anywhere else closes the panel — except inside a modal the panel
// itself opened (sequel / rename), which would otherwise close it underneath.
function onOutsidePointerDown(ev) {
  const t = ev.target;
  if (panel.contains(t) || fab.contains(t)) return;
  if (t.closest && t.closest(".modal-overlay-base.open")) return;
  closeHistoryPanel();
}

function onKeydown(ev) {
  if (ev.key !== "Escape") return;
  // A modal on top gets Escape first.
  if (document.querySelector(".modal-overlay-base.open")) return;
  closeHistoryPanel();
  fab.focus();
}

if (fab && panel) {
  fab.addEventListener("click", toggleHistoryPanel);
  closeBtn.addEventListener("click", () => { closeHistoryPanel(); fab.focus(); });
}
