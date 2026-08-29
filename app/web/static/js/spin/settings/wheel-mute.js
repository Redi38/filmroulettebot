// ---- wheel sound mute -------------------------------------------------------
const WHEEL_MUTED_KEY = "filmroulette_wheel_muted";
function loadWheelMuted() {
  return getLS(WHEEL_MUTED_KEY) === "1";
}
function saveWheelMuted(v) {
  setLS(WHEEL_MUTED_KEY, v ? "1" : "0");
}
let wheelMuted = loadWheelMuted();
function isWheelMuted() { return wheelMuted; }
function setWheelMuted(v) {
  wheelMuted = v;
  saveWheelMuted(v);
  renderControlOnAllDocks(renderWheelMuteToggle, "mute-toggle");
  if (v) closeSoundThemeMenus();
  renderControlOnAllDocks(renderSoundThemeToggle, "sound-theme-toggle");
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
  renderIconToggle(containerId, {
    containerClass: "wheel-mute-wrap",
    visible: spinMode === "wheel",
    active: wheelMuted,
    btnClass: "wheel-mute-btn",
    activeClass: "muted",
    iconOn: WHEEL_ICON_MUTED,
    iconOff: WHEEL_ICON_VOLUME,
    labelOn: "Включить звук колеса",
    labelOff: "Выключить звук колеса",
    onClick: toggleWheelMuted,
  });
}
