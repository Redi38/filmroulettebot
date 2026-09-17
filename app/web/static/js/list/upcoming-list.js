import { openAddSearchModal } from "../core/add-search.js";
import { api } from "../core/api.js";
import { openCategoryModal } from "../core/modal.js";
import { skeletonListHtml } from "../core/skeleton.js";
import { escapeHtml, fadeIn, fadeOut, placeholderHtml, showToast } from "../core/utils.js";
import { createEditableRow } from "./list-row.js";
import { humanizeShowcaseDate } from "../showcase/date.js";
import { loadShowcase } from "../showcase/showcase.js";

// Upcoming releases list: load, add/delete, and TMDb release-date check flow.

// Raw items from the last successful /api/upcoming fetch, used by
// loadUpcoming() to detect a no-op reload (tab revisit with nothing
// changed in the DB) and skip the fade/rebuild so it doesn't flicker.
let lastUpcomingRaw = null;

function checkUpcomingEmpty(container) {
  if (container.querySelector(".list-row") || container.querySelector(".inline-undo-row")) return;
  container.innerHTML = placeholderHtml("Пока нет ожидаемых тайтлов — добавь то, чего ждёшь, выше 👀", "🕐");
}

export async function loadUpcoming() {
  const container = document.getElementById("up-list-container");
  const isFreshView = container.dataset.loaded !== "1";
  if (isFreshView) {
    container.style.opacity = "1";
    container.innerHTML = skeletonListHtml();
  }
  try {
    const data = await api("/api/upcoming");
    // Same items shape every time ({id, title} pairs in server order), so a
    // plain JSON compare tells a real DB change apart from a no-op revisit
    // — skip the fade/rebuild for the latter so it doesn't flicker for no
    // reason. Only fetched (not decided) up front, since we don't know
    // whether it changed until the response is back.
    const unchanged = !isFreshView
      && lastUpcomingRaw !== null
      && JSON.stringify(data.items) === JSON.stringify(lastUpcomingRaw);
    container.dataset.loaded = "1";
    lastUpcomingRaw = data.items;
    if (unchanged) return;
    // On a fresh view the skeleton was just inserted at full opacity, so
    // there's no stale content to fade out (see loadShowcase() for why
    // fading it here would hide it before it's ever painted).
    if (!isFreshView) await fadeOut(container);
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
        html += `<div class="check-item fade-in" data-title="${escapeHtml(e.title)}">🎬 ${escapeHtml(e.tmdb_title)} — ${escapeHtml(humanizeShowcaseDate(e.release_date))}
          <div class="check-item-action"><button class="btn btn-primary btn-sm" data-up-action="move">Перенести</button>${est}</div></div>`;
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

document.getElementById("up-check-result").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-up-action='move']");
  const item = btn && btn.closest(".check-item");
  if (item) moveUpcoming(item.dataset.title);
});

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
