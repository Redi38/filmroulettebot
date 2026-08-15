const sideMenu = document.getElementById("side-menu");
const sideMenuScroll = document.getElementById("side-menu-scroll");
const overlay = document.getElementById("overlay");

const MENU_LABELS = {movies: "Фильмы", cartoons: "Мульты", series: "Сериалы"};
const REF_MENU_LABELS = {marvel: "Marvel", dc: "DC"};

const ICONS = {
  shuffle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>`,
  movies: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"></rect><line x1="7" y1="3" x2="7" y2="21"></line><line x1="17" y1="3" x2="17" y2="21"></line><line x1="2" y1="8" x2="7" y2="8"></line><line x1="2" y1="16" x2="7" y2="16"></line><line x1="17" y1="8" x2="22" y2="8"></line><line x1="17" y1="16" x2="22" y2="16"></line></svg>`,
  cartoons: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>`,
  series: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`,
  marvel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  dc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path></svg>`,
  upcoming: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 3 21 21 21 21 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`,
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

  addItem("shuffle", "Наугад", () => switchView("random"), currentView === "random");
  sideMenuScroll.appendChild(document.createElement("hr"));

  for (const [code, label] of Object.entries(MENU_LABELS)) {
    addItem(code, label, () => switchCat(code, "spin"), currentView === "spin" && currentCat === code);
    addItem("list", "Список", () => switchCat(code, "list"), currentView === "list" && currentCat === code, true);
  }
  sideMenuScroll.appendChild(document.createElement("hr"));
  for (const [code, label] of Object.entries(REF_MENU_LABELS)) {
    addItem(code, `${label} – список`, () => switchCat(code, "list"), currentView === "list" && currentCat === code);
  }
  sideMenuScroll.appendChild(document.createElement("hr"));
  addItem("upcoming", "Ожидаемые", () => switchView("upcoming"), currentView === "upcoming");
  addItem("history", "История", () => switchView("history"), currentView === "history");
}

function openMenu() { sideMenu.classList.add("open"); overlay.classList.add("open"); }
function closeMenu() { sideMenu.classList.remove("open"); overlay.classList.remove("open"); }
document.getElementById("burger-btn").onclick = openMenu;
overlay.onclick = closeMenu;

function switchCat(code, view) {
  currentCat = code; currentView = view;
  saveState(); renderMenu(); showSection();
}
function switchView(view) {
  currentView = view;
  saveState(); renderMenu(); showSection();
}

const SECTION_IDS = {
  random: "random-spin-section", spin: "spin-section", list: "list-section",
  upcoming: "upcoming-section", history: "history-section",
};

function showSection() {
  for (const [view, id] of Object.entries(SECTION_IDS)) {
    document.getElementById(id).classList.toggle("active", currentView === view);
  }

  const activeEl = document.getElementById(SECTION_IDS[currentView]);
  if (activeEl) {
    activeEl.classList.remove("fade-in");
    void activeEl.offsetWidth;
    activeEl.classList.add("fade-in");
  }

  const titles = {random: "🔄 Наугад", spin: `${ALL_CATS[currentCat] || ""}`, list: `${ALL_CATS[currentCat] || ""}`,
                   upcoming: "🕐 Ожидаемые", history: "📜 История"};
  document.getElementById("page-title").textContent = titles[currentView] || "";

  if (currentView === "random") {
    document.getElementById("random-spin-result").innerHTML = placeholderHtml("Нажми «Крутить», и рулетка выберет фильм, сериал или мультфильм 🍿");
    currentCardData = null;
  }
  if (currentView === "spin") {
    document.getElementById("spin-result").innerHTML = placeholderHtml("Нажми «Крутить», чтобы узнать, что посмотреть 🎬");
    currentCardData = null;
  }
  if (currentView === "list") loadList();
  if (currentView === "upcoming") loadUpcoming();
  if (currentView === "history") loadHistory();
}
