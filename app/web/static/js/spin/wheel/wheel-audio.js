import { getWheelSoundTheme } from "../settings/sound-theme.js";
import { isWheelMuted } from "../settings/wheel-mute.js";

// Wheel roulette: tiny synthesized audio "tick" per segment crossed

let _wheelAudioCtx = null;

export function primeWheelAudio() {
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

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && _wheelAudioCtx && _wheelAudioCtx.state === "suspended") {
    _wheelAudioCtx.resume().catch(() => {});
  }
});

function _playWheelBlip(freq, durationMs, gainPeak, delayMs, type) {
  if (isWheelMuted()) return;
  const ctx = _wheelAudioCtx;
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
    return;
  }
  if (ctx.state !== "running") return;
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
  const key = getWheelSoundTheme() || "classic";
  return WHEEL_SOUND_THEMES[key] || WHEEL_SOUND_THEMES.classic;
}

let _lastWheelTickAt = 0;
const WHEEL_TICK_MIN_INTERVAL_MS = 28;

export function playWheelTick() {
  const now = performance.now();
  if (now - _lastWheelTickAt < WHEEL_TICK_MIN_INTERVAL_MS) return;
  _lastWheelTickAt = now;
  const t = _currentSoundTheme().tick;
  _playWheelBlip(t.freq, t.duration, t.gain, 0, t.type);
}

export function playWheelStop() {
  const theme = _currentSoundTheme();
  for (const blip of theme.stop) {
    _playWheelBlip(blip.freq, blip.duration, blip.gain, blip.delay, blip.type);
  }
  if (navigator.vibrate) navigator.vibrate(theme.vibrate);
}

// ---- Break / repair effects --------------------------------------------
// Same rules as the ticks: synthesized, silent when the wheel is muted.

function _wheelAudioReady() {
  if (isWheelMuted()) return null;
  const ctx = _wheelAudioCtx;
  if (!ctx) return null;
  if (ctx.state === "suspended") { ctx.resume().catch(() => {}); return null; }
  return ctx.state === "running" ? ctx : null;
}

// Filtered white-noise burst: cracks, tape rips, the rattle of a nail.
function _playWheelNoise(durationMs, gainPeak, delayMs, hp, lp) {
  const ctx = _wheelAudioReady();
  if (!ctx) return;
  const len = Math.max(1, Math.round(ctx.sampleRate * durationMs / 1000));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hpf = ctx.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = hp;
  const lpf = ctx.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = lp;
  const gain = ctx.createGain();
  const start = ctx.currentTime + delayMs / 1000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  src.connect(hpf).connect(lpf).connect(gain).connect(ctx.destination);
  src.start(start);
}

// A pitch glide: the "sad trombone" after the crack, the hammer's thud.
function _playWheelSweep(f0, f1, durationMs, gainPeak, delayMs, type) {
  const ctx = _wheelAudioReady();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  const start = ctx.currentTime + delayMs / 1000;
  const end = start + durationMs / 1000;
  osc.frequency.setValueAtTime(f0, start);
  osc.frequency.exponentialRampToValueAtTime(f1, end);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.03);
}

const WHEEL_SFX = {
  creak: () => _playWheelSweep(120, 72, 140, 0.035, 0, "sawtooth"),
  crack: () => {
    _playWheelNoise(180, 0.28, 0, 700, 9000);
    _playWheelSweep(160, 45, 320, 0.3, 0, "sine");
    _playWheelSweep(440, 130, 800, 0.07, 500, "triangle");
    if (navigator.vibrate) navigator.vibrate([30, 40, 70]);
  },
  clack: () => _playWheelBlip(900, 30, 0.05, 0, "square"),
  hammer: () => {
    _playWheelSweep(240, 70, 110, 0.28, 0, "sine");
    _playWheelNoise(45, 0.1, 0, 2200, 9000);
  },
  tape: () => _playWheelNoise(340, 0.1, 0, 1400, 7000),
  fixed: () => {
    _playWheelBlip(660, 110, 0.12, 0, "triangle");
    _playWheelBlip(880, 220, 0.12, 110, "triangle");
  },
};

export function playWheelSfx(name) {
  const fn = WHEEL_SFX[name];
  if (fn) fn();
}
