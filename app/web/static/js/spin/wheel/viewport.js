// Roulette wheel: resize/orientation/ResizeObserver orchestration.

const SPIN_RESULT_MAX_WIDTH = 860;
const SPIN_RESULT_PAIRS = [
  { sectionId: "random-spin-section", resultId: "random-spin-result" },
  { sectionId: "spin-section", resultId: "spin-result" },
];

function syncSpinResultClearance() {
  const isDesktop = window.matchMedia("(min-width: 900px)").matches;
  for (const { sectionId, resultId } of SPIN_RESULT_PAIRS) {
    const section = document.getElementById(sectionId);
    const result = document.getElementById(resultId);
    if (!section || !result) continue;
    result.style.paddingTop = "";
    result.style.width = "";
    result.style.maxWidth = "";
    result.style.marginLeft = "";
    result.style.marginRight = "";

    const dock = section.querySelector(".spin-controls-dock");
    if (!dock || !section.classList.contains("active")) continue;
    const dockPos = getComputedStyle(dock).position;
    if (dockPos !== "fixed" && dockPos !== "absolute") continue;
    const dockRect = dock.getBoundingClientRect();

    if (isDesktop) {
      const sectionRect = section.getBoundingClientRect();
      const centerX = (sectionRect.left + sectionRect.right) / 2;
      const gap = 28;
      const safeWidth = Math.floor((dockRect.left - centerX - gap) * 2);
      const width = Math.max(320, Math.min(SPIN_RESULT_MAX_WIDTH, safeWidth));
      result.style.width = width + "px";
      result.style.maxWidth = width + "px";
      result.style.marginLeft = "auto";
      result.style.marginRight = "auto";
      if (safeWidth < 320) {
        const resultRect = result.getBoundingClientRect();
        result.style.paddingTop = Math.max(0, Math.ceil(dockRect.bottom - resultRect.top) + 16) + "px";
      }
    } else {
      const resultRect = result.getBoundingClientRect();
      result.style.paddingTop = Math.max(0, Math.ceil(dockRect.bottom - resultRect.top) + 16) + "px";
    }
  }
}

const IS_TOUCH_PRIMARY = !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);
const TOOLBAR_RESIZE_THRESHOLD = 150;

function onRealResize(handler) {
  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;
  return () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const widthDelta = Math.abs(w - lastWidth);
    const heightDelta = Math.abs(h - lastHeight);
    lastWidth = w;
    lastHeight = h;
    if (widthDelta < 1 && heightDelta < 1) return;
    if (IS_TOUCH_PRIMARY && widthDelta < 1 && heightDelta < TOOLBAR_RESIZE_THRESHOLD) return;
    handler();
  };
}

function refreshWheelLayout() {
  rebuildVisibleWheels();
  syncSpinResultClearance();
}
const debouncedRefreshWheelLayout = typeof debounce === "function"
  ? debounce(refreshWheelLayout, 150)
  : refreshWheelLayout;
window.addEventListener("resize", onRealResize(debouncedRefreshWheelLayout));
window.addEventListener("orientationchange", debouncedRefreshWheelLayout);

let dockRevealToken = 0;
let dockRevealed = false;
function scheduleDockReveal() {
  if (dockRevealed) return;
  const myToken = ++dockRevealToken;
  nextSettledFrame().then(() => {
    if (myToken !== dockRevealToken || dockRevealed) return;
    dockRevealed = true;
    document.body.classList.add("dock-ready");
    refreshWheelLayout();
  });
}
window.addEventListener("resize", onRealResize(scheduleDockReveal));
window.addEventListener("orientationchange", scheduleDockReveal);
scheduleDockReveal();

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(redrawVisibleWheelCanvases).catch(() => {});
}

if (typeof ResizeObserver !== "undefined") {
  const debouncedRefreshWheelLayoutForObserver = typeof debounce === "function"
    ? debounce(refreshWheelLayout, 150)
    : refreshWheelLayout;
  const wheelLayoutObserver = new ResizeObserver(() => {
    debouncedRefreshWheelLayoutForObserver();
  });
  for (const sectionId of ["random-spin-section", "spin-section"]) {
    const section = document.getElementById(sectionId);
    const dock = section && section.querySelector(".spin-controls-dock");
    if (dock) wheelLayoutObserver.observe(dock);
  }
}
