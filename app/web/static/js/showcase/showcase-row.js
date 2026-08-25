// Shared row/group renderer used by every "list of titles with a poster,
// a date line, and an add/skip/delete action" screen: the studio showcase,
// the theaters tab, series releases, and the user's tracked-series list.
// One rendering function serves all four so their card layout stays
// consistent; addMode/skipScope pick which action(s) a row gets.

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
  const dateLine = addMode === "tracked-series"
    ? (item.status === "not_found"
        ? "⚠️ Не найдено на TMDb"
        : item.status === "no_upcoming"
        ? "Нет анонса нового сезона"
        : item.is_new_season
        ? `🆕 Новый сезон — ${item.release_date}`
        : item.airing_now
        ? `📅 Сезон выходит — финал ${item.release_date}`
        : item.release_date)
    : isNewSeasons && item.next_season
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
  if (addMode === "tracked-series") {
    const del = document.createElement("button");
    del.className = "del-btn";
    del.innerHTML = TRASH_ICON_SVG;
    del.onclick = (ev) => {
      ev.stopPropagation();
      const rowParent = wrap.parentNode;
      const rowNext = wrap.nextSibling;
      removeRowOptimistically(wrap, () => api("/api/tracked-series/delete", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: item.title}),
      }), () => {
        showInlineUndo(rowParent, rowNext, `«${item.title}» больше не отслеживается`, "Отменить", async () => {
          try {
            await api("/api/tracked-series/add", {
              method: "POST", headers: {"Content-Type": "application/json"},
              body: JSON.stringify({title: item.title}),
            });
            if (onSkipSettled) onSkipSettled();
          } catch (e) {
            showToast("Не удалось восстановить");
          }
        });
      });
    };
    actionSlot.appendChild(del);
  } else if (item.in_list) {
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
