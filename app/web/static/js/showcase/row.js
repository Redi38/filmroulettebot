// Shared row/group renderer used by every "list of titles with a poster,
// a date line, and an add/skip/delete action" screen: the studio showcase,
// the theaters tab, series releases, and the user's tracked-series list.
// One rendering function serves all four so their card layout stays
// consistent; addMode/skipScope pick which action(s) a row gets.
//
// The date-line formatting, action-slot buttons, and expandable detail
// panel each live in their own file (date.js, actions.js,
// detail.js) — this file just wires a row's DOM together from
// them. Only showcaseGroup() is used outside this group of files.

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
  const dateLine = showcaseDateLine(item, cat, isNewSeasons, addMode);

  const infoBtn = document.createElement("div");
  infoBtn.className = "showcase-info showcase-info-clickable";
  infoBtn.innerHTML = `
    ${posterHtml}
    <div class="showcase-info-text">
      <div class="showcase-title">${escapeHtml(item.title)}</div>
      <div class="showcase-date">${escapeHtml(dateLine)}</div>
    </div>`;
  row.appendChild(infoBtn);

  row.appendChild(buildShowcaseActionSlot(item, cat, addMode, skipScope, wrap, onSkipSettled));
  wrap.appendChild(row);

  const detail = document.createElement("div");
  detail.className = "showcase-detail";
  wrap.appendChild(detail);

  attachShowcaseDetailToggle(wrap, infoBtn, detail, item);

  return wrap;
}
