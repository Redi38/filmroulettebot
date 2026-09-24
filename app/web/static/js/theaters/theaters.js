import { api, apiPost } from "../core/api.js";
import { createFilterStore } from "../core/filter-store.js";
import { skeletonShowcaseHtml } from "../core/skeleton.js";
import { TAB_REVISIT_STALE_MS } from "../core/constants.js";
import { fadeIn, fadeOut } from "../core/transitions.js";
import { ensureFilterPanel, placeholderHtml } from "../core/utils.js";
import { beginLoad, showLoadError, showSkeleton } from "../core/view-load.js";
import { VIEW_LOADERS, showSection } from "../core/views.js";
import { paginationRow } from "../list/list-items.js";
import { groupByDay } from "../showcase/date-filters.js";
import { ADDED_OPTIONS, DIGITAL_OPTIONS, SERIES_STATUS_OPTIONS, segmentedGroup, setFilterPanelCount, togglesGroup } from "../showcase/filters.js";
import { showcaseDayGroup, showcaseGroup, showcaseRow } from "../showcase/row.js";

// Both tabs paginate server-side, so unlike the studio showcase their
// filters travel to the API as query params and the response comes back
// already narrowed — filtering a page the server had already cut to size
// would leave the pagination row counting the unfiltered list.

// "Афиша" (global now-playing/upcoming theatrical) and "Премьеры сериалов"
// (global series releases) tabs — both are TMDb discovery data with their
// own pagination and skip-list, rendered via showcaseGroup/showcaseRow.

let theatersLoaded = false;
let theatersLoadedAt = 0;
let theatersNowPlayingPage = 1;
let theatersUpcomingPage = 1;
const theatersFilters = createFilterStore("filmroulette_theaters_filters", {
  added: "all",
  digital: "all",
  group: "none",
}, {
  allowed: {
    added: ["all", "hide", "only"],
    digital: ["all", "digital", "cinema"],
    group: ["none", "day"],
  },
});

// Unlike everything else on this panel, the "мировой прокат" flag is a
// server-side account setting rather than a local preference, so it keeps
// its own async load/save path and starts as null ("not known yet").
let theatersHideLocalOnly = null;

async function setHideLocalOnly(next) {
  theatersHideLocalOnly = next;
  renderTheatersFilters();
  try {
    await apiPost("/api/settings/hide_local_only_afisha", { value: next });
  } catch (e) {
    theatersHideLocalOnly = !next;
    renderTheatersFilters();
    return;
  }
  theatersNowPlayingPage = 1;
  theatersUpcomingPage = 1;
  loadTheaters();
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
  const panel = ensureFilterPanel("theaters-filters", "theaters-section", "theaters-container",
    { collapseOnDesktop: true });

  const reload = () => {
    theatersNowPlayingPage = 1;
    theatersUpcomingPage = 1;
    renderTheatersFilters();
    loadTheaters();
  };
  const setAndReload = (key) => (value) => {
    theatersFilters.set(key, value);
    reload();
  };

  segmentedGroup(panel, "theaters-added", "Показывать", ADDED_OPTIONS,
    theatersFilters.get("added"), setAndReload("added"));
  segmentedGroup(panel, "theaters-digital", "Доступность", DIGITAL_OPTIONS,
    theatersFilters.get("digital"), setAndReload("digital"));
  togglesGroup(panel, "theaters-extras", "Дополнительно", [
    {
      key: "group-day",
      label: "По дням",
      active: theatersFilters.get("group") === "day",
      // Grouping changes the order the server sorts in (see
      // theatersQuery), so it refetches from page 1 like any other
      // filter rather than just re-rendering what's on screen.
      onToggle: (next) => {
        theatersFilters.set("group", next ? "day" : "none");
        reload();
      },
    },
    {
      key: "global-only",
      label: "Только мировой прокат",
      active: !!theatersHideLocalOnly,
      disabled: theatersHideLocalOnly === null,
      onToggle: setHideLocalOnly,
    },
  ]);
  setFilterPanelCount(panel, theatersFilters.activeCount() + (theatersHideLocalOnly ? 1 : 0));
  if (theatersHideLocalOnly === null) ensureTheatersSettingsLoaded();
}

function theatersQuery() {
  return [
    `now_playing_page=${theatersNowPlayingPage}`,
    `upcoming_page=${theatersUpcomingPage}`,
    `added=${theatersFilters.get("added")}`,
    `hide_local_only=${theatersHideLocalOnly ? 1 : 0}`,
    `digital=${theatersFilters.get("digital")}`,
    `order=${theatersFilters.get("group") === "day" ? "date" : "default"}`,
  ].join("&");
}

function theatersColumnGroup(title, items, addMode, skipScope, onSkipSettled) {
  if (theatersFilters.get("group") === "day") {
    return showcaseDayGroup(title, groupByDay(items), "movies", false, addMode, skipScope, onSkipSettled);
  }
  return showcaseGroup(title, items, "movies", false, addMode, skipScope, onSkipSettled);
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
    showSkeleton(container, `
      <div class="theaters-col theaters-col-now">${skeletonShowcaseHtml()}</div>
      <div class="theaters-col theaters-col-upcoming">${skeletonShowcaseHtml()}</div>`);
  }

  const dataPromise = api(`/api/theaters?${theatersQuery()}`);

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
      const filtered = theatersFilters.activeCount() > 0;
      container.innerHTML = placeholderHtml(
        filtered ? "Ничего не подходит под выбранные фильтры" : "Пока нет данных о прокате — загляни попозже",
        filtered ? "🔍" : "🎬"
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
      colNow.appendChild(theatersColumnGroup(
        "🎬 Сейчас в прокате / вышло", data.now_playing, "now-playing",
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
      colUpcoming.appendChild(theatersColumnGroup(
        "⏳ Скоро в кино", data.upcoming, "upcoming",
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
    showLoadError(container, e);
  }
}

let seriesReleasesLoaded = false;
let seriesReleasesLoadedAt = 0;
let seriesReleasesPage = 1;
const seriesReleasesFilters = createFilterStore("filmroulette_series_releases_filters", {
  added: "all",
  status: "all",
  group: "none",
}, {
  allowed: {
    added: ["all", "hide", "only"],
    status: ["all", "new_series", "new_season", "airing"],
    group: ["none", "day"],
  },
});

function renderSeriesReleasesFilters() {
  const panel = ensureFilterPanel("series-releases-filters", "series-releases-section", "series-releases-container",
    { collapseOnDesktop: true });
  const reload = () => {
    seriesReleasesPage = 1;
    renderSeriesReleasesFilters();
    loadSeriesReleases();
  };
  const setAndReload = (key) => (value) => {
    seriesReleasesFilters.set(key, value);
    reload();
  };

  segmentedGroup(panel, "series-added", "Показывать", ADDED_OPTIONS,
    seriesReleasesFilters.get("added"), setAndReload("added"));
  segmentedGroup(panel, "series-status", "Что именно", SERIES_STATUS_OPTIONS,
    seriesReleasesFilters.get("status"), setAndReload("status"));
  togglesGroup(panel, "series-extras", "Дополнительно", [{
    key: "group-day",
    label: "По дням",
    active: seriesReleasesFilters.get("group") === "day",
    onToggle: (next) => {
      seriesReleasesFilters.set("group", next ? "day" : "none");
      reload();
    },
  }]);
  setFilterPanelCount(panel, seriesReleasesFilters.activeCount());
}

function seriesReleasesQuery() {
  return [
    `page=${seriesReleasesPage}`,
    `added=${seriesReleasesFilters.get("added")}`,
    `status=${seriesReleasesFilters.get("status")}`,
    `order=${seriesReleasesFilters.get("group") === "day" ? "date" : "default"}`,
  ].join("&");
}

export async function loadSeriesReleases(fromNav) {
  const container = document.getElementById("series-releases-container");
  const isStaleRevisit = fromNav && seriesReleasesLoaded && Date.now() - seriesReleasesLoadedAt >= TAB_REVISIT_STALE_MS;
  if (fromNav && seriesReleasesLoaded && !isStaleRevisit) {
    return;
  }
  renderSeriesReleasesFilters();

  const isFreshView = !seriesReleasesLoaded || isStaleRevisit;
  const fadeOutPromise = beginLoad(container, {fresh: isFreshView, skeleton: skeletonShowcaseHtml()});
  const dataPromise = api(`/api/series-releases?${seriesReleasesQuery()}`);

  try {
    const [data] = await Promise.all([dataPromise, fadeOutPromise]);
    seriesReleasesLoaded = true;
    seriesReleasesLoadedAt = Date.now();
    container.innerHTML = "";
    const releases = data.releases || [];

    if (!releases.length && data.total_pages <= 1) {
      const filtered = seriesReleasesFilters.activeCount() > 0;
      container.innerHTML = placeholderHtml(
        filtered
          ? "Ничего не подходит под выбранные фильтры"
          : "Пока нет анонсированных премьер с рейтингом 7+ — загляни попозже",
        filtered ? "🔍" : "📺"
      );
      fadeIn(container);
      return;
    }

    const seriesTitle = "📺 Премьеры и новые сезоны";
    container.appendChild(seriesReleasesFilters.get("group") === "day"
      ? showcaseDayGroup(seriesTitle, groupByDay(releases), "series", false, null,
        "series_releases", loadSeriesReleases)
      : showcaseGroup(seriesTitle, releases, "series", false, null,
        "series_releases", loadSeriesReleases));

    if (data.total_pages > 1) {
      container.appendChild(paginationRow(data.page, data.total_pages, (p) => {
        seriesReleasesPage = p;
        loadSeriesReleases();
      }));
    }
    fadeIn(container);
  } catch (e) {
    showLoadError(container, e);
  }
}
