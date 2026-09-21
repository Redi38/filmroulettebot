import { openAddSearchModal } from "../core/add-search.js";
import { api, apiPost } from "../core/api.js";
import { skeletonShowcaseHtml } from "../core/skeleton.js";
import { uiState } from "../core/state.js";
import { TAB_REVISIT_STALE_MS } from "../core/constants.js";
import { showToast } from "../core/toast.js";
import { fadeIn, fadeOut } from "../core/transitions.js";
import { placeholderHtml } from "../core/utils.js";
import { beginLoad, showLoadError, showSkeleton } from "../core/view-load.js";
import { VIEW_LOADERS, showSection } from "../core/views.js";
import { createFilterStore } from "../core/filter-store.js";
import { groupByDay } from "./date-filters.js";
import { ADDED_OPTIONS, TYPE_OPTIONS, segmentedGroup, setFilterPanelCount, togglesGroup } from "./filters.js";
import { showcaseDayGroup, showcaseGroup } from "./row.js";

// Studio showcase (Marvel/DC catalog browsing) and the user's own
// tracked-series list. Filter helpers live in filters.js, and
// row/group rendering (shared with theaters.js) lives in row.js.

// One store for the whole studio showcase (both Marvel and DC share it —
// the filters are about what you want to watch, not which studio tab
// you're on, so carrying them across the two is the expected behaviour).
const showcaseFilters = createFilterStore("filmroulette_showcase_filters", {
  type: "all",
  added: "all",
  group: "none",
}, {
  allowed: {
    type: ["all", "movie", "series"],
    added: ["all", "hide", "only"],
    group: ["none", "day"],
  },
});

let currentShowcaseStudio = null;
let lastShowcaseData = null;
let lastShowcaseLoadedAt = 0;
let showcaseContainerPainted = false;
let skeletonJustInserted = false;

export function prepShowcaseSkeletonIfStale() {
  if (uiState.currentCat === currentShowcaseStudio) return;
  const container = document.getElementById("showcase-container");
  if (!container) return;
  const prevEl = document.querySelector(".section.active");
  const enteringFromElsewhere = !prevEl || prevEl.id !== "showcase-section";
  if (!enteringFromElsewhere && showcaseContainerPainted) return;
  showSkeleton(container, skeletonShowcaseHtml());
  skeletonJustInserted = true;
}

// `fromNav` is only true when showSection() calls this on a plain tab
// switch (see VIEW_LOADERS in views.js) — filter changes and other direct
// callers always pass nothing, so they always fetch.
export async function loadShowcase(fromNav) {
  const cat = uiState.currentCat;
  const container = document.getElementById("showcase-container");
  const isFreshView = currentShowcaseStudio !== cat;
  if (fromNav && !isFreshView && lastShowcaseData && Date.now() - lastShowcaseLoadedAt < TAB_REVISIT_STALE_MS) {
    return;
  }
  currentShowcaseStudio = cat;
  const skipFadeOut = skeletonJustInserted || (isFreshView && !showcaseContainerPainted);
  skeletonJustInserted = false;
  const fadeOutPromise = beginLoad(container, {fresh: skipFadeOut, skeleton: skeletonShowcaseHtml()});
  const dataPromise = api(`/api/showcase/${cat}`);
  try {
    const [data] = await Promise.all([dataPromise, fadeOutPromise]);
    lastShowcaseData = data;
    lastShowcaseLoadedAt = Date.now();
    showcaseContainerPainted = true;
    renderShowcaseFilters();
    renderShowcaseContent(true);
  } catch (e) {
    lastShowcaseData = null;
    showcaseContainerPainted = true;
    showLoadError(container, e);
  }
}

// The studio catalog arrives whole (no pagination), so every filter here
// runs in the browser — unlike the theaters/series tabs, which have to
// filter server-side or their page counter would describe the wrong list.
function typeMatches(item) {
  const type = showcaseFilters.get("type");
  if (type === "movie") return !item.is_series;
  if (type === "series") return !!item.is_series;
  return true;
}

function addedMatches(item) {
  const added = showcaseFilters.get("added");
  if (added === "hide") return !item.in_list;
  if (added === "only") return !!item.in_list;
  return true;
}

function commonMatches(item) {
  return typeMatches(item) && addedMatches(item);
}

function appendGroup(container, title, items, isNewSeasons) {
  if (showcaseFilters.get("group") === "day") {
    container.appendChild(showcaseDayGroup(title, groupByDay(items), uiState.currentCat, isNewSeasons));
    return;
  }
  container.appendChild(showcaseGroup(title, items, uiState.currentCat, isNewSeasons));
}

export async function renderShowcaseContent(alreadyFadedOut) {
  const container = document.getElementById("showcase-container");
  const data = lastShowcaseData;
  if (!data) return;

  const upcoming = data.upcoming.filter(commonMatches);
  const released = data.released.filter(commonMatches);
  const newSeasons = (data.new_seasons || []).filter(commonMatches);

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
    appendGroup(container, "🔔 Новые сезоны", newSeasons, true);
  }
  appendGroup(container, "⏳ Скоро выйдет", upcoming);
  appendGroup(container, "✅ Уже вышло", released);
  fadeIn(container);
}

export function renderShowcaseFilters() {
  let panel = document.getElementById("showcase-filters");
  const isNewPanel = !panel;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "showcase-filters";
    panel.className = "filter-panel";
    const section = document.getElementById("showcase-section");
    section.insertBefore(panel, document.getElementById("showcase-container"));
  }
  if (isNewPanel || currentShowcaseStudio !== panel.dataset.studio) {
    panel.dataset.studio = currentShowcaseStudio;
    panel.classList.remove("fade-in");
    void panel.offsetWidth;
    panel.classList.add("fade-in");
  }

  const rerender = () => {
    renderShowcaseFilters();
    renderShowcaseContent();
  };
  const setAndRerender = (key) => (value) => {
    showcaseFilters.set(key, value);
    rerender();
  };

  segmentedGroup(panel, "showcase-type", "Тип", TYPE_OPTIONS, showcaseFilters.get("type"), setAndRerender("type"));
  segmentedGroup(panel, "showcase-added", "Показывать", ADDED_OPTIONS,
    showcaseFilters.get("added"), setAndRerender("added"));
  togglesGroup(panel, "showcase-extras", "Дополнительно", [{
    key: "group-day",
    label: "По дням",
    active: showcaseFilters.get("group") === "day",
    onToggle: (next) => {
      showcaseFilters.set("group", next ? "day" : "none");
      rerender();
    },
  }]);
  setFilterPanelCount(panel, showcaseFilters.activeCount());
}

let trackedSeriesLoaded = false;
let trackedSeriesLoadedAt = 0;

export async function loadTrackedSeries(fromNav) {
  const container = document.getElementById("tracked-series-container");
  if (fromNav && trackedSeriesLoaded && Date.now() - trackedSeriesLoadedAt < TAB_REVISIT_STALE_MS) {
    return;
  }
  const fadeOutPromise = beginLoad(container, {fresh: !trackedSeriesLoaded, skeleton: skeletonShowcaseHtml()});
  const dataPromise = api(`/api/tracked-series`);
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
    showLoadError(container, e);
  }
}

document.getElementById("tracked-series-add-btn").onclick = async () => {
  const input = document.getElementById("tracked-series-add-input");
  const title = input.value.trim();
  if (!title) return;
  const doAdd = async (finalTitle) => {
    try {
      await apiPost("/api/tracked-series/add", {title: finalTitle});
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
