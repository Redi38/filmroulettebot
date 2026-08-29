// Home screen ("Афиша"): a CSS-only running poster marquee built from the
// user's own lists, plus quick actions to jump into the roulette or a
// category list. Tapping a poster opens its full card info in a modal.

let homeLoaded = false;
let homeLoading = false;

async function loadHome() {
  if (homeLoading) return;
  const block = document.getElementById("home-collection-block");

  if (!homeLoaded) {
    homeLoading = true;
    try {
      const data = await api("/api/home/collection");
      renderHomeMarquee(data.posters || []);
    } catch (e) {
      block.style.display = "none";
    } finally {
      homeLoading = false;
      homeLoaded = true;
    }
  } else {
    syncMarqueeSize();
  }
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

function syncMarqueeSize() {
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

function fillMarqueeTrack(track, posters) {
  const frag = document.createDocumentFragment();
  for (const item of [...posters, ...posters]) {
    const img = document.createElement("img");
    img.className = "marquee-poster";
    img.src = item.poster_url;
    img.alt = item.title || "";
    img.draggable = false;
    img.title = item.title || "";
    img.onclick = () => openPosterInfoModal(item.category, item.original_title || item.title);
    frag.appendChild(img);
  }
  track.innerHTML = "";
  track.appendChild(frag);

  const seconds = Math.max(18, posters.length * 4.5);
  track.style.setProperty("--marquee-duration", `${seconds}s`);
}

document.getElementById("home-roulette-btn").onclick = () => switchView("random");
