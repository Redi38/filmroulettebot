// Roulette wheel: a soft tick sound as the pointer crosses each segment
// boundary while spinning, plus a distinct "stop" sound + short vibration
// (mobile only, navigator.vibrate is a no-op where unsupported) when the
// wheel comes to rest. Pure Web Audio (short synthesized blips) so this
// ships with zero extra audio-file assets.

let _wheelAudioCtx = null;

function _getWheelAudioCtx() {
  if (_wheelAudioCtx) return _wheelAudioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  _wheelAudioCtx = new Ctx();
  return _wheelAudioCtx;
}

// Call synchronously from the click handler that starts a spin — browsers
// only allow creating/resuming an AudioContext as a direct result of a user
// gesture, so this can't be deferred into the animation loop later on.
function primeWheelAudio() {
  const ctx = _getWheelAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

function _playWheelBlip(freq, durationMs, gainPeak, delayMs, type) {
  const ctx = _wheelAudioCtx;
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || "square";
  osc.frequency.value = freq;
  const start = ctx.currentTime + (delayMs || 0) / 1000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.03);
}

let _lastWheelTickAt = 0;
// A fast-spinning wheel with many thin segments can cross several
// boundaries per animation frame; without a floor here that turns into an
// unpleasant buzz instead of a click, and can bury the audio pipeline.
const WHEEL_TICK_MIN_INTERVAL_MS = 28;

function playWheelTick() {
  const now = performance.now();
  if (now - _lastWheelTickAt < WHEEL_TICK_MIN_INTERVAL_MS) return;
  _lastWheelTickAt = now;
  _playWheelBlip(1500, 20, 0.05, 0, "square");
}

function playWheelStop() {
  // Layered "landing" cue so it reads as a distinct event, not just another
  // (longer) tick: a low thud + a bright chime together, then a soft echo.
  _playWheelBlip(150, 280, 0.2, 0, "sine");
  _playWheelBlip(1100, 240, 0.12, 0, "triangle");
  _playWheelBlip(750, 260, 0.08, 100, "triangle");
  if (navigator.vibrate) navigator.vibrate([16, 45, 22]);
}
