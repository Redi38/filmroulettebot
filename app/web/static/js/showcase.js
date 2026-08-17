let currentShowcaseStudio = null;

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
    await fadeOut(container);
    container.innerHTML = "";
    if (!data.upcoming.length && !data.released.length) {
      container.innerHTML = placeholderHtml("Пока нет данных о новых релизах — загляни попозже", "🎬");
      fadeIn(container);
      return;
    }
    if (data.new_seasons && data.new_seasons.length) {
      container.appendChild(showcaseGroup("🔔 Новые сезоны твоих сериалов", data.new_seasons, cat, true));
    }
    container.appendChild(showcaseGroup("⏳ Скоро выйдет", data.upcoming, cat));
    container.appendChild(showcaseGroup("✅ Уже вышло", data.released, cat));
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
