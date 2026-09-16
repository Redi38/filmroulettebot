// Barrel for the lazily-loaded roulette wheel chunk. Nothing outside
// spin/wheel/ imports the files below directly — everything goes through
// loadWheel() in loader.js — so esbuild's code splitting (see
// scripts/build-js.mjs) puts this whole directory, audio and confetti
// included, into one chunk fetched on demand instead of the main bundle.
export { syncSpinResultClearance } from "./viewport.js";
export {
  buildWheel,
  prepIdleWheelSkeleton,
  resetWheelWraps,
  showIdleWheel,
  updateWheelScrollLock,
} from "./wheel-build.js";
export { getWheelDPR, WHEEL_WRAP_IDS, wheelSpinState } from "./wheel-constants.js";
export { animateWheelWeights, drawWheel } from "./wheel-draw.js";
export { highlightWheelWinner, spinWheelTo } from "./spin.js";
export { primeWheelAudio } from "./wheel-audio.js";
export { fireWheelConfetti } from "./confetti.js";
