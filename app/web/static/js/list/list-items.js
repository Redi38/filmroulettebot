// List rendering for movies/cartoons/series categories: load, search, pagination, add/delete.

let currentListPage = 1;
let currentListCat = null;
let currentListQuery = "";

async function loadList(page) {
  if (page) currentListPage = page;
  else currentListPage = 1;

  document.getElementById("add-row").style.display = "flex";
  const featured = document.getElementById("list-featured");
  const container = document.getElementById("list-container");
  const searchInput = document.getElementById("search-input");

  const isFreshView = currentListCat !== currentCat;
  currentListCat = currentCat;
  if (isFreshView) {
    currentListQuery = "";
    searchInput.value = "";
    container.style.opacity = "1";
    container.innerHTML = '<div class="spinner">Загрузка…</div>';
    featured.style.opacity = "1";
    featured.innerHTML = "";
    const countElReset = document.getElementById("list-count");
    if (countElReset) countElReset.textContent = "";
  }

  const isFeaturedCat = currentCat === "marvel" || currentCat === "dc";
  const featuredPromise = isFeaturedCat
    ? api(`/api/${currentCat}/featured`).catch(() => null)
    : Promise.resolve(null);
  const q = currentListQuery.trim();
  const itemsPromise = api(`/api/${currentCat}/items?page=${currentListPage}&q=${encodeURIComponent(q)}`);

  if (isFeaturedCat && isFreshView) {
    featured.innerHTML = '<div class="spinner">Загрузка витрины…</div>';
  }

  try {
    const [featuredCard, data] = await Promise.all([featuredPromise, itemsPromise]);

    if (isFeaturedCat) {
      await fadeOut(featured);
      featured.innerHTML = featuredCard
        ? `<div class="featured-label">🎲 Первый в списке</div>` + renderCard(featuredCard, {actions: false})
        : "";
      fadeIn(featured);
    } else if (featured.innerHTML) {
      featured.innerHTML = "";
    }

    await fadeOut(container);
    const countEl = document.getElementById("list-count");
    if (!data.total_count) {
      if (countEl) countEl.textContent = "";
      container.innerHTML = q
        ? placeholderHtml(`Ничего не найдено по «${escapeHtml(q)}»`, "🔍")
        : placeholderHtml("Пока здесь пусто — добавь первый тайтл выше 🍿", "📭");
      fadeIn(container);
      return;
    }
    if (countEl) countEl.textContent = `Всего: ${data.total_count}`;
    let liveCount = data.total_count;
    container.innerHTML = "";
    for (const title of data.items) {
      const cat = currentCat;
      const row = createEditableRow(title, {
        onRename: (newTitle) => api(`/api/${cat}/rename`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({old_title: title, new_title: newTitle}),
        }),
        onDelete: () => api(`/api/${cat}/delete`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({title}),
        }),
        onRestore: () => api(`/api/${cat}/add`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({title}),
        }),
        onReload: () => { if (currentCat === cat) loadList(currentListPage); },
        onUndoSettled: () => checkListEmpty(container),
        onCountChange: (delta) => {
          if (currentCat !== cat || !countEl) return;
          liveCount += delta;
          countEl.textContent = `Всего: ${liveCount}`;
        },
      });
      container.appendChild(row);
    }
    if (data.total_pages > 1) container.appendChild(paginationRow(data.page, data.total_pages, (p) => loadList(p)));
    fadeIn(container);
  } catch (e) {
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}

function checkListEmpty(container) {
  if (container.querySelector(".list-row") || container.querySelector(".inline-undo-row")) return;
  const q = currentListQuery.trim();
  container.innerHTML = q
    ? placeholderHtml(`Ничего не найдено по «${escapeHtml(q)}»`, "🔍")
    : placeholderHtml("Пока здесь пусто — добавь первый тайтл выше 🍿", "📭");
}

document.getElementById("search-input").addEventListener("input", debounce((ev) => {
  currentListQuery = ev.target.value;
  loadList();
}, 300));

function chevronSvg(dir) {
  const NS = "http://www.w3.org/2000/svg";
  const points = dir === "left" ? "15,6 9,12 15,18" : "9,6 15,12 9,18";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.style.display = "block";
  const poly = document.createElementNS(NS, "polyline");
  poly.setAttribute("points", points);
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", "currentColor");
  poly.setAttribute("stroke-width", "3");
  poly.setAttribute("stroke-linecap", "round");
  poly.setAttribute("stroke-linejoin", "round");
  svg.appendChild(poly);
  return svg;
}

function paginationRow(page, totalPages, onNav) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.justifyContent = "center";
  row.style.alignItems = "center";
  row.style.gap = "14px";
  row.style.padding = "14px 0 4px";

  const prev = document.createElement("button");
  prev.className = "btn btn-primary page-nav-btn";
  prev.appendChild(chevronSvg("left"));
  prev.setAttribute("aria-label", "Назад");
  prev.disabled = page <= 1;
  prev.onclick = () => onNav(page - 1);

  const label = document.createElement("span");
  label.className = "muted";
  label.style.padding = "0";
  label.textContent = `${page} / ${totalPages}`;

  const next = document.createElement("button");
  next.className = "btn btn-primary page-nav-btn";
  next.appendChild(chevronSvg("right"));
  next.setAttribute("aria-label", "Вперёд");
  next.disabled = page >= totalPages;
  next.onclick = () => onNav(page + 1);

  row.appendChild(prev); row.appendChild(label); row.appendChild(next);
  return row;
}

document.getElementById("add-btn").onclick = async () => {
  const input = document.getElementById("add-input");
  const title = input.value.trim();
  if (!title) return;
  const doAdd = async (finalTitle) => {
    try {
      await api(`/api/${currentCat}/add`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: finalTitle}),
      });
      input.value = "";
      loadList();
    } catch (e) { showToast(e.message); }
  };
  openAddSearchModal(`/api/${currentCat}/search-suggest`, title, {
    onPick: doAdd,
    onFallback: () => doAdd(title),
  });
};
