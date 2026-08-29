// "Афиша" (global now-playing/upcoming theatrical) and "Премьеры сериалов"
// (global series releases) tabs — both are TMDb discovery data with their
// own pagination and skip-list, rendered via showcaseGroup/showcaseRow.

let theatersLoaded = false;
let theatersNowPlayingPage = 1;
let theatersUpcomingPage = 1;
const THEATERS_FILTER_KEY = "filmroulette_theaters_filter";
let theatersAddedFilter = loadSimpleAddedFilter(THEATERS_FILTER_KEY);

let theatersHideLocalOnly = null;

function appendGlobalOnlyToggle(row) {
  const btn = document.createElement("button");
  btn.className = "showcase-filter-btn" + (theatersHideLocalOnly ? " active" : "");
  btn.textContent = "Только мировой прокат";
  btn.disabled = theatersHideLocalOnly === null;
  btn.onclick = async () => {
    const next = !theatersHideLocalOnly;
    theatersHideLocalOnly = next;
    renderTheatersFilters();
    try {
      await api("/api/settings/hide_local_only_afisha", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ value: next }),
      });
    } catch (e) {
      theatersHideLocalOnly = !next;
      renderTheatersFilters();
      return;
    }
    theatersNowPlayingPage = 1;
    theatersUpcomingPage = 1;
    loadTheaters();
  };
  row.appendChild(btn);
}

async function ensureTheatersSettingsLoaded() {
  if (theatersHideLocalOnly !== null) return;
  try {
    const data = await api("/api/settings");
    theatersHideLocalOnly = !!(data.hide_local_only_afisha === "1");
  } catch (e) {
    theatersHideLocalOnly = false;
  }
  renderTheatersFilters();
}

function renderTheatersFilters() {
  const panel = ensureFilterPanel("theaters-filters", "theaters-section", "theaters-container");
  const addedGroup = simpleAddedFilterGroup(THEATERS_FILTER_KEY, theatersAddedFilter, (value) => {
    theatersAddedFilter = value;
    theatersNowPlayingPage = 1;
    theatersUpcomingPage = 1;
    renderTheatersFilters();
    loadTheaters();
  });
  appendGlobalOnlyToggle(addedGroup.querySelector(".showcase-filter-options"));
  panel.appendChild(addedGroup);
  if (theatersHideLocalOnly === null) ensureTheatersSettingsLoaded();
}

async function loadTheaters() {
  const container = document.getElementById("theaters-container");
  renderTheatersFilters();
  if (!theatersLoaded) {
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api(`/api/theaters?now_playing_page=${theatersNowPlayingPage}&upcoming_page=${theatersUpcomingPage}&added=${theatersAddedFilter}`);
    await fadeOut(container);
    theatersLoaded = true;
    container.innerHTML = "";
    if (!data.now_playing.length && !data.upcoming.length
        && data.now_playing_total_pages <= 1 && data.upcoming_total_pages <= 1) {
      container.innerHTML = placeholderHtml(
        theatersAddedFilter === "all" ? "Пока нет данных о прокате — загляни попозже" : "Ничего не подходит под выбранный фильтр",
        theatersAddedFilter === "all" ? "🎬" : "🔍"
      );
      fadeIn(container);
      return;
    }
    const colNow = document.createElement("div");
    colNow.className = "theaters-col";
    colNow.appendChild(showcaseGroup(
      "🎬 Сейчас в прокате / вышло", data.now_playing, "movies", false, "now-playing",
      "theaters_now_playing", loadTheaters,
    ));
    if (data.now_playing_total_pages > 1) {
      colNow.appendChild(paginationRow(data.now_playing_page, data.now_playing_total_pages, (p) => {
        theatersNowPlayingPage = p;
        loadTheaters();
      }));
    }
    container.appendChild(colNow);

    const colUpcoming = document.createElement("div");
    colUpcoming.className = "theaters-col";
    colUpcoming.appendChild(showcaseGroup(
      "⏳ Скоро в кино", data.upcoming, "movies", false, "upcoming",
      "theaters_upcoming", loadTheaters,
    ));
    if (data.upcoming_total_pages > 1) {
      colUpcoming.appendChild(paginationRow(data.upcoming_page, data.upcoming_total_pages, (p) => {
        theatersUpcomingPage = p;
        loadTheaters();
      }));
    }
    container.appendChild(colUpcoming);
    fadeIn(container);
  } catch (e) {
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}

let seriesReleasesLoaded = false;
let seriesReleasesPage = 1;
const SERIES_RELEASES_FILTER_KEY = "filmroulette_series_releases_filter";
let seriesReleasesAddedFilter = loadSimpleAddedFilter(SERIES_RELEASES_FILTER_KEY);

function renderSeriesReleasesFilters() {
  const panel = ensureFilterPanel("series-releases-filters", "series-releases-section", "series-releases-container");
  panel.appendChild(simpleAddedFilterGroup(SERIES_RELEASES_FILTER_KEY, seriesReleasesAddedFilter, (value) => {
    seriesReleasesAddedFilter = value;
    seriesReleasesPage = 1;
    renderSeriesReleasesFilters();
    loadSeriesReleases();
  }));
}

async function loadSeriesReleases() {
  const container = document.getElementById("series-releases-container");
  renderSeriesReleasesFilters();
  if (!seriesReleasesLoaded) {
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api(`/api/series-releases?page=${seriesReleasesPage}&added=${seriesReleasesAddedFilter}`);
    await fadeOut(container);
    seriesReleasesLoaded = true;
    container.innerHTML = "";
    const releases = data.releases || [];
    if (!releases.length && data.total_pages <= 1) {
      container.innerHTML = placeholderHtml(
        seriesReleasesAddedFilter === "all" ? "Пока нет анонсированных премьер с рейтингом 7+ — загляни попозже" : "Ничего не подходит под выбранный фильтр",
        seriesReleasesAddedFilter === "all" ? "📺" : "🔍"
      );
      fadeIn(container);
      return;
    }
    container.appendChild(showcaseGroup(
      "📺 Премьеры и новые сезоны", releases, "series", false, null,
      "series_releases", loadSeriesReleases,
    ));
    if (data.total_pages > 1) {
      container.appendChild(paginationRow(data.page, data.total_pages, (p) => {
        seriesReleasesPage = p;
        loadSeriesReleases();
      }));
    }
    fadeIn(container);
  } catch (e) {
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}
