// Wheel roulette: tiny synthesized audio "tick" per segment crossed

let _wheelAudioCtx = null;

function primeWheelAudio() {
  try {
    if (!_wheelAudioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      _wheelAudioCtx = new Ctx();
    }
    if (_wheelAudioCtx.state === "suspended") {
      _wheelAudioCtx.resume();
    }
  } catch {}
}

function _playWheelBlip(freq, durationMs, gainPeak, delayMs, type) {
  if (typeof isWheelMuted === "function" && isWheelMuted()) return;
  const ctx = _wheelAudioCtx;
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = ctx.currentTime + delayMs / 1000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.03);
}

const WHEEL_SOUND_THEMES = {
  classic: {
    tick: { freq: 1500, duration: 20, gain: 0.05, type: "square" },
    stop: [
      { freq: 150, duration: 280, gain: 0.2, delay: 0, type: "sine" },
      { freq: 1100, duration: 240, gain: 0.12, delay: 0, type: "triangle" },
      { freq: 750, duration: 260, gain: 0.08, delay: 100, type: "triangle" },
    ],
    vibrate: [16, 45, 22],
  },
  arcade: {
    tick: { freq: 2200, duration: 16, gain: 0.06, type: "square" },
    stop: [
      { freq: 523, duration: 90, gain: 0.15, delay: 0, type: "square" },
      { freq: 659, duration: 90, gain: 0.15, delay: 90, type: "square" },
      { freq: 784, duration: 180, gain: 0.16, delay: 180, type: "square" },
    ],
    vibrate: [12, 30, 12, 30, 24],
  },
  quiet: {
    tick: { freq: 900, duration: 14, gain: 0.02, type: "sine" },
    stop: [
      { freq: 500, duration: 200, gain: 0.06, delay: 0, type: "sine" },
    ],
    vibrate: [10],
  },
};

function _currentSoundTheme() {
  const key = (typeof getWheelSoundTheme === "function" && getWheelSoundTheme()) || "classic";
  return WHEEL_SOUND_THEMES[key] || WHEEL_SOUND_THEMES.classic;
}

let _lastWheelTickAt = 0;
const WHEEL_TICK_MIN_INTERVAL_MS = 28;

function playWheelTick() {
  const now = performance.now();
  if (now - _lastWheelTickAt < WHEEL_TICK_MIN_INTERVAL_MS) return;
  _lastWheelTickAt = now;
  const t = _currentSoundTheme().tick;
  _playWheelBlip(t.freq, t.duration, t.gain, 0, t.type);
}

function playWheelStop() {
  const theme = _currentSoundTheme();
  for (const blip of theme.stop) {
    _playWheelBlip(blip.freq, blip.duration, blip.gain, blip.delay, blip.type);
  }
  if (navigator.vibrate) navigator.vibrate(theme.vibrate);
}
