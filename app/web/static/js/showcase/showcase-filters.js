// Filter-panel helpers shared by the studio showcase, theaters, and
// series-releases tabs: a "type" filter (showcase only) plus the common
// "added to my list" filter (all three tabs).

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
      setLS(storageKey, value);
      onChange(value);
    };
    row.appendChild(btn);
  }
  wrap.appendChild(row);
  return wrap;
}
function loadSimpleAddedFilter(storageKey) {
  return getLS(storageKey, "all");
}
