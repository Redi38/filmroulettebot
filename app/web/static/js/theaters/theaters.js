// "Афиша" (global now-playing/upcoming theatrical) and "Премьеры сериалов"
// (global series releases) tabs — both are TMDb discovery data with their
// own pagination and skip-list, rendered via showcaseGroup/showcaseRow.

let theatersLoaded = false;
let theatersNowPlayingPage = 1;
let theatersUpcomingPage = 1;
const THEATERS_FILTER_KEY = "filmroulette_theaters_filter";
let theatersAddedFilter = loadSimpleAddedFilter(THEATERS_FILTER_KEY);

let theatersHideLocalOnly = null;

function appendGlobalOnlyToggle(panel) {
  let wrap = panel.querySelector('[data-filter-key="theaters-global-only"]');
  let btn;
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "showcase-filter-group";
    wrap.dataset.filterKey = "theaters-global-only";
    const row = document.createElement("div");
    row.className = "showcase-filter-options";
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "showcase-filter-btn";
    btn.textContent = "Только мировой прокат";
    btn.addEventListener("animationend", (ev) => {
      if (ev.animationName === "fxTogglePop") btn.classList.remove("fx-toggle-pop");
    });
    row.appendChild(btn);
    wrap.appendChild(row);
    panel.appendChild(wrap);
  } else {
    btn = wrap.querySelector(".showcase-filter-btn");
  }
  btn.classList.toggle("active", !!theatersHideLocalOnly);
  btn.disabled = theatersHideLocalOnly === null;
  btn.onclick = async () => {
    const next = !theatersHideLocalOnly;
    theatersHideLocalOnly = next;
    btn.classList.remove("fx-toggle-pop");
    void btn.offsetWidth;
    btn.classList.add("fx-toggle-pop");
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
  simpleAddedFilterGroup(panel, THEATERS_FILTER_KEY, theatersAddedFilter, (value) => {
    theatersAddedFilter = value;
    theatersNowPlayingPage = 1;
    theatersUpcomingPage = 1;
    renderTheatersFilters();
    loadTheaters();
  });
  appendGlobalOnlyToggle(panel);
  if (theatersHideLocalOnly === null) ensureTheatersSettingsLoaded();
}

async function loadTheaters(trigger) {
  const container = document.getElementById("theaters-container");
  renderTheatersFilters();
  if (!theatersLoaded) {
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api(`/api/theaters?now_playing_page=${theatersNowPlayingPage}&upcoming_page=${theatersUpcomingPage}&added=${theatersAddedFilter}`);
    theatersLoaded = true;
    if (!data.now_playing.length && !data.upcoming.length
        && data.now_playing_total_pages <= 1 && data.upcoming_total_pages <= 1) {
      await fadeOut(container);
      container.innerHTML = placeholderHtml(
        theatersAddedFilter === "all" ? "Пока нет данных о прокате — загляни попозже" : "Ничего не подходит под выбранный фильтр",
        theatersAddedFilter === "all" ? "🎬" : "🔍"
      );
      fadeIn(container);
      return;
    }

    let colNow = container.querySelector(".theaters-col-now");
    let colUpcoming = container.querySelector(".theaters-col-upcoming");
    const singleColumn = (trigger === "now" || trigger === "upcoming") && colNow && colUpcoming;
    if (!singleColumn) {
      await fadeOut(container);
      container.innerHTML = "";
      colNow = document.createElement("div");
      colNow.className = "theaters-col theaters-col-now";
      colUpcoming = document.createElement("div");
      colUpcoming.className = "theaters-col theaters-col-upcoming";
      container.appendChild(colNow);
      container.appendChild(colUpcoming);
    }

    if (!singleColumn || trigger === "now") {
      if (singleColumn) await fadeOut(colNow);
      colNow.innerHTML = "";
      colNow.appendChild(showcaseGroup(
        "🎬 Сейчас в прокате / вышло", data.now_playing, "movies", false, "now-playing",
        "theaters_now_playing", () => loadTheaters("now"),
      ));
      if (data.now_playing_total_pages > 1) {
        colNow.appendChild(paginationRow(data.now_playing_page, data.now_playing_total_pages, (p) => {
          theatersNowPlayingPage = p;
          loadTheaters("now");
        }));
      }
      if (singleColumn) fadeIn(colNow);
    }

    if (!singleColumn || trigger === "upcoming") {
      if (singleColumn) await fadeOut(colUpcoming);
      colUpcoming.innerHTML = "";
      colUpcoming.appendChild(showcaseGroup(
        "⏳ Скоро в кино", data.upcoming, "movies", false, "upcoming",
        "theaters_upcoming", () => loadTheaters("upcoming"),
      ));
      if (data.upcoming_total_pages > 1) {
        colUpcoming.appendChild(paginationRow(data.upcoming_page, data.upcoming_total_pages, (p) => {
          theatersUpcomingPage = p;
          loadTheaters("upcoming");
        }));
      }
      if (singleColumn) fadeIn(colUpcoming);
    }
    if (!singleColumn) fadeIn(container);
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
  simpleAddedFilterGroup(panel, SERIES_RELEASES_FILTER_KEY, seriesReleasesAddedFilter, (value) => {
    seriesReleasesAddedFilter = value;
    seriesReleasesPage = 1;
    renderSeriesReleasesFilters();
    loadSeriesReleases();
  });
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
