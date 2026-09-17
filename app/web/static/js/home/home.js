import { api } from "../core/api.js";
import { openPosterInfoModal } from "../core/modal.js";
import { debounce } from "../core/utils.js";
import { switchView } from "../core/views.js";

// Home screen ("Афиша"): a CSS-only running poster marquee built from the
// user's own lists, plus quick actions to jump into the roulette or a
// category list. Tapping a poster opens its full card info in a modal.

export let homeLoaded = false;
let homeLoading = false;

export async function loadHome() {
  if (homeLoading) return;
  const block = document.getElementById("home-collection-block");

  if (!homeLoaded) {
    homeLoading = true;
    try {
      const data = await api("/api/home/collection");
      renderHomeMarquee(data.posters || []);
      setHeroBackdrop(data.posters || []);
    } catch (e) {
      block.style.display = "none";
    } finally {
      homeLoading = false;
      homeLoaded = true;
    }
  } else {
    syncMarqueeSize();
  }
  resumeHomeMarquee();
}

let marqueeShownAt = 0;

function marqueeAnimationOf(track) {
  if (typeof track.getAnimations !== "function") return null;
  const running = track.getAnimations();
  return running.length ? running[0] : null;
}

export function pauseHomeMarquee() {
  if (!marqueeShownAt) return;
  const elapsed = performance.now() - marqueeShownAt;
  marqueeShownAt = 0;
  for (const track of document.querySelectorAll(".marquee-track")) {
    const anim = marqueeAnimationOf(track);
    track._marqueeTime = anim && typeof anim.currentTime === "number"
      ? anim.currentTime
      : (track._marqueeTime || 0) + elapsed;
  }
}

function seekMarqueeTrack(track) {
  const saved = track._marqueeTime || 0;
  if (!saved) return true;
  const anim = marqueeAnimationOf(track);
  if (anim) {
    try {
      anim.currentTime = saved;
      return true;
    } catch (e) {
      // fall through to the delay fallback
    }
  }
  const duration = parseFloat(getComputedStyle(track).animationDuration);
  if (!duration) return false;
  // Each row carries its own --marquee-duration, so the offset is taken
  // modulo that row's cycle rather than a shared one.
  track.style.animationDelay = `-${(saved / 1000) % duration}s`;
  return true;
}

export function resumeHomeMarquee() {
  if (marqueeShownAt) return;
  marqueeShownAt = performance.now();
  for (const track of document.querySelectorAll(".marquee-track")) {
    // The section may only have become visible this tick, in which case the
    // new animation does not exist yet — retry once on the next frame rather
    // than leaving the row stuck at the start.
    if (!seekMarqueeTrack(track)) requestAnimationFrame(() => seekMarqueeTrack(track));
  }
}

// Picks one poster from the collection at random as a blurred hero backdrop
// (css/home.css handles the blur/gradient via --hero-backdrop). Left unset
// if there's no collection yet, so the hero just shows its plain gradient.
function setHeroBackdrop(posters) {
  if (!posters.length) return;
  const hero = document.querySelector(".home-hero");
  if (!hero) return;
  const pick = posters[Math.floor(Math.random() * posters.length)];
  if (pick && pick.poster_url) hero.style.setProperty("--hero-backdrop", `url("${pick.poster_url}")`);
}

function renderHomeMarquee(posters) {
  const block = document.getElementById("home-collection-block");
  const track1 = document.getElementById("home-marquee-track-1");
  const track2 = document.getElementById("home-marquee-track-2");
  const row2 = document.getElementById("home-marquee-2");

  if (!posters.length) {
    block.style.display = "none";
    return;
  }

  const half = Math.ceil(posters.length / 2);
  const rowA = posters.slice(0, half);
  const rowB = posters.slice(half);

  fillMarqueeTrack(track1, rowA.length ? rowA : posters);
  if (rowB.length) {
    row2.style.display = "";
    fillMarqueeTrack(track2, rowB);
  } else {
    row2.style.display = "none";
  }

  block.style.display = "";
  syncMarqueeSize();
}

export function syncMarqueeSize() {
  const block = document.getElementById("home-collection-block");
  const section = document.getElementById("home-section");
  if (!block || !section || !section.classList.contains("active") || block.style.display === "none") return;

  const heroWrap = section.querySelector(".home-content-wrap");
  const label = block.querySelector(".home-collection-label");
  const row2 = document.getElementById("home-marquee-2");
  if (!heroWrap || !label) return;

  document.documentElement.style.removeProperty("--marquee-poster-h");
  document.documentElement.style.removeProperty("--marquee-poster-w");

  const mainEl = section.closest("main");
  const mainBottomPadding = mainEl ? parseFloat(getComputedStyle(mainEl).paddingBottom) || 0 : 0;
  const blockStyles = getComputedStyle(block);
  const blockMarginBottom = parseFloat(blockStyles.marginBottom) || 0;
  const lastRow = row2 && row2.style.display !== "none" ? row2 : document.getElementById("home-marquee");
  const lastRowMarginBottom = lastRow ? parseFloat(getComputedStyle(lastRow).marginBottom) || 0 : 0;

  const heroRect = heroWrap.getBoundingClientRect();
  const labelRect = label.getBoundingClientRect();
  const rowCount = row2 && row2.style.display !== "none" ? 2 : 1;
  const rowGap = 10;
  const safetyMargin = 28;
  const trailingChrome = mainBottomPadding + blockMarginBottom + lastRowMarginBottom + safetyMargin;

  const availableForRows = window.innerHeight - heroRect.bottom - labelRect.height
    - (rowCount - 1) * rowGap - trailingChrome;
  let posterH = Math.floor(availableForRows / rowCount);
  posterH = Math.max(110, Math.min(360, posterH));
  const posterW = Math.round(posterH * (140 / 210));

  document.documentElement.style.setProperty("--marquee-poster-h", posterH + "px");
  document.documentElement.style.setProperty("--marquee-poster-w", posterW + "px");
}

const debouncedSyncMarqueeSize = typeof debounce === "function"
  ? debounce(syncMarqueeSize, 120)
  : syncMarqueeSize;

let lastMarqueeViewportWidth = window.innerWidth;
function handleMarqueeViewportResize() {
  if (window.innerWidth === lastMarqueeViewportWidth) return;
  lastMarqueeViewportWidth = window.innerWidth;
  debouncedSyncMarqueeSize();
}
window.addEventListener("resize", handleMarqueeViewportResize);
window.addEventListener("orientationchange", () => {
  lastMarqueeViewportWidth = window.innerWidth;
  debouncedSyncMarqueeSize();
});

// Backgrounding the browser tab (not just switching in-app views) leaves
// #home-section visible/active — nothing calls pauseHomeMarquee/
// resumeHomeMarquee for that case, so the animation timeline keeps
// ticking on real wall-clock time while the tab is hidden. Most browsers
// stop actually rendering frames while hidden but don't freeze that
// timeline, so the moment the tab is shown again the marquee snaps
// forward to wherever the elapsed real time says it should be — the
// jerk. Route tab visibility through the same currentTime-based
// pause/resume the in-app view switch already uses, so it looks
// stopped the whole time instead of catching up in one jump.
document.addEventListener("visibilitychange", () => {
  const section = document.getElementById("home-section");
  if (!homeLoaded || !section || !section.classList.contains("active")) return;
  if (document.hidden) pauseHomeMarquee();
  else resumeHomeMarquee();
});

function fillMarqueeTrack(track, posters) {
  const frag = document.createDocumentFragment();
  for (const item of [...posters, ...posters]) {
    const wrap = document.createElement("div");
    wrap.className = "marquee-poster-item";

    const img = document.createElement("img");
    img.className = "marquee-poster";
    img.src = item.poster_url;
    img.alt = item.title || "";
    img.draggable = false;
    img.onclick = () => openPosterInfoModal(item.category, item.original_title || item.title);
    wrap.appendChild(img);

    frag.appendChild(wrap);
  }
  track.innerHTML = "";
  track.appendChild(frag);

  const seconds = Math.max(18, posters.length * 4.5);
  track.style.setProperty("--marquee-duration", `${seconds}s`);
}

document.getElementById("home-roulette-btn").onclick = () => switchView("spin");
