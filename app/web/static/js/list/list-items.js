// List rendering for every category: load, search, pagination, add/delete.
//
// There is one list screen rather than one per category — the chip row at the
// top of it is what switches between Фильмы / Сериалы / Marvel / DC / …

let currentListPage = 1;
let currentListCat = null;
let currentListQuery = "";

function renderListCatChips() {
  // Labels only. The counts used to ride along here, but they come from
  // /api/categories, which resolves after the first render — so on a reload
  // the chips drew bare and stayed that way, and the number looked like it
  // came and went at random. The count for the category you are actually
  // looking at is already on the line below the search box.
  renderCatChips("list-cat-select", {
    options: listCats().map((code) => [code, LIST_CATS[code] || code]),
    value: currentCat,
    onChange: (code) => switchListCat(code),
  });
}

// Rewrapping the chip row (five categories, narrow screen) moves the chips
// out from under the sliding thumb, so re-measure it after a resize.
window.addEventListener("resize", debounce(() => {
  if (currentView !== "list") return;
  positionCatChipThumb(document.getElementById("list-cat-select"), null, false);
}, 150));

async function loadList(page) {
  if (page) currentListPage = page;
  else currentListPage = 1;

  renderListCatChips();
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
    container.innerHTML = skeletonListHtml();
    featured.style.opacity = "1";
    featured.innerHTML = "";
    const countElReset = document.getElementById("list-count");
    if (countElReset) countElReset.textContent = "";
  }

  const isFeaturedCat = currentCat === "marvel" || currentCat === "dc";
  const featuredPromise = (isFeaturedCat && isFreshView)
    ? api(`/api/${currentCat}/featured`).catch(() => null)
    : Promise.resolve(null);
  const q = currentListQuery.trim();
  const itemsPromise = api(`/api/${currentCat}/items?page=${currentListPage}&q=${encodeURIComponent(q)}`);

  if (isFeaturedCat && isFreshView) {
    featured.innerHTML = skeletonCardHtml();
  }

  // Kick the fade-out off alongside the fetch instead of after it resolves:
  // fadeOut() only depends on the container already on screen, not on the
  // response, so there's no reason to pay its ~100-400ms after the network
  // round trip when it can run *during* it. On a slow connection the fetch
  // is still the bottleneck and this costs nothing; on a fast one (or a
  // cache hit) the fade is what used to make the screen feel sluggish.
  const containerFadeOutPromise = fadeOut(container);
  const featuredFadeOutPromise = (isFeaturedCat && isFreshView) ? fadeOut(featured) : Promise.resolve();

  try {
    const [featuredCard, data] = await Promise.all([
      featuredPromise, itemsPromise, containerFadeOutPromise, featuredFadeOutPromise,
    ]);

    if (isFeaturedCat && isFreshView) {
      featured.innerHTML = featuredCard
        ? `<div class="featured-label">🎲 Первый в списке</div>` + renderCard(featuredCard, {actions: false})
        : "";
      fadeIn(featured);
    } else if (!isFeaturedCat && featured.innerHTML) {
      featured.innerHTML = "";
    }

    // Keep the cached counts (and therefore the chips, and therefore which
    // categories the roulette offers) honest after an add or a delete.
    // The roulette picker drops categories that have nothing left in them,
    // so its idea of the counts has to keep up with adds and deletes.
    if (!q && categoryCounts && categoryCounts[currentCat] !== data.total_count) {
      categoryCounts[currentCat] = data.total_count;
      if (typeof renderSpinCatChips === "function") renderSpinCatChips();
    }
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
    const canReorder = !q; // filtered view skips a title's real neighbours, so
                           // "up"/"down" here wouldn't mean what it looks like
    for (const [idx, {id, title, poster_url}] of data.items.entries()) {
      const cat = currentCat;
      const row = createEditableRow(title, {
        posterUrl: poster_url,
        showPosterSlot: true,
        searchEndpoint: `/api/${cat}/search-suggest`,
        onRename: (newTitle, suggestion) => api(`/api/${cat}/rename`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            id, new_title: newTitle,
            ...(suggestion ? {tmdb_id: suggestion.tmdb_id, is_series: suggestion.is_series} : {}),
          }),
        }),
        onDelete: () => api(`/api/${cat}/delete`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({id}),
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
        onMoveUp: canReorder ? () => moveListItem(cat, id, "up", data.page, idx, data.total_pages, data.items.length) : undefined,
        onMoveDown: canReorder ? () => moveListItem(cat, id, "down", data.page, idx, data.total_pages, data.items.length) : undefined,
        canMoveUp: canReorder && !(data.page === 1 && idx === 0),
        canMoveDown: canReorder && !(data.page === data.total_pages && idx === data.items.length - 1),
      });
      row.style.setProperty("--row-i", Math.min(idx, 6));
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
  if (currentListPage > 1) {
    loadList(currentListPage - 1);
    return;
  }
  const q = currentListQuery.trim();
  container.innerHTML = q
    ? placeholderHtml(`Ничего не найдено по «${escapeHtml(q)}»`, "🔍")
    : placeholderHtml("Пока здесь пусто — добавь первый тайтл выше 🍿", "📭");
}

async function moveListItem(cat, id, direction, page, idx, totalPages, itemsOnPage) {
  // The swap happens against the item's neighbour in the FULL list, not
  // just this page (see move_item() server-side) — so moving the first
  // row on a page "up" pulls it onto the end of the previous page, and
  // moving the last row "down" pushes it onto the start of the next one.
  // Follow it there instead of re-showing this page with a gap.
  let targetPage = page;
  if (direction === "up" && idx === 0 && page > 1) targetPage = page - 1;
  if (direction === "down" && idx === itemsOnPage - 1 && page < totalPages) targetPage = page + 1;
  try {
    await api(`/api/${cat}/reorder`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({id, direction}),
    });
    if (currentCat === cat) loadList(targetPage);
  } catch (e) { showToast(e.message); }
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
  row.className = "pagination-row";

  const navigate = (targetPage, dir) => {
    setNavDirection(row.parentNode, dir);
    onNav(targetPage);
  };

  const prev = document.createElement("button");
  prev.className = "btn btn-primary page-nav-btn";
  prev.appendChild(chevronSvg("left"));
  prev.setAttribute("aria-label", "Назад");
  prev.disabled = page <= 1;
  prev.onclick = () => navigate(page - 1, -1);

  const label = document.createElement("span");
  label.className = "muted";
  label.textContent = `${page} / ${totalPages}`;

  const next = document.createElement("button");
  next.className = "btn btn-primary page-nav-btn";
  next.appendChild(chevronSvg("right"));
  next.setAttribute("aria-label", "Вперёд");
  next.disabled = page >= totalPages;
  next.onclick = () => navigate(page + 1, 1);

  row.appendChild(prev); row.appendChild(label); row.appendChild(next);
  return row;
}

async function handleAddTitle() {
  const input = document.getElementById("add-input");
  const title = input.value.trim();
  if (!title) return;
  const doAdd = async (finalTitle, suggestion) => {
    try {
      await api(`/api/${currentCat}/add`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          title: finalTitle,
          ...(suggestion ? {tmdb_id: suggestion.tmdb_id, is_series: suggestion.is_series} : {}),
        }),
      });
      input.value = "";
      loadList(currentListPage);
    } catch (e) { showToast(e.message, "error"); }
  };
  openAddSearchModal(`/api/${currentCat}/search-suggest`, title, {
    onPick: doAdd,
    onFallback: () => doAdd(title),
  });
}

document.getElementById("add-btn").onclick = handleAddTitle;

document.getElementById("add-input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    handleAddTitle();
  }
});
