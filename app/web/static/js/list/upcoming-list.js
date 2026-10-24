import { openAddSearchModal } from "../core/add-search.js";
import { api, apiPost } from "../core/api.js";
import { CHECK_CIRCLE_ICON_SVG, HELP_CIRCLE_ICON_SVG, HOURGLASS_ICON_SVG } from "../core/icons.js";
import { openCategoryModal } from "../core/modal.js";
import { skeletonListHtml } from "../core/skeleton.js";
import { showToast } from "../core/toast.js";
import { fadeIn, fadeOut } from "../core/transitions.js";
import { escapeHtml, placeholderHtml } from "../core/utils.js";
import { showLoadError, showSkeleton } from "../core/view-load.js";
import { createEditableRow, NO_POSTER_HTML } from "./list-row.js";
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
    showSkeleton(container, skeletonListHtml());
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
    for (const [idx, {id, title, poster_url, no_poster}] of data.items.entries()) {
      const row = createEditableRow(title, {
        number: idx + 1,
        posterUrl: poster_url,
        noPoster: no_poster,
        showPosterSlot: true,
        searchEndpoint: "/api/upcoming/search-suggest",
        onRename: (newTitle) => apiPost("/api/upcoming/rename", {id, new_title: newTitle}),
        onDelete: () => apiPost("/api/upcoming/delete", {id}),
        onRestore: () => apiPost("/api/upcoming/add", {title}),
        onReload: () => loadUpcoming(),
        onUndoSettled: () => checkUpcomingEmpty(container),
      });
      row.style.animationDelay = `${Math.min(idx, 18) * 0.008}s`;
      container.appendChild(row);
    }
    fadeIn(container);
  } catch (e) {
    showLoadError(container, e);
  }
}

document.getElementById("up-add-btn").onclick = async () => {
  const input = document.getElementById("up-add-input");
  const title = input.value.trim();
  if (!title) return;
  const doAdd = async (finalTitle) => {
    try {
      await apiPost("/api/upcoming/add", {title: finalTitle});
      input.value = "";
      loadUpcoming();
    } catch (e) { showToast(e.message, "error"); }
  };
  openAddSearchModal("/api/upcoming/search-suggest", title, {
    onPick: doAdd,
    onFallback: () => doAdd(title),
  });
};

const RU_MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

// Chronological by release date; ties fall back to title so the order is stable.
function byDate(a, b, dir = 1) {
  return dir * (a.release_date || "").localeCompare(b.release_date || "")
    || a.tmdb_title.localeCompare(b.tmdb_title, "ru");
}

function daysFromToday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function monthLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const label = RU_MONTHS_NOM[d.getMonth()];
  return d.getFullYear() === new Date().getFullYear() ? label : `${label} ${d.getFullYear()}`;
}

function checkGroupHtml(icon, title, count, body, extraClass = "") {
  const badge = count ? `<span class="check-count">${count}</span>` : "";
  return `<div class="check-group ${extraClass}"><h3>${icon}<span>${title}</span>${badge}</h3>${body}</div>`;
}

function dateChipHtml(dateStr, estimated) {
  const diff = daysFromToday(dateStr);
  const tone = diff < 0 ? "is-past" : diff <= 14 ? "is-soon" : "";
  const text = humanizeShowcaseDate(dateStr);
  const mark = estimated ? '<span class="check-est" title="Точной даты цифры нет — оценка">≈</span>' : "";
  return `<span class="check-date ${tone}">${mark}${escapeHtml(text)}</span>`;
}

function checkRowHtml(e, {action = false} = {}) {
  const btn = action ? '<button class="btn btn-primary btn-sm" data-up-action="move">Перенести</button>' : "";
  const own = e.tmdb_title !== e.title
    ? `<span class="check-sub">в списке: ${escapeHtml(e.title)}</span>` : "";
  const poster = e.poster_url
    ? `<img class="list-row-poster" src="${escapeHtml(e.poster_url)}" alt="" width="36" height="54" loading="lazy" decoding="async">`
    : NO_POSTER_HTML; // straight from TMDb's own result, so no poster here means TMDb has none
  return `<div class="check-item fade-in" data-title="${escapeHtml(e.title)}">
    ${poster}<div class="check-main"><span class="check-title">${escapeHtml(e.tmdb_title)}</span>${own}</div>
    <div class="check-item-action">${dateChipHtml(e.release_date, e.estimated)}${btn}</div></div>`;
}

// not_yet is split in two: already in cinemas (theatrical date passed, digital
// still pending) first, then future releases grouped under month headers.
function notYetHtml(items) {
  if (!items.length) return '<div class="muted">—</div>';
  const inCinemas = items.filter((e) => daysFromToday(e.release_date) < 0).sort(byDate);
  const upcoming = items.filter((e) => daysFromToday(e.release_date) >= 0).sort(byDate);
  let html = "";
  if (inCinemas.length) {
    html += '<div class="check-sublabel">Уже в кино, ждём цифру</div>';
    html += inCinemas.map((e) => checkRowHtml(e)).join("");
  }
  let lastMonth = "";
  for (const e of upcoming) {
    const m = monthLabel(e.release_date);
    if (m !== lastMonth) {
      html += `<div class="check-sublabel">${escapeHtml(m)}</div>`;
      lastMonth = m;
    }
    html += checkRowHtml(e);
  }
  return html;
}

document.getElementById("up-check-btn").onclick = async () => {
  const result = document.getElementById("up-check-result");
  if (result.innerHTML) await fadeOut(result);
  result.innerHTML = '<div class="spinner fade-in">Проверяем по базе TMDb…</div>';
  fadeIn(result);
  try {
    const data = await apiPost("/api/upcoming/check");
    const released = [...data.released].sort((a, b) => byDate(a, b, -1));
    const noInfo = [...data.no_info].sort((a, b) => a.localeCompare(b, "ru"));
    let html = "";
    if (released.length) {
      html += checkGroupHtml(CHECK_CIRCLE_ICON_SVG, "Доступны в цифре", released.length,
        released.map((e) => checkRowHtml(e, {action: true})).join(""), "check-group-ready");
    }
    html += checkGroupHtml(HOURGLASS_ICON_SVG, "Ещё не вышли в цифре", data.not_yet.length, notYetHtml(data.not_yet));
    if (noInfo.length) {
      html += checkGroupHtml(HELP_CIRCLE_ICON_SVG, "Нет данных", noInfo.length,
        noInfo.map((t) => `<div class="check-item fade-in"><span class="check-title">${escapeHtml(t)}</span></div>`).join(""),
        "check-group-muted");
    }
    await fadeOut(result);
    result.innerHTML = html;
    fadeIn(result);
  } catch (e) {
    await fadeOut(result);
    showLoadError(result, e);
  }
};

document.getElementById("up-check-result").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-up-action='move']");
  const item = btn && btn.closest(".check-item");
  if (item) moveUpcoming(item.dataset.title);
});

async function moveUpcoming(title) {
  openCategoryModal(`Куда перенести «${title}»?`, async (category) => {
    await apiPost("/api/upcoming/move", {title, category});
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
