// Shared "pick from TMDb" modal for add-a-title flows: list-items.js,
// upcoming-list.js, and the tracked-series add button in showcase.js all
// call openAddSearchModal() instead of adding the typed text straight away.

async function openAddSearchModal(searchEndpoint, query, {onPick, onFallback}) {
  const overlay = document.getElementById("add-search-overlay");
  const resultsEl = document.getElementById("add-search-results");
  const fallbackBtn = document.getElementById("add-search-fallback");
  const fallbackLabel = document.getElementById("add-search-fallback-label");

  fallbackLabel.textContent = `Добавить «${query}» как есть`;
  resultsEl.innerHTML = '<div class="spinner">Ищем на TMDb…</div>';
  overlay.classList.add("open");

  const close = () => {
    overlay.classList.remove("open");
    fallbackBtn.onclick = null;
    overlay.onclick = null;
    document.removeEventListener("keydown", onKeydown);
  };
  const onKeydown = (ev) => { if (ev.key === "Escape") close(); };
  fallbackBtn.onclick = () => { close(); onFallback(); };
  overlay.onclick = (ev) => { if (ev.target === overlay) close(); };
  document.getElementById("add-search-cancel").onclick = close;
  document.addEventListener("keydown", onKeydown);

  try {
    const data = await api(`${searchEndpoint}?q=${encodeURIComponent(query)}`);
    if (!data.results || !data.results.length) {
      resultsEl.innerHTML = '<div class="muted add-search-empty">Ничего не нашлось на TMDb — можно добавить вручную ниже.</div>';
      return;
    }
    resultsEl.innerHTML = "";
    for (const r of data.results) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "add-search-row";
      const poster = r.poster_url
        ? `<img class="add-search-poster" src="${r.poster_url}" alt="">`
        : `<div class="add-search-poster add-search-poster-empty"></div>`;
      row.innerHTML = `${poster}<span class="add-search-row-title">${escapeHtml(r.title)}${r.year ? ` <span class="add-search-year">(${escapeHtml(r.year)})</span>` : ""}</span>`;
      row.onclick = () => { close(); onPick(r.title); };
      resultsEl.appendChild(row);
    }
  } catch (e) {
    resultsEl.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
  }
}
