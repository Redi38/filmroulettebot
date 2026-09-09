// Filter-panel helpers shared by the studio showcase, theaters, and
// series-releases tabs: a "type" filter (showcase only) plus the common
// "added to my list" filter (all three tabs). Groups keep their DOM
// across re-renders (keyed by data-filter-key) so the active-option
// pill can slide between buttons instead of popping on every rebuild —
// same technique as the spin-mode segmented toggle.

const SHOWCASE_FILTER_KEY = "filmroulette_showcase_filters";
function loadShowcaseFilters() {
  const f = getLSJSON(SHOWCASE_FILTER_KEY, null);
  if (!f) return {type: "all", added: "all"};
  return {type: f.type || "all", added: f.added || "all"};
}
function saveShowcaseFilters() {
  setLSJSON(SHOWCASE_FILTER_KEY, showcaseFilters);
}
let showcaseFilters = loadShowcaseFilters();

function showcaseTypeMatches(item) {
  if (showcaseFilters.type === "movie") return !item.is_series;
  if (showcaseFilters.type === "series") return !!item.is_series;
  return true;
}
function showcaseAddedMatches(item) {
  if (showcaseFilters.added === "hide") return !item.in_list;
  if (showcaseFilters.added === "only") return !!item.in_list;
  return true;
}

function renderFilterOptionsRow(panel, filterKey, title, options, currentValue, onClick) {
  let wrap = panel.querySelector(`[data-filter-key="${filterKey}"]`);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "showcase-filter-group";
    wrap.dataset.filterKey = filterKey;
    const h4 = document.createElement("h4");
    h4.textContent = title;
    wrap.appendChild(h4);
    const row = document.createElement("div");
    row.className = "showcase-filter-options segmented";
    wrap.appendChild(row);
    panel.appendChild(wrap);
  }
  const row = wrap.querySelector(".showcase-filter-options");

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

function showcaseFilterGroup(panel, title, options, key) {
  renderFilterOptionsRow(panel, "showcase-" + key, title, options, showcaseFilters[key], (value) => {
    showcaseFilters[key] = value;
    saveShowcaseFilters();
    renderShowcaseFilters();
    renderShowcaseContent();
  });
}

function simpleAddedFilterGroup(panel, storageKey, currentValue, onChange) {
  renderFilterOptionsRow(panel, "added-" + storageKey, "Показывать",
    [["all", "Все"], ["hide", "Не добавленные"], ["only", "Уже добавленные"]], currentValue, (value) => {
      setLS(storageKey, value);
      onChange(value);
    });
}
function loadSimpleAddedFilter(storageKey) {
  return getLS(storageKey, "all");
}
