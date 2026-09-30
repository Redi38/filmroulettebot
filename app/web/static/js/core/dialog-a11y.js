// Dialog behaviour shared by the four overlays (.modal-overlay-base): move
// focus into the dialog when it opens, keep Tab inside it, give focus back
// when it closes. The markup carries role="dialog" / aria-modal (index.html).
//
// The modals are opened and closed by adding/removing an `open` class from
// several different modules, so instead of touching each of them this watches
// that class. Escape and click-outside stay where they already live.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const overlays = [...document.querySelectorAll(".modal-overlay-base")];
const openerOf = new Map();   // overlay -> element to give focus back to
const wasOpen = new Map();

const boxOf = (overlay) => overlay.querySelector(".modal-box-base");

function tabbable(box) {
  return [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

function openOverlay() {
  return overlays.find((o) => o.classList.contains("open")) || null;
}

function onOpened(overlay, opener) {
  // The observer runs right after the code that opened the modal and before
  // any focus change it schedules (those happen in a rAF), so the active
  // element here is still whatever opened it.
  // Only hand focus back to keyboard users: a click leaves the opener
  // focused-but-not-:focus-visible, and re-focusing e.g. a home poster would
  // freeze the marquee (it pauses on :focus-within) after every mouse click.
  const keyboard = opener && opener !== document.body && opener.matches(":focus-visible");
  openerOf.set(overlay, keyboard ? opener : null);

  // A frame later: the rename modal focuses its own input in a rAF, and some
  // content (poster card, search results) is filled in asynchronously.
  requestAnimationFrame(() => {
    const box = boxOf(overlay);
    if (!box || !overlay.classList.contains("open") || box.contains(document.activeElement)) return;
    (tabbable(box)[0] || box).focus({preventScroll: true});
  });
}

function onClosed(overlay) {
  const opener = openerOf.get(overlay);
  openerOf.delete(overlay);
  const focusLost = !document.activeElement || document.activeElement === document.body
    || overlay.contains(document.activeElement);
  if (opener && opener.isConnected && focusLost) opener.focus({preventScroll: true});
}

const observer = new MutationObserver((records) => {
  for (const rec of records) {
    const overlay = rec.target;
    const open = overlay.classList.contains("open");
    if (open === !!wasOpen.get(overlay)) continue;
    wasOpen.set(overlay, open);
    if (open) onOpened(overlay, document.activeElement);
    else onClosed(overlay);
  }
});

for (const overlay of overlays) {
  wasOpen.set(overlay, overlay.classList.contains("open"));
  observer.observe(overlay, {attributes: true, attributeFilter: ["class"]});
}

// Tab stays inside the open dialog; Shift+Tab wraps the other way.
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    // The rename modal only handles Escape while its input has focus; now
    // that focus can sit on Save/Cancel it has to close from there too.
    const rename = document.getElementById("rename-modal-overlay");
    if (rename.classList.contains("open") && ev.target !== document.getElementById("rename-modal-input")) {
      document.getElementById("rename-modal-cancel").click();
    }
    return;
  }
  if (ev.key !== "Tab") return;
  const overlay = openOverlay();
  const box = overlay && boxOf(overlay);
  if (!box) return;
  const items = tabbable(box);
  if (!items.length) { ev.preventDefault(); box.focus(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  if (!box.contains(document.activeElement)) {
    ev.preventDefault();
    (ev.shiftKey ? last : first).focus();
  } else if (ev.shiftKey && (document.activeElement === first || document.activeElement === box)) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
});
