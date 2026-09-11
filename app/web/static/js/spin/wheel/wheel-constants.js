// Roulette wheel: shared constants and small getters used by both
// wheel-build.js (DOM construction) and wheel-draw.js (canvas rendering).

let wheelSpinActive = false;

const WHEEL_COLORS = [
  "#8b7cf6", "#5b8def", "#34d399", "#f2596b",
  "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a",
  "#a78bfa", "#4fb8f7", "#67e08a", "#f4738c",
  "#ffd166", "#d67cf0", "#45d4c9", "#ff9f68"
];
const WHEEL_HUB_GIF_URL = "";
const WHEEL_WRAP_IDS = ["random-wheel-wrap", "spin-wheel-wrap"];

function getWheelStyle() {
  return typeof getWheelAppearance === "function" ? getWheelAppearance() : "classic";
}

function getWheelDPR() {
  const raw = window.devicePixelRatio || 1;
  return Math.min(3, Math.max(2, raw));
}
