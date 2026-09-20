import { REF_CATS } from "./constants.js";
import { uiState } from "./state.js";
import { switchCat, switchToList, switchView } from "./views.js";

const sideMenu = document.getElementById("side-menu");
const sideMenuScroll = document.getElementById("side-menu-scroll");
export const overlay = document.getElementById("overlay");

// The active-row marker is a single element that slides between rows, so it
// has to outlive renderMenu()'s rebuild — hence clearing the item nodes one
// by one rather than wiping innerHTML, and positioning it afterwards.
let menuIndicator = null;

function ensureMenuIndicator() {
  if (menuIndicator && menuIndicator.isConnected) return menuIndicator;
  menuIndicator = document.createElement("div");
  menuIndicator.id = "menu-active-indicator";
  menuIndicator.className = "no-anim";
  sideMenuScroll.appendChild(menuIndicator);
  return menuIndicator;
}

function syncMenuIndicator(activeItem) {
  const indicator = ensureMenuIndicator();
  if (!activeItem) {
    indicator.classList.remove("visible");
    return;
  }
  const top = activeItem.offsetTop;
  const height = activeItem.offsetHeight;
  indicator.style.height = `${height}px`;
  indicator.style.transform = `translateY(${top}px)`;
  indicator.classList.add("visible");
  if (indicator.classList.contains("no-anim")) {
    void indicator.offsetWidth;
    indicator.classList.remove("no-anim");
  }
}

export function renderMenu() {
  const indicator = ensureMenuIndicator();
  for (const child of [...sideMenuScroll.children]) {
    if (child !== indicator) child.remove();
  }
  let activeItem = null;
  const addItem = (icon, label, onClick, active, sub) => {
    const b = document.createElement("button");
    b.className = "menu-item" + (sub ? " sub" : "") + (active ? " active" : "");
    const iconSvg = icon
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="/static/icons.svg#icon-${icon}"></use></svg>`
      : "";
    b.innerHTML = `${iconSvg}<span>${label}</span>`;
    b.onclick = () => { onClick(); closeMenu(); };
    sideMenuScroll.appendChild(b);
    if (active) activeItem = b;
  };
  const addGroup = (label) => {
    const h = document.createElement("div");
    h.className = "menu-group-label";
    h.textContent = label;
    sideMenuScroll.appendChild(h);
  };

  addGroup("Главное");
  addItem("home", "Афиша", () => switchView("home"), uiState.currentView === "home");
  addItem("shuffle", "Рулетка", () => switchView("spin"), uiState.currentView === "spin");
  addItem("list", "Списки", () => switchToList(), uiState.currentView === "list");

  addGroup("Кино и сериалы");
  addItem("theaters", "В прокате", () => switchView("theaters"), uiState.currentView === "theaters");
  addItem("premiere", "Премьеры сериалов", () => switchView("series_releases"), uiState.currentView === "series_releases");
  addItem("bell", "Отслеживание сериалов", () => switchView("tracked_series"), uiState.currentView === "tracked_series");

  addGroup("Подборки");
  for (const code of Object.keys(REF_CATS)) {
    addItem(code, REF_CATS[code], () => switchCat(code, "showcase"), uiState.currentView === "showcase" && uiState.currentCat === code);
  }

  addGroup("Прочее");
  addItem("upcoming", "Ожидаемые", () => switchView("upcoming"), uiState.currentView === "upcoming");

  syncMenuIndicator(activeItem);
}

const burgerBtn = document.getElementById("burger-btn");

function setBurgerOpen(isOpen) {
  if (!burgerBtn) return;
  burgerBtn.classList.toggle("open", isOpen);
  burgerBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  burgerBtn.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Меню");
}

// Guards against the delayed "ghost click" some mobile browsers still fire
// ~300ms after the touch that opened the menu: by the time it lands, the
// overlay is sitting under the finger and the ghost click closes the menu
// almost immediately after it opened. touch-action: manipulation (see
// base.css) should prevent that delayed click outright, but this timestamp
// check is a cheap second line of defense — any overlay click within the
// window a ghost click would land in is ignored.
const MENU_GHOST_CLICK_GUARD_MS = 400;
let menuOpenedAt = 0;

function openMenu() {
  sideMenu.classList.add("open");
  overlay.classList.add("open");
  setBurgerOpen(true);
  menuOpenedAt = Date.now();
  syncMenuIndicator(sideMenuScroll.querySelector(".menu-item.active"));
}
function closeMenu() {
  sideMenu.classList.remove("open");
  overlay.classList.remove("open");
  setBurgerOpen(false);
}
function toggleMenu() {
  if (sideMenu.classList.contains("open")) closeMenu();
  else openMenu();
}
if (burgerBtn) {
  burgerBtn.onclick = toggleMenu;
  setBurgerOpen(false);
}
overlay.onclick = () => {
  if (Date.now() - menuOpenedAt < MENU_GHOST_CLICK_GUARD_MS) return;
  closeMenu();
};
