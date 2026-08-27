// Roulette wheel: a soft tick sound as the pointer crosses each segment

let _wheelAudioCtx = null;

const WHEEL_MUTED_KEY = "filmroulette_wheel_muted";
function loadWheelMuted() {
  try { return localStorage.getItem(WHEEL_MUTED_KEY) === "1"; } catch { return false; }
}
function saveWheelMuted(v) {
  try { localStorage.setItem(WHEEL_MUTED_KEY, v ? "1" : "0"); } catch {}
}
let wheelMuted = loadWheelMuted();

function isWheelMuted() { return wheelMuted; }

function setWheelMuted(v) {
  wheelMuted = v;
  saveWheelMuted(v);
  renderWheelMuteToggle("random-mute-toggle");
  renderWheelMuteToggle("spin-mute-toggle");
}

function toggleWheelMuted() { setWheelMuted(!wheelMuted); }

const WHEEL_ICON_VOLUME =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>' +
  '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>' +
  '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>' +
  "</svg>";
const WHEEL_ICON_MUTED =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>' +
  '<line x1="23" y1="9" x2="17" y2="15"></line>' +
  '<line x1="17" y1="9" x2="23" y2="15"></line>' +
  "</svg>";

function renderWheelMuteToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "wheel-mute-wrap" + (typeof spinMode !== "undefined" && spinMode === "wheel" ? " visible" : "");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wheel-mute-btn" + (wheelMuted ? " muted" : "");
  btn.setAttribute("aria-label", wheelMuted ? "Включить звук колеса" : "Выключить звук колеса");
  btn.title = wheelMuted ? "Включить звук колеса" : "Выключить звук колеса";
  btn.innerHTML = wheelMuted ? WHEEL_ICON_MUTED : WHEEL_ICON_VOLUME;
  btn.onclick = toggleWheelMuted;
  el.appendChild(btn);
}

function _getWheelAudioCtx() {
  if (_wheelAudioCtx) return _wheelAudioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  _wheelAudioCtx = new Ctx();
  return _wheelAudioCtx;
}

function primeWheelAudio() {
  const ctx = _getWheelAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

function _playWheelBlip(freq, durationMs, gainPeak, delayMs, type) {
  if (wheelMuted) return;
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
const WHEEL_TICK_MIN_INTERVAL_MS = 28;

function playWheelTick() {
  const now = performance.now();
  if (now - _lastWheelTickAt < WHEEL_TICK_MIN_INTERVAL_MS) return;
  _lastWheelTickAt = now;
  _playWheelBlip(1500, 20, 0.05, 0, "square");
}

function playWheelStop() {
  _playWheelBlip(150, 280, 0.2, 0, "sine");
  _playWheelBlip(1100, 240, 0.12, 0, "triangle");
  _playWheelBlip(750, 260, 0.08, 100, "triangle");
  if (navigator.vibrate) navigator.vibrate([16, 45, 22]);
}
