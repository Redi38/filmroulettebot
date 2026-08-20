// Filter-panel helpers shared by the studio showcase, theaters, and
// series-releases tabs: a "type" filter (showcase only) plus the common
// "added to my list" filter (all three tabs).

const SHOWCASE_FILTER_KEY = "filmroulette_showcase_filters";
function loadShowcaseFilters() {
  try {
    const raw = localStorage.getItem(SHOWCASE_FILTER_KEY);
    if (!raw) return {type: "all", added: "all"};
    const f = JSON.parse(raw);
    return {type: f.type || "all", added: f.added || "all"};
  } catch { return {type: "all", added: "all"}; }
}
function saveShowcaseFilters() {
  try { localStorage.setItem(SHOWCASE_FILTER_KEY, JSON.stringify(showcaseFilters)); } catch {}
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

function showcaseFilterGroup(title, options, key) {
  const wrap = document.createElement("div");
  wrap.className = "showcase-filter-group";
  const h4 = document.createElement("h4");
  h4.textContent = title;
  wrap.appendChild(h4);
  const row = document.createElement("div");
  row.className = "showcase-filter-options";
  for (const [value, label] of options) {
    const btn = document.createElement("button");
    btn.className = "showcase-filter-btn" + (showcaseFilters[key] === value ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => {
      showcaseFilters[key] = value;
      saveShowcaseFilters();
      renderShowcaseFilters();
      renderShowcaseContent();
    };
    row.appendChild(btn);
  }
  wrap.appendChild(row);
  return wrap;
}

function simpleAddedFilterGroup(storageKey, currentValue, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "showcase-filter-group";
  const h4 = document.createElement("h4");
  h4.textContent = "Показывать";
  wrap.appendChild(h4);
  const row = document.createElement("div");
  row.className = "showcase-filter-options";
  for (const [value, label] of [["all", "Все"], ["hide", "Не добавленные"], ["only", "Уже добавленные"]]) {
    const btn = document.createElement("button");
    btn.className = "showcase-filter-btn" + (currentValue === value ? " active" : "");
    btn.textContent = label;
    btn.onclick = () => {
      try { localStorage.setItem(storageKey, value); } catch {}
      onChange(value);
    };
    row.appendChild(btn);
  }
  wrap.appendChild(row);
  return wrap;
}
function loadSimpleAddedFilter(storageKey) {
  try { return localStorage.getItem(storageKey) || "all"; } catch { return "all"; }
}
