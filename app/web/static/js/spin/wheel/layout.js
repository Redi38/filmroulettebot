// Roulette wheel: sizing constants and pure layout math (no DOM mutation).

const WHEEL_MIN_SIZE = 260;
const WHEEL_MAX_SIZE = 1100;
const WHEEL_VERTICAL_RESERVE = 70;

function fontsSettled() {
  const fontsReady = (document.fonts && document.fonts.ready)
    ? document.fonts.ready
    : Promise.resolve();
  return Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, 800))]);
}

function nextSettledFrame() {
  return fontsSettled().then(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

function computeWheelSize(availableWidth, availableHeight) {
  return Math.min(
    Math.max(Math.min(availableWidth, availableHeight - WHEEL_VERTICAL_RESERVE) - 4, WHEEL_MIN_SIZE),
    WHEEL_MAX_SIZE
  );
}

function getWheelBottomGap(wrap) {
  const mainEl = wrap.closest("main");
  const paddingBottom = mainEl ? parseFloat(getComputedStyle(mainEl).paddingBottom) || 0 : 0;
  return Math.max(16, paddingBottom);
}

function computeDockClearance(wrap, dock) {
  if (!dock) return 0;
  const dockPos = getComputedStyle(dock).position;
  if (dockPos !== "absolute" && dockPos !== "fixed") return 0;
  const dockRect = dock.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const wrapTop = wrapRect.top - (parseFloat(wrap.style.paddingTop) || 0);
  if (dockRect.bottom <= wrapTop) return 0;
  const availableWidth = wrap.clientWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const provisionalHeight = viewportHeight - wrapTop - getWheelBottomGap(wrap);
  const provisionalSize = computeWheelSize(availableWidth, provisionalHeight);
  const contentCenterX = wrapRect.left + wrapRect.width / 2;
  const contentRight = contentCenterX + provisionalSize / 2;
  if (contentRight <= dockRect.left) return 0;
  return Math.max(0, Math.ceil(dockRect.bottom - wrapTop) + 14);
}

function predictWheelSize(wrap) {
  const dock = getDockFor(wrap);
  const dockClearance = computeDockClearance(wrap, dock);
  const top = wrap.getBoundingClientRect().top - (parseFloat(wrap.style.paddingTop) || 0);
  const pageBottomGap = getWheelBottomGap(wrap);
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const availableHeight = viewportHeight - top - pageBottomGap - dockClearance;
  const availableWidth = wrap.clientWidth;
  return computeWheelSize(availableWidth, availableHeight);
}
