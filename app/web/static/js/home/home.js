// Home screen ("Афиша"): a CSS-only running poster marquee built from the
// user's own lists (pure teaser, no click interactions), plus quick actions
// to jump into the roulette or a category list.

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
}

function fillMarqueeTrack(track, posters) {
  const frag = document.createDocumentFragment();
  for (const item of [...posters, ...posters]) {
    const img = document.createElement("img");
    img.className = "marquee-poster";
    img.src = item.poster_url;
    img.alt = item.title || "";
    img.loading = "lazy";
    img.draggable = false;
    frag.appendChild(img);
  }
  track.innerHTML = "";
  track.appendChild(frag);

  const seconds = Math.max(18, posters.length * 4.5);
  track.style.setProperty("--marquee-duration", `${seconds}s`);
}

document.getElementById("home-roulette-btn").onclick = () => switchView("random");
