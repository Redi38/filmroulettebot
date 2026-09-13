// Roulette wheel: shared constants and small getters used by both
// wheel-build.js (DOM construction) and wheel-draw.js (canvas rendering).

let wheelSpinActive = false;

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || "").trim());
  if (!m) return [36, 88, 59]; // falls back to the default theme's orange
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// [hue, saturation%, lightness%] for each of the original 16 hand-picked
// wheel colors, e.g. WHEEL_COLOR_HSL[0] is #8b7cf6.
const WHEEL_COLOR_HSL = [
  [247.4, 87.1, 72.5], [219.7, 82.2, 64.7], [158.1, 64.4, 51.6], [352.9, 85.5, 64.9],
  [44.7, 90.8, 61.8], [316.1, 77.8, 71.8], [171.6, 70.8, 62.4], [23.5, 89.7, 65.9],
  [255.1, 91.7, 76.3], [202.5, 91.3, 63.9], [137.4, 66.1, 64.1], [348.4, 85.4, 70.4],
  [42.0, 100.0, 70.0], [286.6, 79.5, 71.4], [175.4, 62.4, 55.1], [21.9, 100.0, 70.4],
];
const WHEEL_PALETTE_REFERENCE_HUE = 36.07;

// Cached per --primary value so repeated draws (every animation frame while
// the weighted-mode transition or a resize is in flight) don't re-parse the
// custom property and rebuild the palette on every frame.
let _wheelColorsCache = null;
let _wheelColorsCacheKey = "";

function getWheelColors() {
  const primaryHex = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  if (_wheelColorsCache && _wheelColorsCacheKey === primaryHex) return _wheelColorsCache;

  const [baseHue] = hexToHsl(primaryHex);
  const hueShift = baseHue - WHEEL_PALETTE_REFERENCE_HUE;
  const colors = WHEEL_COLOR_HSL.map(([h, s, l]) => hslToHex((h + hueShift + 360) % 360, s, l));
  _wheelColorsCache = colors;
  _wheelColorsCacheKey = primaryHex;
  return colors;
}

const WHEEL_HUB_GIF_URL = "";
const WHEEL_WRAP_IDS = ["random-wheel-wrap", "spin-wheel-wrap"];

function getWheelStyle() {
  return typeof getWheelAppearance === "function" ? getWheelAppearance() : "classic";
}

function getWheelDPR() {
  const raw = window.devicePixelRatio || 1;
  return Math.min(3, Math.max(2, raw));
}
