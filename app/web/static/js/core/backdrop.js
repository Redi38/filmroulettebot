// Close-on-backdrop that ignores drags: a press that starts inside a dialog
// (e.g. selecting text in an input) and is released over the backdrop still
// fires a `click` on the overlay (their common ancestor), so also require the
// press itself to have begun on the backdrop.
export function onBackdropClick(overlay, handler) {
  let pressedOnBackdrop = false;
  overlay.addEventListener("pointerdown", (ev) => { pressedOnBackdrop = ev.target === overlay; });
  overlay.addEventListener("click", (ev) => {
    const startedOnBackdrop = pressedOnBackdrop;
    pressedOnBackdrop = false;
    if (ev.target === overlay && startedOnBackdrop) handler(ev);
  });
}
