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
 
let theatersLoaded = false;
let theatersNowPlayingPage = 1;
let theatersUpcomingPage = 1;

async function loadTheaters() {
  const container = document.getElementById("theaters-container");
  if (!theatersLoaded) {
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api(`/api/theaters?now_playing_page=${theatersNowPlayingPage}&upcoming_page=${theatersUpcomingPage}`);
    await fadeOut(container);
    theatersLoaded = true;
    container.innerHTML = "";
    const newSeasons = data.new_seasons || [];
    if (!data.now_playing.length && !data.upcoming.length && !newSeasons.length
        && data.now_playing_total_pages <= 1 && data.upcoming_total_pages <= 1) {
      container.innerHTML = placeholderHtml("Пока нет данных о прокате — загляни попозже", "🎬");
      fadeIn(container);
      return;
    }
    if (newSeasons.length) {
      container.appendChild(showcaseGroup("🔔 Новые сезоны", newSeasons, "series", true));
    }
    container.appendChild(showcaseGroup("🎬 Сейчас в прокате", data.now_playing, "movies", false, "now-playing"));
    if (data.now_playing_total_pages > 1) {
      container.appendChild(paginationRow(data.now_playing_page, data.now_playing_total_pages, (p) => {
        theatersNowPlayingPage = p;
        loadTheaters();
      }));
    }
    container.appendChild(showcaseGroup("⏳ Скоро в кино", data.upcoming, "movies", false, "upcoming"));
    if (data.upcoming_total_pages > 1) {
      container.appendChild(paginationRow(data.upcoming_page, data.upcoming_total_pages, (p) => {
        theatersUpcomingPage = p;
        loadTheaters();
      }));
    }
    fadeIn(container);
  } catch (e) {
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}
 
const _mediaDetailsCache = new Map();

function showcaseGroup(title, items, cat, isNewSeasons, addMode) {
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
  for (const item of items) group.appendChild(showcaseRow(item, cat, isNewSeasons, addMode));
  return group;
}

function showcaseRow(item, cat, isNewSeasons, addMode) {
  const wrap = document.createElement("div");
  wrap.className = "showcase-item-wrap";

  const row = document.createElement("div");
  row.className = "showcase-item";
  const posterHtml = item.poster_url
    ? `<img class="showcase-poster" src="${item.poster_url}">`
    : `<div class="showcase-poster showcase-poster-placeholder">${item.is_series ? "📺" : "🎬"}</div>`;
  const dateLine = isNewSeasons && item.next_season
    ? `Сезон ${item.next_season.season_number} — ${item.next_season.air_date}`
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
        if (item.digitally_released) {
          openCategoryModal(`Куда добавить «${item.title}»?`, (category) => addTo(category));
        } else {
          addToUpcoming();
        }
      } else {
        addTo(cat);
      }
    };
    actionSlot.appendChild(btn);
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
