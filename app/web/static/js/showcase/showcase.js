// Studio showcase (Marvel/DC catalog browsing) and the user's own
// tracked-series list. Filter helpers live in filters.js, and
// row/group rendering (shared with theaters.js) lives in row.js.

let currentShowcaseStudio = null;
let lastShowcaseData = null;
let lastShowcaseLoadedAt = 0;

function prepShowcaseSkeletonIfStale() {
  if (currentCat === currentShowcaseStudio) return;
  const container = document.getElementById("showcase-container");
  if (!container) return;
  container.style.opacity = "1";
  container.innerHTML = skeletonShowcaseHtml();
}

// `fromNav` is only true when showSection() calls this on a plain tab
// switch (see VIEW_LOADERS in views.js) — filter changes and other direct
// callers always pass nothing, so they always fetch.
async function loadShowcase(fromNav) {
  const cat = currentCat;
  const container = document.getElementById("showcase-container");
  const isFreshView = currentShowcaseStudio !== cat;
  if (fromNav && !isFreshView && lastShowcaseData && Date.now() - lastShowcaseLoadedAt < TAB_REVISIT_STALE_MS) {
    return;
  }
  currentShowcaseStudio = cat;
  if (isFreshView) {
    container.style.opacity = "1";
    container.innerHTML = skeletonShowcaseHtml();
  }
  const dataPromise = api(`/api/showcase/${cat}`);
  const fadeOutPromise = isFreshView ? Promise.resolve() : fadeOut(container);
  try {
    const [data] = await Promise.all([dataPromise, fadeOutPromise]);
    lastShowcaseData = data;
    lastShowcaseLoadedAt = Date.now();
    renderShowcaseFilters();
    renderShowcaseContent(true);
  } catch (e) {
    lastShowcaseData = null;
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}

async function renderShowcaseContent(alreadyFadedOut) {
  const container = document.getElementById("showcase-container");
  const data = lastShowcaseData;
  if (!data) return;

  const upcoming = data.upcoming.filter(m => showcaseTypeMatches(m) && showcaseAddedMatches(m));
  const released = data.released.filter(m => showcaseTypeMatches(m) && showcaseAddedMatches(m));
  const newSeasons = (data.new_seasons || []).filter(m => showcaseTypeMatches(m) && showcaseAddedMatches(m));

  // A filter-change call (see filters.js) has to fade the container itself,
  // since nothing else is in flight to run the fade alongside — only skip
  // it when loadShowcase() already faded the container out for us above.
  if (!alreadyFadedOut) await fadeOut(container);
  container.innerHTML = "";

  if (!data.upcoming.length && !data.released.length && !(data.new_seasons || []).length) {
    container.innerHTML = placeholderHtml("Пока нет данных о новых релизах — загляни попозже", "🎬");
    fadeIn(container);
    return;
  }
  if (!upcoming.length && !released.length && !newSeasons.length) {
    container.innerHTML = placeholderHtml("Ничего не подходит под выбранные фильтры", "🔍");
    fadeIn(container);
    return;
  }

  if (newSeasons.length) {
    container.appendChild(showcaseGroup("🔔 Новые сезоны", newSeasons, currentCat, true));
  }
  container.appendChild(showcaseGroup("⏳ Скоро выйдет", upcoming, currentCat));
  container.appendChild(showcaseGroup("✅ Уже вышло", released, currentCat));
  fadeIn(container);
}

function renderShowcaseFilters() {
  let panel = document.getElementById("showcase-filters");
  const isNewPanel = !panel;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "showcase-filters";
    const section = document.getElementById("showcase-section");
    section.insertBefore(panel, document.getElementById("showcase-container"));
  }
  if (isNewPanel || currentShowcaseStudio !== panel.dataset.studio) {
    panel.dataset.studio = currentShowcaseStudio;
    panel.classList.remove("fade-in");
    void panel.offsetWidth;
    panel.classList.add("fade-in");
  }

  showcaseFilterGroup(panel, "Тип", [
    ["all", "Все"], ["movie", "Фильмы"], ["series", "Сериалы"],
  ], "type");
  showcaseFilterGroup(panel, "Показывать", [
    ["all", "Все"], ["hide", "Не добавленные"], ["only", "Уже добавленные"],
  ], "added");
}

let trackedSeriesLoaded = false;
let trackedSeriesLoadedAt = 0;

async function loadTrackedSeries(fromNav) {
  const container = document.getElementById("tracked-series-container");
  if (fromNav && trackedSeriesLoaded && Date.now() - trackedSeriesLoadedAt < TAB_REVISIT_STALE_MS) {
    return;
  }
  const isFreshView = !trackedSeriesLoaded;
  if (isFreshView) {
    container.style.opacity = "1";
    container.innerHTML = skeletonShowcaseHtml();
  }
  const dataPromise = api(`/api/tracked-series`);
  // See loadShowcase() above: skip the fade on a fresh view, or the
  // skeleton just inserted gets faded to 0 before it's ever painted.
  const fadeOutPromise = isFreshView ? Promise.resolve() : fadeOut(container);
  try {
    const [data] = await Promise.all([dataPromise, fadeOutPromise]);
    trackedSeriesLoaded = true;
    trackedSeriesLoadedAt = Date.now();
    container.innerHTML = "";
    const items = data.items || [];
    if (!items.length) {
      container.innerHTML = placeholderHtml(
        "Пока ничего не отслеживается — добавь сериал выше, и здесь появится дата следующего сезона 🔔", "🔔"
      );
      fadeIn(container);
      return;
    }
    container.appendChild(showcaseGroup("🔔 Отслеживаемые сериалы", items, "series", false, "tracked-series"));
    fadeIn(container);
  } catch (e) {
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}

document.getElementById("tracked-series-add-btn").onclick = async () => {
  const input = document.getElementById("tracked-series-add-input");
  const title = input.value.trim();
  if (!title) return;
  const doAdd = async (finalTitle) => {
    try {
      await api("/api/tracked-series/add", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: finalTitle}),
      });
      input.value = "";
      loadTrackedSeries();
    } catch (e) { showToast(e.message); }
  };
  openAddSearchModal("/api/tracked-series/search-suggest", title, {
    onPick: doAdd,
    onFallback: () => doAdd(title),
  });
};
document.getElementById("tracked-series-add-input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") document.getElementById("tracked-series-add-btn").click();
});
