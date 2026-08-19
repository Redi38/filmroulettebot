let currentShowcaseStudio = null;
let lastShowcaseData = null;

const SHOWCASE_FILTER_KEY = "filmroulette_showcase_filters";
function loadShowcaseFilters() {
  try {
    const raw = localStorage.getItem(SHOWCASE_FILTER_KEY);
    if (!raw) return {type: "all", added: "all"};
    const f = JSON.parse(raw);
    return {type: f.type || "all", added: f.added || "all"};
  } catch { return {type: "all", added: "all"}; }
}
function saveShowcaseFilters() {
  try { localStorage.setItem(SHOWCASE_FILTER_KEY, JSON.stringify(showcaseFilters)); } catch {}
}
let showcaseFilters = loadShowcaseFilters();

async function loadShowcase() {
  const cat = currentCat;
  const container = document.getElementById("showcase-container");
  const isFreshView = currentShowcaseStudio !== cat;
  currentShowcaseStudio = cat;
  if (isFreshView) {
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api(`/api/showcase/${cat}`);
    lastShowcaseData = data;
    renderShowcaseFilters();
    renderShowcaseContent();
  } catch (e) {
    lastShowcaseData = null;
    await fadeOut(container);
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}

function showcaseTypeMatches(item) {
  if (showcaseFilters.type === "movie") return !item.is_series;
  if (showcaseFilters.type === "series") return !!item.is_series;
  return true;
}
function showcaseAddedMatches(item) {
  if (showcaseFilters.added === "hide") return !item.in_list;
  if (showcaseFilters.added === "only") return !!item.in_list;
  return true;
}

async function renderShowcaseContent() {
  const container = document.getElementById("showcase-container");
  const data = lastShowcaseData;
  if (!data) return;

  const upcoming = data.upcoming.filter(m => showcaseTypeMatches(m) && showcaseAddedMatches(m));
  const released = data.released.filter(m => showcaseTypeMatches(m) && showcaseAddedMatches(m));
  const newSeasons = (data.new_seasons || []).filter(m => showcaseTypeMatches(m) && showcaseAddedMatches(m));

  await fadeOut(container);
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
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "showcase-filters";
    const section = document.getElementById("showcase-section");
    section.insertBefore(panel, document.getElementById("showcase-container"));
  }
  panel.innerHTML = "";

  panel.appendChild(showcaseFilterGroup("Тип", [
    ["all", "Все"], ["movie", "Фильмы"], ["series", "Сериалы"],
  ], "type"));
  panel.appendChild(showcaseFilterGroup("Показывать", [
    ["all", "Все"], ["hide", "Не добавленные"], ["only", "Уже добавленные"],
  ], "added"));
}

function showcaseFilterGroup(title, options, key) {
  const wrap = document.createElement("div");
  wrap.className = "showcase-filter-group";
  const h4 = document.createElement("h4");
  h4.textContent = title;
  wrap.appendChild(h4);
  const row = document.createElement("div");
  row.className = "showcase-filter-options";
  for (const [value, label] of options) {
    const btn = document.createElement("button");
    btn.className = "showcase-filter-btn" + (showcaseFilters[key] === value ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => {
      showcaseFilters[key] = value;
      saveShowcaseFilters();
      renderShowcaseFilters();
      renderShowcaseContent();
    };
    row.appendChild(btn);
  }
  wrap.appendChild(row);
  return wrap;
}
 
function simpleAddedFilterGroup(storageKey, currentValue, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "showcase-filter-group";
  const h4 = document.createElement("h4");
  h4.textContent = "Показывать";
  wrap.appendChild(h4);
  const row = document.createElement("div");
  row.className = "showcase-filter-options";
  for (const [value, label] of [["all", "Все"], ["hide", "Не добавленные"], ["only", "Уже добавленные"]]) {
    const btn = document.createElement("button");
    btn.className = "showcase-filter-btn" + (currentValue === value ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => {
      try { localStorage.setItem(storageKey, value); } catch {}
      onChange(value);
    };
    row.appendChild(btn);
  }
  wrap.appendChild(row);
  return wrap;
}
function loadSimpleAddedFilter(storageKey) {
  try { return localStorage.getItem(storageKey) || "all"; } catch { return "all"; }
}

let theatersLoaded = false;
let theatersNowPlayingPage = 1;
let theatersUpcomingPage = 1;
const THEATERS_FILTER_KEY = "filmroulette_theaters_filter";
let theatersAddedFilter = loadSimpleAddedFilter(THEATERS_FILTER_KEY);

function renderTheatersFilters() {
  const section = document.getElementById("theaters-section");
  let panel = document.getElementById("theaters-filters");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "theaters-filters";
    panel.className = "filter-panel";
    section.insertBefore(panel, document.getElementById("theaters-container"));
  }
  panel.innerHTML = "";
  panel.appendChild(simpleAddedFilterGroup(THEATERS_FILTER_KEY, theatersAddedFilter, (value) => {
    theatersAddedFilter = value;
    theatersNowPlayingPage = 1;
    theatersUpcomingPage = 1;
    renderTheatersFilters();
    loadTheaters();
  }));
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
  const section = document.getElementById("series-releases-section");
  let panel = document.getElementById("series-releases-filters");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "series-releases-filters";
    panel.className = "filter-panel";
    section.insertBefore(panel, document.getElementById("series-releases-container"));
  }
  panel.innerHTML = "";
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
 
const _mediaDetailsCache = new Map();

function showcaseGroup(title, items, cat, isNewSeasons, addMode, skipScope, onSkipSettled) {
  const group = document.createElement("div");
  group.className = "check-group";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  group.appendChild(h3);
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "—";
    group.appendChild(empty);
    return group;
  }
  for (const item of items) group.appendChild(showcaseRow(item, cat, isNewSeasons, addMode, skipScope, onSkipSettled));
  return group;
}

function showcaseRow(item, cat, isNewSeasons, addMode, skipScope, onSkipSettled) {
  const wrap = document.createElement("div");
  wrap.className = "showcase-item-wrap";

  const row = document.createElement("div");
  row.className = "showcase-item";
  const posterHtml = item.poster_url
    ? `<img class="showcase-poster" src="${item.poster_url}">`
    : `<div class="showcase-poster showcase-poster-placeholder">${item.is_series ? "📺" : "🎬"}</div>`;
  const dateLine = isNewSeasons && item.next_season
    ? (item.airing_now
        ? `📅 Сезон ${item.next_season.season_number} выходит — финал ${item.season_finale_date}`
        : `Сезон ${item.next_season.season_number} — ${item.next_season.air_date}`)
    : item.is_new_season
    ? `🆕 Новый сезон — ${item.release_date}`
    : item.airing_now
    ? `📅 Сезон выходит — финал ${item.release_date}`
    : (addMode === "now-playing" && item.digitally_released)
    ? `${item.release_date} · 📀 уже в цифре`
    : item.release_date;

  const infoBtn = document.createElement("div");
  infoBtn.className = "showcase-info showcase-info-clickable";
  infoBtn.innerHTML = `
    ${posterHtml}
    <div class="showcase-info-text">
      <div class="showcase-title">${escapeHtml(item.title)}</div>
      <div class="showcase-date">${escapeHtml(dateLine)}</div>
    </div>`;
  row.appendChild(infoBtn);

  const actionSlot = document.createElement("div");
  actionSlot.className = "showcase-action";
  if (item.in_list) {
    actionSlot.innerHTML = `<span class="muted">✓ В списке</span>`;
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Добавить";
    const addTo = async (endpointCat) => {
      btn.disabled = true;
      try {
        await api(`/api/${endpointCat}/add`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({title: item.title}),
        });
        item.in_list = true;
        actionSlot.innerHTML = `<span class="muted">✓ В списке</span>`;
        showToast(`«${item.title}» добавлен`);
      } catch (e) {
        btn.disabled = false;
        showToast(e.message || "Не удалось добавить");
      }
    };
    const addToUpcoming = async () => {
      btn.disabled = true;
      try {
        await api(`/api/upcoming/add`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({title: item.title}),
        });
        item.in_list = true;
        actionSlot.innerHTML = `<span class="muted">✓ В списке</span>`;
        showToast(`«${item.title}» добавлен в «Скоро в кино»`);
      } catch (e) {
        btn.disabled = false;
        showToast(e.message || "Не удалось добавить");
      }
    };
    btn.onclick = (ev) => {
      ev.stopPropagation();
      if (addMode === "upcoming") {
        addToUpcoming();
      } else if (addMode === "now-playing") {
        openCategoryModal(`Куда добавить «${item.title}»?`, (category) => addTo(category), ["movies", "cartoons"]);
      } else {
        addTo(cat);
      }
    };
    actionSlot.appendChild(btn);

    if (skipScope) {
      actionSlot.classList.add("showcase-action-stack");
      const skipBtn = document.createElement("button");
      skipBtn.className = "btn btn-ghost";
      skipBtn.textContent = "Скип";
      let confirmTimer = null;
      const doSkip = async () => {
        skipBtn.disabled = true;
        try {
          await api("/api/skip", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({scope: skipScope, title: item.title}),
          });
          const rowParent = wrap.parentNode;
          const rowNext = wrap.nextSibling;
          wrap.remove();
          let undoClicked = false;
          showInlineUndo(rowParent, rowNext, `«${item.title}» скрыт`, "Отменить", async () => {
            undoClicked = true;
            try {
              await api("/api/unskip", {
                method: "POST", headers: {"Content-Type": "application/json"},
                body: JSON.stringify({scope: skipScope, title: item.title}),
              });
            } catch (e) {}
            if (onSkipSettled) onSkipSettled();
          }, () => {
            if (!undoClicked && onSkipSettled) onSkipSettled();
          });
        } catch (e) {
          skipBtn.disabled = false;
          showToast(e.message || "Не удалось скрыть");
        }
      };
      skipBtn.onclick = (ev) => {
        ev.stopPropagation();
        if (!skipBtn.classList.contains("confirming")) {
          skipBtn.classList.add("confirming");
          skipBtn.textContent = "Точно? Ещё раз";
          confirmTimer = setTimeout(() => {
            skipBtn.classList.remove("confirming");
            skipBtn.textContent = "Скип";
          }, 3000);
          return;
        }
        clearTimeout(confirmTimer);
        doSkip();
      };
      actionSlot.appendChild(skipBtn);
    }
  }
  row.appendChild(actionSlot);
  wrap.appendChild(row);

  const detail = document.createElement("div");
  detail.className = "showcase-detail";
  wrap.appendChild(detail);

  let expanded = false;
  infoBtn.onclick = async () => {
    expanded = !expanded;
    wrap.classList.toggle("expanded", expanded);
    if (!expanded || !item.id) return;
    const cacheKey = `${item.is_series ? "tv" : "movie"}:${item.id}`;
    if (_mediaDetailsCache.has(cacheKey)) {
      detail.innerHTML = renderShowcaseDetail(_mediaDetailsCache.get(cacheKey), item);
      return;
    }
    detail.innerHTML = `<div class="spinner">Загрузка…</div>`;
    try {
      const data = await api(`/api/media/${item.is_series ? "tv" : "movie"}/${item.id}`);
      _mediaDetailsCache.set(cacheKey, data);
      if (expanded) detail.innerHTML = renderShowcaseDetail(data, item);
    } catch (e) {
      if (expanded) detail.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message || "Не удалось загрузить")}</div>`;
    }
  };

  return wrap;
}

function renderShowcaseDetail(data, item) {
  const rating = data.rating !== "—" ? `⭐️ ${data.rating}/10` : "⭐️ —";
  let extra = "";
  if (data.runtime && data.runtime !== "—") extra += `<div class="meta">⏳ ${escapeHtml(String(data.runtime))} мин.</div>`;
  if (data.seasons) extra += `<div class="meta">📚 Сезонов: ${escapeHtml(String(data.seasons))} · 🎥 Эпизодов: ${escapeHtml(String(data.episodes ?? "—"))}</div>`;

  const today = new Date().toISOString().slice(0, 10);
  const notReleasedYet = (item.release_date || "") > today;
  let actionBtn = "";
  if (notReleasedYet) {
    if (data.trailer_url) {
      actionBtn = `<a class="btn btn-primary btn-sm" href="${data.trailer_url}" target="_blank" rel="noopener">Трейлер</a>`;
    }
  } else if (data.watch_link) {
    actionBtn = `<a class="btn btn-primary btn-sm" href="${data.watch_link}" target="_blank" rel="noopener">Смотреть онлайн</a>`;
  }

  return `
    <div class="showcase-detail-body">
      <div class="meta">${rating}</div>
      ${extra}
      <div class="meta">🎭 ${escapeHtml(data.genres || "—")}</div>
      <div class="meta">👥 ${escapeHtml(data.actors || "—")}</div>
      <div class="overview">${escapeHtml(data.overview || "")}</div>
      ${actionBtn}
    </div>`;
}
