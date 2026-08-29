// The expandable detail panel under a showcase row: fetches (and caches)
// the full media info on first expand, then renders rating/genres/actors
// and a trailer-or-watch-link button. Split out of row.js.

const _mediaDetailsCache = new Map();

// Wires up infoBtn's click handler to toggle `wrap`'s expanded state and
// lazily fill `detail` with the fetched/cached media details for `item`.
function attachShowcaseDetailToggle(wrap, infoBtn, detail, item) {
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
}

function renderShowcaseDetail(data, item) {
  const rating = data.rating !== "—" ? `${data.rating}/10` : "—";
  let extra = "";
  if (data.runtime && data.runtime !== "—") extra += metaLine("clock", `${escapeHtml(String(data.runtime))} мин.`);
  if (data.seasons) extra += metaLine("layers", `Сезонов: ${escapeHtml(String(data.seasons))}`) + metaLine("film", `Эпизодов: ${escapeHtml(String(data.episodes ?? "—"))}`);

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
      ${metaLine("star", rating)}
      ${extra}
      ${metaLine("tag", escapeHtml(data.genres || "—"))}
      ${metaLine("users", escapeHtml(data.actors || "—"))}
      <div class="overview">${escapeHtml(data.overview || "")}</div>
      ${actionBtn}
    </div>`;
}
