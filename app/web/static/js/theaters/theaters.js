import { api } from "../core/api.js";
import { skeletonShowcaseHtml } from "../core/skeleton.js";
import { TAB_REVISIT_STALE_MS, ensureFilterPanel, escapeHtml, fadeIn, fadeOut, placeholderHtml } from "../core/utils.js";
import { VIEW_LOADERS, showSection } from "../core/views.js";
import { paginationRow } from "../list/list-items.js";
import { loadSimpleAddedFilter, simpleAddedFilterGroup } from "../showcase/filters.js";
import { showcaseGroup, showcaseRow } from "../showcase/row.js";

// "Афиша" (global now-playing/upcoming theatrical) and "Премьеры сериалов"
// (global series releases) tabs — both are TMDb discovery data with their
// own pagination and skip-list, rendered via showcaseGroup/showcaseRow.

let theatersLoaded = false;
let theatersLoadedAt = 0;
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

// `fromNav` is only true when showSection() calls this on a plain tab
// switch (see VIEW_LOADERS in views.js) — pagination and filter changes
// always pass their own args instead, so they always fetch.
export async function loadTheaters(trigger, fromNav) {
  const container = document.getElementById("theaters-container");
  const isStaleRevisit = fromNav && theatersLoaded && Date.now() - theatersLoadedAt >= TAB_REVISIT_STALE_MS;
  if (fromNav && theatersLoaded && !isStaleRevisit) {
    return;
  }
  renderTheatersFilters();

  if (theatersHideLocalOnly === null) await ensureTheatersSettingsLoaded();

  const isFreshView = !theatersLoaded || isStaleRevisit;
  if (isFreshView) {
    container.style.opacity = "1";
    container.innerHTML = `
      <div class="theaters-col theaters-col-now">${skeletonShowcaseHtml()}</div>
      <div class="theaters-col theaters-col-upcoming">${skeletonShowcaseHtml()}</div>`;
  }

  const dataPromise = api(`/api/theaters?now_playing_page=${theatersNowPlayingPage}&upcoming_page=${theatersUpcomingPage}&added=${theatersAddedFilter}&hide_local_only=${theatersHideLocalOnly ? 1 : 0}`);

  const singleColumnGuess = (trigger === "now" || trigger === "upcoming")
    && container.querySelector(".theaters-col-now") && container.querySelector(".theaters-col-upcoming");
  const containerFadeOutPromise = (singleColumnGuess || isFreshView) ? Promise.resolve() : fadeOut(container);

  try {
    const [data] = await Promise.all([dataPromise, containerFadeOutPromise]);
    theatersLoaded = true;
    theatersLoadedAt = Date.now();

    if (!data.now_playing.length && !data.upcoming.length
        && data.now_playing_total_pages <= 1 && data.upcoming_total_pages <= 1) {
      if (singleColumnGuess) await fadeOut(container);
      container.innerHTML = placeholderHtml(
        theatersAddedFilter === "all" ? "Пока нет данных о прокате — загляни попозже" : "Ничего не подходит под выбранный фильтр",
        theatersAddedFilter === "all" ? "🎬" : "🔍"
      );
      fadeIn(container);
      return;
    }

    let colNow = container.querySelector(".theaters-col-now");
    let colUpcoming = container.querySelector(".theaters-col-upcoming");
    const singleColumn = singleColumnGuess && colNow && colUpcoming;
    if (!singleColumn) {
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
let seriesReleasesLoadedAt = 0;
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

export async function loadSeriesReleases(fromNav) {
  const container = document.getElementById("series-releases-container");
  const isStaleRevisit = fromNav && seriesReleasesLoaded && Date.now() - seriesReleasesLoadedAt >= TAB_REVISIT_STALE_MS;
  if (fromNav && seriesReleasesLoaded && !isStaleRevisit) {
    return;
  }
  renderSeriesReleasesFilters();

  const isFreshView = !seriesReleasesLoaded || isStaleRevisit;
  if (isFreshView) {
    container.style.opacity = "1";
    container.innerHTML = skeletonShowcaseHtml();
  }

  const dataPromise = api(`/api/series-releases?page=${seriesReleasesPage}&added=${seriesReleasesAddedFilter}`);
  const fadeOutPromise = isFreshView ? Promise.resolve() : fadeOut(container);

  try {
    const [data] = await Promise.all([dataPromise, fadeOutPromise]);
    seriesReleasesLoaded = true;
    seriesReleasesLoadedAt = Date.now();
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
