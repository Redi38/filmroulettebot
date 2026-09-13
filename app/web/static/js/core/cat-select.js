// Two ways to pick a category, both replacing what used to be one side-menu
// entry per category (three spin tabs + "Наугад", five "Список" tabs).
//
// - renderCatChips(): a wrapping row of pills, used above the watchlist where
//   there is full page width to spend. Built out of `.showcase-filter-btn`,
//   the same pill the showcase filters and every dock toggle use, so the
//   typography and the selected-state gradient match the rest of the app.
// - renderCatSelect(): a dropdown, used inside the narrow fixed roulette dock
//   where four or five pills side by side do not fit. Shares its markup and
//   styling with the wheel's sound-theme dropdown next to it.

function renderCatChips(containerId, { options, value, onChange, extraClass }) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // `.showcase-filter-options.segmented` + a `.showcase-filter-thumb` is the
  // same machinery the showcase filters and the wheel's обычный/весовой
  // toggle use — one gradient block that slides to whichever option is
  // active, instead of the colour popping from chip to chip. The thumb is
  // positioned from offsetLeft/offsetTop, so it follows the row even when
  // five categories wrap onto a second line.
  el.className = "cat-select-row showcase-filter-options segmented"
    + (extraClass ? " " + extraClass : "");
  el.setAttribute("role", "tablist");

  const keys = options.map(([val]) => String(val)).join("|");
  // Rebuild only when the set of options actually changed (a category going
  // empty, counts arriving) — otherwise just move the thumb, which is the
  // whole point of keeping the DOM around.
  const sameShape = el.dataset.keys === keys;
  if (!sameShape) {
    el.dataset.keys = keys;
    el.innerHTML = "";
    const thumb = document.createElement("div");
    thumb.className = "showcase-filter-thumb";
    thumb.style.transition = "none"; // do not slide in from 0,0 on first paint
    el.appendChild(thumb);
    for (const [val, label] of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "showcase-filter-btn cat-chip";
      btn.dataset.cat = String(val);
      btn.setAttribute("role", "tab");
      btn.textContent = label;
      el.appendChild(btn);
    }
  }

  let activeBtn = null;
  for (const btn of el.querySelectorAll(".cat-chip")) {
    const val = btn.dataset.cat;
    const isActive = String(value) === val;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.onclick = () => { if (!isActive) onChange(val); };
    if (isActive) activeBtn = btn;
  }

  positionCatChipThumb(el, activeBtn, !sameShape);
}

// Split out so a resize (which can rewrap the row and strand the thumb under
// the wrong chip) can re-measure without rebuilding anything.
function positionCatChipThumb(el, activeBtn, justBuilt) {
  const thumb = el && el.querySelector(".showcase-filter-thumb");
  if (!thumb) return;
  if (!activeBtn) activeBtn = el.querySelector(".cat-chip.active");
  if (!activeBtn) { thumb.style.opacity = "0"; return; }
  thumb.style.opacity = "";
  thumb.style.width = activeBtn.offsetWidth + "px";
  thumb.style.height = activeBtn.offsetHeight + "px";
  thumb.style.transform = `translate(${activeBtn.offsetLeft}px, ${activeBtn.offsetTop}px)`;
  if (justBuilt) {
    void thumb.offsetWidth;
    thumb.style.transition = "";
  }
}

// ---- dropdown ------------------------------------------------------------
const CAT_SELECT_CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

function closeCatSelectMenus(except) {
  document.querySelectorAll(".cat-select-dropdown.open").forEach((dd) => {
    if (dd === except) return;
    dd.classList.remove("open");
    const btn = dd.querySelector(".cat-select-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", () => closeCatSelectMenus());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCatSelectMenus(); });

function renderCatSelect(containerId, { options, value, onChange, label }) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  el.className = "cat-select-wrap";

  const current = options.find(([val]) => String(val) === String(value)) || options[0];
  if (!current) return;

  const dropdown = document.createElement("div");
  dropdown.className = "cat-select-dropdown";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cat-select-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  if (label) btn.title = label;
  btn.innerHTML = `<span class="cat-select-btn-label"></span><span class="cat-select-chevron">${CAT_SELECT_CHEVRON_SVG}</span>`;
  btn.querySelector(".cat-select-btn-label").textContent = current[1];
  btn.onclick = (ev) => {
    ev.stopPropagation();
    const wasOpen = dropdown.classList.contains("open");
    closeCatSelectMenus();
    if (typeof closeSoundThemeMenus === "function") closeSoundThemeMenus();
    if (wasOpen) return;
    dropdown.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
  };

  const menu = document.createElement("div");
  menu.className = "cat-select-menu";
  menu.setAttribute("role", "listbox");
  menu.onclick = (ev) => ev.stopPropagation();

  for (const [val, text] of options) {
    const isActive = String(val) === String(value);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cat-select-item" + (isActive ? " active" : "");
    item.textContent = text;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", isActive ? "true" : "false");
    item.onclick = () => {
      closeCatSelectMenus();
      if (!isActive) onChange(String(val));
    };
    menu.appendChild(item);
  }

  dropdown.appendChild(btn);
  dropdown.appendChild(menu);
  el.appendChild(dropdown);
}
