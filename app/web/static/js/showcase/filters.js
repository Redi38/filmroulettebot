// Filter-panel widgets shared by the studio showcase, the theaters tab and
// the series-premieres tab.
const COLLAPSE_MQ = "(max-width: 899px)";
const COLLAPSE_MS = 280;

function matches(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function setPanelOpen(panel, head, open) {
  const body = panel.querySelector(":scope > .filter-panel-body");
  const inner = body && body.querySelector(":scope > .filter-panel-inner");
  head.setAttribute("aria-expanded", open ? "true" : "false");

  if (!body || !inner || !matches(COLLAPSE_MQ) || matches("(prefers-reduced-motion: reduce)")) {
    clearTimeout(body && body._collapseTimer);
    if (body) body.style.height = "";
    panel.classList.toggle("open", open);
    return;
  }

  // The starting height has to be read, and pinned inline, *before* the class
  // flips: `.open` alone snaps the body to `auto` (or back to 0), so measuring
  // afterwards gave from === to and the panel jumped instead of sliding.
  const from = body.getBoundingClientRect().height;
  body.style.height = `${from}px`;
  panel.classList.toggle("open", open);
  const to = open ? inner.getBoundingClientRect().height : 0;
  void body.offsetHeight;
  body.style.height = `${to}px`;

  clearTimeout(body._collapseTimer);
  body._collapseTimer = setTimeout(() => {
    body.style.height = "";
  }, COLLAPSE_MS);
}

export function filterPanelBody(panel) {
  const existing = panel.querySelector(":scope > .filter-panel-body > .filter-panel-inner");
  if (existing) return existing;

  panel.classList.add("filter-panel-collapsible");
  const head = document.createElement("button");
  head.type = "button";
  head.className = "filter-panel-toggle";
  head.innerHTML = `
    <span class="filter-panel-toggle-label">Фильтры</span>
    <span class="filter-panel-count" hidden></span>
    <svg class="filter-panel-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`;
  head.setAttribute("aria-expanded", "false");
  const body = document.createElement("div");
  body.className = "filter-panel-body";
  const inner = document.createElement("div");
  inner.className = "filter-panel-inner";
  body.appendChild(inner);
  head.onclick = () => {
    const open = !panel.classList.contains("open");
    setPanelOpen(panel, head, open);
    if (open) refreshThumbs(panel);
  };
  panel.appendChild(head);
  panel.appendChild(body);
  return inner;
}

// The count badge is the only thing telling someone on a phone that the
// list they're looking at is filtered at all, since the collapsed panel
// hides the active pills.
export function setFilterPanelCount(panel, count) {
  const badge = panel.querySelector(".filter-panel-count");
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = count ? String(count) : "";
  panel.classList.toggle("has-active-filters", !!count);
}

// Re-seat every segmented pill from its active button's current geometry.
// Also used after a viewport change would invalidate the cached position.
function refreshThumbs(panel) {
  for (const row of panel.querySelectorAll(".showcase-filter-options.segmented")) {
    const thumb = row.querySelector(".showcase-filter-thumb");
    const active = row.querySelector(".showcase-filter-btn.active");
    if (!thumb) continue;
    if (!active) continue;
    const prev = thumb.style.transition;
    thumb.style.transition = "none";
    thumb.style.width = active.offsetWidth + "px";
    thumb.style.height = active.offsetHeight + "px";
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    void thumb.offsetWidth;
    thumb.style.transition = prev;
  }
}

function ensureGroup(panel, filterKey, title, className) {
  const body = filterPanelBody(panel);
  let wrap = body.querySelector(`[data-filter-key="${filterKey}"]`);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = `showcase-filter-group${className ? " " + className : ""}`;
    wrap.dataset.filterKey = filterKey;
    if (title) {
      const h4 = document.createElement("h4");
      h4.textContent = title;
      wrap.appendChild(h4);
    }
    const row = document.createElement("div");
    row.className = "showcase-filter-options";
    wrap.appendChild(row);
    body.appendChild(wrap);
  }
  return wrap;
}

// A segmented single-choice row (Тип / Показывать / Когда / Сортировка...).
export function segmentedGroup(panel, filterKey, title, options, currentValue, onClick) {
  const wrap = ensureGroup(panel, filterKey, title);
  const row = wrap.querySelector(".showcase-filter-options");
  row.classList.add("segmented");

  const keys = options.map(([v]) => String(v));
  const sameShape = row.dataset.keys === keys.join("|");
  if (!sameShape) {
    row.innerHTML = "";
    row.dataset.keys = keys.join("|");
    const thumb = document.createElement("div");
    thumb.className = "showcase-filter-thumb";
    thumb.style.transition = "none";
    row.appendChild(thumb);
    for (const [, label] of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "showcase-filter-btn";
      btn.textContent = label;
      row.appendChild(btn);
    }
  }

  const buttons = row.querySelectorAll(".showcase-filter-btn");
  let activeBtn = buttons[0];
  options.forEach(([value], i) => {
    const isActive = currentValue === value;
    buttons[i].classList.toggle("active", isActive);
    buttons[i].onclick = () => { if (currentValue !== value) onClick(value); };
    if (isActive) activeBtn = buttons[i];
  });

  const thumb = row.querySelector(".showcase-filter-thumb");
  if (activeBtn && thumb) {
    thumb.style.width = activeBtn.offsetWidth + "px";
    thumb.style.height = activeBtn.offsetHeight + "px";
    thumb.style.transform = `translate(${activeBtn.offsetLeft}px, ${activeBtn.offsetTop}px)`;
    if (!sameShape) {
      void thumb.offsetWidth;
      thumb.style.transition = "";
    }
  }
}

export function togglesGroup(panel, filterKey, title, toggles) {
  const wrap = ensureGroup(panel, filterKey, title, "showcase-filter-group-toggle");
  const row = wrap.querySelector(".showcase-filter-options");

  const keys = toggles.map((t) => t.key).join("|");
  if (row.dataset.keys !== keys) {
    row.dataset.keys = keys;
    row.innerHTML = "";
    for (const toggle of toggles) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "showcase-filter-btn";
      btn.dataset.toggleKey = toggle.key;
      btn.addEventListener("animationend", (ev) => {
        if (ev.animationName === "fxTogglePop") btn.classList.remove("fx-toggle-pop");
      });
      row.appendChild(btn);
    }
  }

  for (const toggle of toggles) {
    const btn = row.querySelector(`[data-toggle-key="${toggle.key}"]`);
    btn.textContent = toggle.label;
    btn.classList.toggle("active", !!toggle.active);
    btn.disabled = !!toggle.disabled;
    btn.onclick = () => {
      btn.classList.remove("fx-toggle-pop");
      void btn.offsetWidth;
      btn.classList.add("fx-toggle-pop");
      toggle.onToggle(!toggle.active);
    };
  }
}

export const ADDED_OPTIONS = [["all", "Все"], ["hide", "Не добавленные"], ["only", "Уже добавленные"]];
export const TYPE_OPTIONS = [["all", "Все"], ["movie", "Фильмы"], ["series", "Сериалы"]];
export const SERIES_STATUS_OPTIONS = [
  ["all", "Все"], ["new_series", "Новые сериалы"], ["new_season", "Новые сезоны"], ["airing", "Уже выходят"],
];
export const DIGITAL_OPTIONS = [["all", "Все"], ["digital", "Уже в цифре"], ["cinema", "Только в кино"]];
