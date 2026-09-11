// Upcoming releases list: load, add/delete, and TMDb release-date check flow.

function checkUpcomingEmpty(container) {
  if (container.querySelector(".list-row") || container.querySelector(".inline-undo-row")) return;
  container.innerHTML = placeholderHtml("Пока нет ожидаемых тайтлов — добавь то, чего ждёшь, выше 👀", "🕐");
}

async function loadUpcoming() {
  const container = document.getElementById("up-list-container");
  const isFreshView = container.dataset.loaded !== "1";
  if (isFreshView) {
    container.style.opacity = "1";
    container.innerHTML = skeletonListHtml();
  }
  try {
    const data = await api("/api/upcoming");
    await fadeOut(container);
    container.dataset.loaded = "1";
    if (!data.items.length) {
      container.innerHTML = placeholderHtml("Пока нет ожидаемых тайтлов — добавь то, чего ждёшь, выше 👀", "🕐");
      fadeIn(container);
      return;
    }
    container.innerHTML = "";
    for (const [idx, {id, title}] of data.items.entries()) {
      const row = createEditableRow(title, {
        searchEndpoint: "/api/upcoming/search-suggest",
        onRename: (newTitle) => api("/api/upcoming/rename", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({id, new_title: newTitle}),
        }),
        onDelete: () => api("/api/upcoming/delete", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({id}),
        }),
        onRestore: () => api("/api/upcoming/add", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({title}),
        }),
        onReload: () => loadUpcoming(),
        onUndoSettled: () => checkUpcomingEmpty(container),
      });
      row.style.animationDelay = `${Math.min(idx, 18) * 0.008}s`;
      container.appendChild(row);
    }
    fadeIn(container);
  } catch (e) {
    container.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(container);
  }
}

document.getElementById("up-add-btn").onclick = async () => {
  const input = document.getElementById("up-add-input");
  const title = input.value.trim();
  if (!title) return;
  const doAdd = async (finalTitle) => {
    try {
      await api("/api/upcoming/add", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: finalTitle}),
      });
      input.value = "";
      loadUpcoming();
    } catch (e) { showToast(e.message, "error"); }
  };
  openAddSearchModal("/api/upcoming/search-suggest", title, {
    onPick: doAdd,
    onFallback: () => doAdd(title),
  });
};

document.getElementById("up-check-btn").onclick = async () => {
  const result = document.getElementById("up-check-result");
  if (result.innerHTML) await fadeOut(result);
  result.innerHTML = '<div class="spinner fade-in">Проверяем по базе TMDb…</div>';
  fadeIn(result);
  try {
    const data = await api("/api/upcoming/check", {method: "POST"});
    let html = "";
    html += '<div class="check-group"><h3>✅ Доступны в цифре</h3>';
    if (!data.released.length) {
      html += '<div class="muted">Пока нет</div>';
    } else {
      for (const e of data.released) {
        const est = e.estimated ? '<div class="estimated">(оценочно, точной даты нет)</div>' : "";
        html += `<div class="check-item fade-in" data-title="${escapeAttr(e.title)}">🎬 ${escapeHtml(e.tmdb_title)} — ${escapeHtml(humanizeShowcaseDate(e.release_date))}
          <div class="check-item-action"><button class="btn btn-primary btn-sm" onclick="moveUpcoming('${escapeAttr(e.title)}')">Перенести</button>${est}</div></div>`;
      }
    }
    html += "</div>";
    html += '<div class="check-group"><h3>⏳ Ещё не вышли в цифре</h3>';
    if (!data.not_yet.length) {
      html += '<div class="muted">—</div>';
    } else {
      for (const e of data.not_yet) {
        html += `<div class="check-item fade-in">🕐 ${escapeHtml(e.tmdb_title)} — ${escapeHtml(humanizeShowcaseDate(e.release_date))}</div>`;
      }
    }
    html += "</div>";
    if (data.no_info.length) {
      html += '<div class="check-group"><h3>❓ Нет данных</h3>';
      for (const t of data.no_info) html += `<div class="check-item fade-in">${escapeHtml(t)}</div>`;
      html += "</div>";
    }
    await fadeOut(result);
    result.innerHTML = html;
    fadeIn(result);
  } catch (e) {
    await fadeOut(result);
    result.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
    fadeIn(result);
  }
};

async function moveUpcoming(title) {
  openCategoryModal(`Куда перенести «${title}»?`, async (category) => {
    await api("/api/upcoming/move", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title, category}),
    });
    const item = document.querySelector(`#up-check-result .check-item[data-title="${CSS.escape(title)}"]`);
    if (item) {
      item.style.transition = "opacity .15s ease, transform .15s ease";
      item.style.opacity = "0";
      item.style.transform = "translateX(10px)";
      setTimeout(() => item.remove(), 150);
    }
    loadUpcoming();
  });
}
