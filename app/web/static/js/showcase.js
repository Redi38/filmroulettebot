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
  const newSeasons = (data.new_seasons || []).filter(showcaseTypeMatches);

  await fadeOut(container);
  container.innerHTML = "";

  if (!data.upcoming.length && !data.released.length) {
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
    container.appendChild(showcaseGroup("🔔 Новые сезоны твоих сериалов", newSeasons, currentCat, true));
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
 
async function loadTheaters() {
  const container = document.getElementById("theaters-container");
  if (!theatersLoaded) {
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api("/api/theaters");
    await fadeOut(container);
    theatersLoaded = true;
    container.innerHTML = "";
    if (!data.now_playing.length && !data.upcoming.length) {
      container.innerHTML = placeholderHtml("Пока нет данных о прокате — загляни попозже", "🎬");
      fadeIn(container);
      return;
    }
    container.appendChild(showcaseGroup("🎬 Сейчас в прокате", data.now_playing, "movies"));
    container.appendChild(showcaseGroup("⏳ Скоро в кино", data.upcoming, "movies"));
    fadeIn(container);
  } catch (e) {
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}
 
function showcaseGroup(title, items, cat, isNewSeasons) {
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
  for (const item of items) group.appendChild(showcaseRow(item, cat, isNewSeasons));
  return group;
}
 
function showcaseRow(item, cat, isNewSeasons) {
  const row = document.createElement("div");
  row.className = "showcase-item";
  const poster = item.poster_url
    ? `<img class="showcase-poster" src="${item.poster_url}">`
    : `<div class="showcase-poster showcase-poster-placeholder">${item.is_series ? "📺" : "🎬"}</div>`;
  const dateLine = isNewSeasons && item.next_season
    ? `Сезон ${item.next_season.season_number} — ${item.next_season.air_date}`
    : item.release_date;
  row.innerHTML = `
    ${poster}
    <div class="showcase-info">
      <div class="showcase-title">${escapeHtml(item.title)}</div>
      <div class="showcase-date">${escapeHtml(dateLine)}</div>
    </div>`;
  const actionSlot = document.createElement("div");
  actionSlot.className = "showcase-action";
  if (item.in_list) {
    actionSlot.innerHTML = `<span class="muted">✓ В списке</span>`;
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-sm";
    btn.textContent = "Добавить";
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api(`/api/${cat}/add`, {
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
    actionSlot.appendChild(btn);
  }
  row.appendChild(actionSlot);
  return row;
}
