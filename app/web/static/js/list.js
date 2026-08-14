let currentListPage = 1;

async function loadList(page) {
  if (page) currentListPage = page;
  else currentListPage = 1;

  document.getElementById("add-row").style.display = "flex";
  const featured = document.getElementById("list-featured");
  const container = document.getElementById("list-container");
  container.innerHTML = '<div class="spinner">Загрузка…</div>';
  featured.innerHTML = "";

  if (currentCat === "marvel" || currentCat === "dc") {
    featured.innerHTML = '<div class="spinner">Загрузка витрины…</div>';
    try {
      const card = await api(`/api/${currentCat}/featured`);
      featured.innerHTML = `<div class="featured-label">🎲 Первый в списке</div>` + renderCard(card, {actions: false});
    } catch {
      featured.innerHTML = "";
    }
  }

  const data = await api(`/api/${currentCat}/items?page=${currentListPage}`);
  if (!data.total_count) {
    container.innerHTML = '<div class="muted">Список пуст</div>';
    return;
  }
  container.innerHTML = "";
  for (const title of data.items) {
    const row = document.createElement("div");
    row.className = "list-row";
    const span = document.createElement("span");
    span.className = "copy-title";
    span.textContent = title;
    span.title = "Нажмите, чтобы скопировать";
    span.onclick = () => copyToClipboard(title, span);
    row.appendChild(span);
    const del = document.createElement("button");
    del.className = "del-btn";
    del.textContent = "🗑";
    del.onclick = async (ev) => {
      ev.stopPropagation();
      await api(`/api/${currentCat}/delete`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title}),
      });
      loadList(currentListPage);
    };
    row.appendChild(del);
    container.appendChild(row);
  }
  if (data.total_pages > 1) container.appendChild(paginationRow(data.page, data.total_pages, (p) => loadList(p)));
}

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
  try {
    await api(`/api/${currentCat}/add`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title}),
    });
    input.value = "";
    loadList();
  } catch (e) { showToast(e.message); }
};

async function loadUpcoming() {
  const container = document.getElementById("up-list-container");
  container.innerHTML = '<div class="spinner">Загрузка…</div>';
  const data = await api("/api/upcoming");
  if (!data.items.length) {
    container.innerHTML = '<div class="muted">Список пуст</div>';
    return;
  }
  container.innerHTML = "";
  for (const title of data.items) {
    const row = document.createElement("div");
    row.className = "list-row";
    const span = document.createElement("span");
    span.className = "copy-title";
    span.textContent = title;
    span.onclick = () => copyToClipboard(title, span);
    row.appendChild(span);
    const del = document.createElement("button");
    del.className = "del-btn";
    del.textContent = "🗑";
    del.onclick = async (ev) => {
      ev.stopPropagation();
      await api("/api/upcoming/delete", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title}),
      });
      loadUpcoming();
    };
    row.appendChild(del);
    container.appendChild(row);
  }
}

document.getElementById("up-add-btn").onclick = async () => {
  const input = document.getElementById("up-add-input");
  const title = input.value.trim();
  if (!title) return;
  try {
    await api("/api/upcoming/add", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title}),
    });
    input.value = "";
    loadUpcoming();
  } catch (e) { showToast(e.message); }
};

document.getElementById("up-check-btn").onclick = async () => {
  const result = document.getElementById("up-check-result");
  result.innerHTML = '<div class="spinner">⏳ Проверяем по базе TMDb…</div>';
  try {
    const data = await api("/api/upcoming/check", {method: "POST"});
    let html = "";
    html += '<div class="check-group"><h3>✅ Доступны в цифре</h3>';
    if (!data.released.length) {
      html += '<div class="muted">Пока нет</div>';
    } else {
      for (const e of data.released) {
        const est = e.estimated ? '<div class="estimated">(оценочно, точной даты нет)</div>' : "";
        html += `<div class="check-item">🎬 ${escapeHtml(e.tmdb_title)} — ${escapeHtml(e.release_date)}
          <button class="btn btn-primary btn-sm" onclick="moveUpcoming('${escapeAttr(e.title)}')">Перенести</button>${est}</div>`;
      }
    }
    html += "</div>";
    html += '<div class="check-group"><h3>⏳ Ещё не вышли</h3>';
    if (!data.not_yet.length) {
      html += '<div class="muted">—</div>';
    } else {
      for (const e of data.not_yet) {
        html += `<div class="check-item">🕐 ${escapeHtml(e.tmdb_title)} — ${escapeHtml(e.release_date)} (${e.days_ago > 0 ? e.days_ago + " дн. назад" : "через " + (-e.days_ago) + " дн."})</div>`;
      }
    }
    html += "</div>";
    if (data.no_info.length) {
      html += '<div class="check-group"><h3>❓ Нет данных</h3>';
      for (const t of data.no_info) html += `<div class="check-item">${escapeHtml(t)}</div>`;
      html += "</div>";
    }
    result.innerHTML = html;
  } catch (e) {
    result.innerHTML = `<div class="muted">❌ ${escapeHtml(e.message)}</div>`;
  }
};

async function moveUpcoming(title) {
  openCategoryModal(`Куда перенести «${title}»?`, async (category) => {
    await api("/api/upcoming/move", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title, category}),
    });
    document.getElementById("up-check-btn").click();
    loadUpcoming();
  });
}
