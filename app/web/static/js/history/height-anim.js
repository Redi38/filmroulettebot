import { reducedMotion } from "../core/utils.js";

// The history panel is as tall as its content (up to a max-height), so any
// change to what is inside it — another tab with a shorter or longer list, a
// cleared entry, a row swapping its buttons — used to make the panel jump.
// animatePanelHeight(mutate) runs the change and glides the panel from its old
// height to its new one instead. Height cannot be transitioned to `auto`, so
// the new natural height is measured and the panel is animated between two
// pixel values; the inline height is dropped again once it lands so later
// natural changes (a window resize, say) are not pinned.

// Keep in step with the `height` duration on .history-panel.open.resizing.
const RESIZE_MS = 280;

let runToken = 0;

export function animatePanelHeight(mutate) {
  const panel = document.getElementById("history-panel");
  // Nothing to animate when the panel is hidden or motion is reduced.
  if (!panel || !panel.classList.contains("open") || reducedMotion()) {
    mutate();
    return;
  }

  const token = ++runToken;
  // If a previous resize is still running, its current height is the honest
  // starting point (offsetHeight reports the animated value).
  const from = panel.offsetHeight;

  mutate();

  panel.classList.remove("resizing");
  panel.style.height = "auto";
  const to = panel.offsetHeight;

  if (Math.abs(to - from) < 1) {
    panel.style.height = "";
    return;
  }

  panel.style.height = `${from}px`;
  void panel.offsetHeight; // commit the starting height before transitioning
  panel.classList.add("resizing");
  panel.style.height = `${to}px`;

  setTimeout(() => {
    if (token !== runToken) return; // a newer resize owns the panel now
    panel.classList.remove("resizing");
    panel.style.height = "";
  }, RESIZE_MS + 60);
}
