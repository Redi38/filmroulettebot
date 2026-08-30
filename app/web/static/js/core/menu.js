const sideMenu = document.getElementById("side-menu");
const sideMenuScroll = document.getElementById("side-menu-scroll");
const overlay = document.getElementById("overlay");

const MENU_LABELS = {movies: "Фильмы", cartoons: "Мульты", series: "Сериалы"};
const REF_MENU_LABELS = {marvel: "Marvel", dc: "DC"};

(async () => {
  let data;
  try {
    data = await api("/api/categories");
  } catch (e) {
    return;
  }
  let changed = false;
  for (const labels of [MENU_LABELS, REF_MENU_LABELS]) {
    for (const code of Object.keys(labels)) {
      const label = data[code] && data[code].short_label;
      if (label && labels[code] !== label) { labels[code] = label; changed = true; }
    }
  }
  if (changed) renderMenu();
})();

const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"></path><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"></path></svg>`,
  shuffle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>`,
  movies: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"></rect><line x1="7" y1="3" x2="7" y2="21"></line><line x1="17" y1="3" x2="17" y2="21"></line><line x1="2" y1="8" x2="7" y2="8"></line><line x1="2" y1="16" x2="7" y2="16"></line><line x1="17" y1="8" x2="22" y2="8"></line><line x1="17" y1="16" x2="22" y2="16"></line></svg>`,
  cartoons: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>`,
  series: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>`,
  premiere: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.36 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.36 12 2"></polygon></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`,
  marvel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="12" x2="12" y2="3"></line><line x1="12" y1="12" x2="19.8" y2="7.5"></line><line x1="12" y1="12" x2="19.8" y2="16.5"></line><line x1="12" y1="12" x2="12" y2="21"></line><line x1="12" y1="12" x2="4.2" y2="16.5"></line><line x1="12" y1="12" x2="4.2" y2="7.5"></line><polygon points="12 7 16.3 9.5 16.3 14.5 12 17 7.7 14.5 7.7 9.5"></polygon><polygon points="12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5"></polygon></svg>`,
  dc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12L5 8L8 11L12 7L16 11L19 8L23 12L19 16L16 13L12 17L8 13L5 16Z"></path></svg>`,
  upcoming: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 3 21 21 21 21 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`,
  theaters: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
};

function renderMenu() {
  sideMenuScroll.innerHTML = "";
  const addItem = (icon, label, onClick, active, sub) => {
    const b = document.createElement("button");
    b.className = "menu-item" + (sub ? " sub" : "") + (active ? " active" : "");
    b.innerHTML = `${icon ? ICONS[icon] : ""}<span>${label}</span>`;
    b.onclick = () => { onClick(); closeMenu(); };
    sideMenuScroll.appendChild(b);
  };
  const addGroup = (label) => {
    const h = document.createElement("div");
    h.className = "menu-group-label";
    h.textContent = label;
    sideMenuScroll.appendChild(h);
  };

  addGroup("Главное");
  addItem("home", "Афиша", () => switchView("home"), currentView === "home");
  addItem("shuffle", "Наугад", () => switchView("random"), currentView === "random");

  addGroup("Кино и сериалы");
  addItem("theaters", "В прокате", () => switchView("theaters"), currentView === "theaters");
  addItem("premiere", "Премьеры сериалов", () => switchView("series_releases"), currentView === "series_releases");
  addItem("bell", "Отслеживание сериалов", () => switchView("tracked_series"), currentView === "tracked_series");

  addGroup("Рулетка по категориям");
  for (const [code, label] of Object.entries(MENU_LABELS)) {
    addItem(code, label, () => switchCat(code, "spin"), currentView === "spin" && currentCat === code);
    addItem("list", "Список", () => switchCat(code, "list"), currentView === "list" && currentCat === code, true);
  }

  addGroup("Подборки");
  for (const [code, label] of Object.entries(REF_MENU_LABELS)) {
    addItem(code, label, () => switchCat(code, "showcase"), currentView === "showcase" && currentCat === code);
    addItem("list", "Список", () => switchCat(code, "list"), currentView === "list" && currentCat === code, true);
  }

  addGroup("Прочее");
  addItem("upcoming", "Ожидаемые", () => switchView("upcoming"), currentView === "upcoming");
  addItem("history", "История", () => switchView("history"), currentView === "history");
}

function openMenu() { sideMenu.classList.add("open"); overlay.classList.add("open"); }
function closeMenu() { sideMenu.classList.remove("open"); overlay.classList.remove("open"); }
document.getElementById("burger-btn").onclick = openMenu;
overlay.onclick = closeMenu;

function switchCat(code, view) {
  currentCat = code; currentView = view;
  saveState(); renderMenu();
  pushViewToHistory(view, code);
  showSection();
}
function switchView(view) {
  currentView = view;
  saveState(); renderMenu();
  pushViewToHistory(view, currentCat);
  showSection();
}

const SECTION_IDS = {
  home: "home-section",
  random: "random-spin-section", spin: "spin-section", list: "list-section",
  upcoming: "upcoming-section", history: "history-section", showcase: "showcase-section",
  theaters: "theaters-section", series_releases: "series-releases-section",
  tracked_series: "tracked-series-section",
};

function applyStudioTheme() {
  const studio = (currentCat === "marvel" || currentCat === "dc") && VIEWS_WITH_CAT.includes(currentView)
    ? currentCat
    : "";
  document.body.dataset.studio = studio;
}

function showSection() {
  applyStudioTheme();
  if (typeof closePosterInfoModal === "function") closePosterInfoModal();
  if (typeof closeModal === "function") closeModal();
  if (typeof closeRenameModal === "function") closeRenameModal();

  window.scrollTo(0, 0);

  for (const [view, id] of Object.entries(SECTION_IDS)) {
    document.getElementById(id).classList.toggle("active", currentView === view);
  }

  if (typeof updateWheelScrollLock === "function") updateWheelScrollLock();

  const activeEl = document.getElementById(SECTION_IDS[currentView]);
  if (activeEl) {
    activeEl.classList.remove("fade-in");
    void activeEl.offsetWidth;
    activeEl.classList.add("fade-in");
    activeEl.addEventListener("animationend", function onDone(ev) {
      if (ev.target !== activeEl) return;
      activeEl.classList.remove("fade-in");
      activeEl.removeEventListener("animationend", onDone);
    });
  }

  const titles = {home: "Афиша", random: "Наугад", spin: `${ALL_CATS[currentCat] || ""}`, list: `${ALL_CATS[currentCat] || ""}`,
                   upcoming: "Ожидаемые", history: "История", showcase: `${ALL_CATS[currentCat] || ""} — скоро`,
                   theaters: "В прокате", series_releases: "Премьеры сериалов",
                   tracked_series: "Отслеживание сериалов"};
  document.getElementById("page-title").textContent = titles[currentView] || "";

  if (currentView === "home") loadHome();
  if (currentView === "random") {
    renderAllDockControls("random");
    resetWheelWraps();
    document.getElementById("random-spin-result").innerHTML = placeholderHtml("Нажми «Крутить», и рулетка выберет фильм, сериал или мультфильм 🍿");
    currentCardData = null;
  }
  if (currentView === "spin") {
    renderAllDockControls("spin");
    resetWheelWraps();
    document.getElementById("spin-result").innerHTML = placeholderHtml("Нажми «Крутить», чтобы узнать, что посмотреть 🎬");
    currentCardData = null;
    if (spinMode === "wheel") showIdleWheel(currentCat);
  }
  if (currentView === "random" || currentView === "spin") {
    if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
  }
  if (currentView === "list") loadList();
  if (currentView === "upcoming") loadUpcoming();
  if (currentView === "history") loadHistory();
  if (currentView === "showcase") loadShowcase();
  if (currentView === "theaters") loadTheaters();
  if (currentView === "series_releases") loadSeriesReleases();
  if (currentView === "tracked_series") loadTrackedSeries();
}
