const DUST_MOTE_COUNT = 20;
const SEASON_MOTE_COUNT = 36; // New Year: snow + gold sparkles, see css/newyear.css
const DUST_MIN_SIZE = 5;
const DUST_MAX_SIZE = 12;
const DUST_MIN_DURATION = 13;
const DUST_MAX_DURATION = 25;

(() => {
  const container = document.getElementById("bg-dust");
  if (!container) return;
  const festive = document.documentElement.dataset.season === "newyear";
  const count = festive ? SEASON_MOTE_COUNT : DUST_MOTE_COUNT;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const size = DUST_MIN_SIZE + Math.random() * (DUST_MAX_SIZE - DUST_MIN_SIZE);
    const duration = DUST_MIN_DURATION + Math.random() * (DUST_MAX_DURATION - DUST_MIN_DURATION);
    const mote = document.createElement("span");
    mote.className = festive && i % 6 === 0 ? "dust-mote sparkle" : "dust-mote";
    mote.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    mote.style.width = `${size.toFixed(1)}px`;
    mote.style.height = `${size.toFixed(1)}px`;
    mote.style.animationDuration = `${duration.toFixed(1)}s`;
    mote.style.animationDelay = `-${(Math.random() * duration).toFixed(1)}s`;
    frag.appendChild(mote);
  }
  container.appendChild(frag);
})();
