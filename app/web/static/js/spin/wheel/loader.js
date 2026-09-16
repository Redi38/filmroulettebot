// Lazy entry point for the roulette wheel: canvas build/draw, spin
// animation, audio cues and the confetti burst (spin/wheel/*, including
// wheel-audio.js and confetti.js) are only needed once someone actually
// reaches the wheel, so none of it is imported statically from outside
// this directory. Every call site imports loadWheel() instead of the
// individual wheel/*.js files directly — see index.js for the barrel that
// the import() below pulls in. The promise is cached, so the dynamic
// import only ever hits the network once per page load.
let wheelModulePromise = null;

export function loadWheel() {
  if (!wheelModulePromise) wheelModulePromise = import("./index.js");
  return wheelModulePromise;
}
