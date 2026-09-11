// Loading placeholders. Every screen that fetches a list or a card renders
// one of these while the request is in flight, instead of a centred
// "Загрузка…" line: the placeholder occupies the same space the real
// content will, so nothing jumps when the data lands.
//
// Markup only — the shimmer and the shapes live in css/loading.css.

function skelLine(modifier, index) {
  const cls = "skeleton skel-line" + (modifier ? ` skel-line--${modifier}` : "");
  return `<div class="${cls}" style="--skel-i:${index || 0}"></div>`;
}

// Showcase / theaters / series-releases rows: poster, title, date, action.
function skeletonShowcaseHtml(count, withAction) {
  const rows = [];
  for (let i = 0; i < (count || 6); i++) {
    rows.push(`
      <div class="skel-showcase-row" style="--skel-i:${i}">
        <div class="skeleton skel-showcase-poster" style="--skel-i:${i}"></div>
        <div class="skel-showcase-text">
          ${skelLine("title", i)}
          ${skelLine("sub", i)}
        </div>
        ${withAction === false ? "" : `<div class="skeleton skel-showcase-action" style="--skel-i:${i}"></div>`}
      </div>`);
  }
  return `<div class="skel-group">${rows.join("")}</div>`;
}

// Watchlist / upcoming rows: title pill plus the edit and delete buttons.
function skeletonListHtml(count) {
  const rows = [];
  for (let i = 0; i < (count || 8); i++) {
    rows.push(`
      <div class="skel-list-row" style="--skel-i:${i}">
        <div class="skeleton skel-list-title" style="--skel-i:${i}"></div>
        <div class="skeleton skel-list-btn" style="--skel-i:${i}"></div>
        <div class="skeleton skel-list-btn" style="--skel-i:${i}"></div>
      </div>`);
  }
  return `<div class="skel-group">${rows.join("")}</div>`;
}

// A result card: poster block beside title, badge and meta lines.
function skeletonCardHtml() {
  return `
    <div class="skel-card skel-group">
      <div class="skeleton skel-card-poster"></div>
      <div class="skel-card-body">
        ${skelLine("title", 0)}
        ${skelLine("badge", 1)}
        ${skelLine("mid", 2)}
        ${skelLine("mid", 3)}
        ${skelLine("wide", 4)}
        ${skelLine("wide", 5)}
        ${skelLine("mid", 6)}
      </div>
    </div>`;
}

// Rows inside the "pick a title from TMDb" modal.
function skeletonSearchHtml(count) {
  const rows = [];
  for (let i = 0; i < (count || 4); i++) {
    rows.push(`
      <div class="skel-search-row" style="--skel-i:${i}">
        <div class="skeleton skel-search-poster" style="--skel-i:${i}"></div>
        ${skelLine("title", i)}
      </div>`);
  }
  return `<div class="skel-group">${rows.join("")}</div>`;
}

// The expandable detail panel under a showcase row.
function skeletonDetailHtml() {
  return `
    <div class="skel-detail skel-group">
      ${skelLine("sub", 0)}
      ${skelLine("mid", 1)}
      ${skelLine("wide", 2)}
      ${skelLine("wide", 3)}
      ${skelLine("mid", 4)}
    </div>`;
}

// History entries: title, timestamp, and the action buttons.
function skeletonHistoryHtml(count) {
  const rows = [];
  for (let i = 0; i < (count || 5); i++) {
    rows.push(`
      <div class="skel-hist-item" style="--skel-i:${i}">
        ${skelLine("title", i)}
        ${skelLine("sub", i)}
        <div class="skel-hist-actions">
          <div class="skeleton skel-hist-btn" style="--skel-i:${i}"></div>
          <div class="skeleton skel-hist-btn" style="--skel-i:${i}"></div>
        </div>
      </div>`);
  }
  return `<div class="skel-group">${rows.join("")}</div>`;
}

// The roulette wheel while its canvas is being prepared.
function skeletonWheelHtml() {
  return `
    <div class="skel-wheel-wrap">
      <div class="skeleton skel-wheel-title"></div>
      <div class="skeleton skel-wheel-disc"></div>
    </div>`;
}
