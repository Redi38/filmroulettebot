// Studio showcase (Marvel/DC catalog browsing) and the user's own
// tracked-series list. Filter helpers live in filters.js, and
// row/group rendering (shared with theaters.js) lives in row.js.

let currentShowcaseStudio = null;
let lastShowcaseData = null;

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

let trackedSeriesLoaded = false;
async function loadTrackedSeries() {
  const container = document.getElementById("tracked-series-container");
  if (!trackedSeriesLoaded) {
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
  }
  try {
    const data = await api(`/api/tracked-series`);
    await fadeOut(container);
    trackedSeriesLoaded = true;
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
