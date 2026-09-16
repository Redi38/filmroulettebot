import { VIEW_TITLES, viewTitleFor } from "./constants.js";
import { renderMenu } from "./menu.js";
import { closeModal, closePosterInfoModal, closeRenameModal } from "./modal.js";
import { VIEWS_WITH_CAT, hashCatFor, pushViewToHistory } from "./router.js";
import { isRandomSpin, saveState, uiState } from "./state.js";
import { TAB_REVISIT_STALE_MS, reducedMotion, runViewTransition } from "./utils.js";
import { loadHistory } from "../history/shell.js";
import { homeLoaded, loadHome, pauseHomeMarquee, resumeHomeMarquee, syncMarqueeSize } from "../home/home.js";
import { loadList, renderListCatChips } from "../list/list-items.js";
import { loadUpcoming } from "../list/upcoming-list.js";
import { loadShowcase, loadTrackedSeries, prepShowcaseSkeletonIfStale } from "../showcase/showcase.js";
import { renderAllDockControls } from "../spin/settings/dock-controls.js";
import { renderSpinCatChips, resetSpinResult } from "../spin/settings/spin-category.js";
import { spinMode } from "../spin/settings/spin-mode.js";
import { syncSpinResultClearance } from "../spin/wheel/viewport.js";
import { prepIdleWheelSkeleton, resetWheelWraps, showIdleWheel, updateWheelScrollLock } from "../spin/wheel/wheel-build.js";
import { loadSeriesReleases, loadTheaters } from "../theaters/theaters.js";

export function switchCat(code, view) {
  uiState.currentCat = code; uiState.currentView = view;
  saveState(); renderMenu();
  pushViewToHistory(view, code);
  showSection();
}

// Category switch *within* the single roulette view — no section swap, just a
// fresh idle wheel and a cleared result.
export function switchSpinCat(code) {
  if (uiState.spinCat === code) return;
  uiState.spinCat = code;
  saveState();
  renderSpinCatChips();
  updateHeaderTitle();
  pushViewToHistory("spin", code);
  uiState.currentCardData = null;
  // Same as showSection(): the outgoing wheel stays put until the incoming
  // one is ready, so switching category is a swap rather than a blank gap.
  if (spinMode === "wheel" && !isRandomSpin()) showIdleWheel(uiState.spinCat);
  else { resetWheelWraps(); resetSpinResult(); }
  if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
}

export function switchToList() {
  if (uiState.currentView !== "list") uiState.currentCat = uiState.lastListCat;
  switchView("list");
}

// Category switch within the single list view.
export function switchListCat(code) {
  uiState.lastListCat = code;
  if (uiState.currentCat === code) return;
  uiState.currentCat = code;
  saveState();
  renderListCatChips();
  renderMenu();
  applyStudioTheme();
  updateHeaderTitle();
  pushViewToHistory("list", code);
  loadList();
}
export function switchView(view) {
  uiState.currentView = view;
  saveState(); renderMenu();
  pushViewToHistory(view, hashCatFor(view));
  showSection();
}

const SECTION_IDS = {
  home: "home-section",
  spin: "spin-section", list: "list-section",
  upcoming: "upcoming-section", history: "history-section", showcase: "showcase-section",
  theaters: "theaters-section", series_releases: "series-releases-section",
  tracked_series: "tracked-series-section",
};

export const VIEW_LOADERS = {
  list: () => loadList(),
  upcoming: () => loadUpcoming(),
  history: () => loadHistory(),
  // `true` marks this as a plain tab-revisit call: if the view already has
  // fresh-enough data, the loader skips the fetch-and-fade entirely instead
  // of re-flickering content that source updates only rarely (TMDB
  // scraping / manual add-remove — see TAB_REVISIT_STALE_MS).
  showcase: () => loadShowcase(true),
  theaters: () => loadTheaters(undefined, true),
  series_releases: () => loadSeriesReleases(true),
  tracked_series: () => loadTrackedSeries(true),
};

function applyStudioTheme() {
  const studio = (uiState.currentCat === "marvel" || uiState.currentCat === "dc") && VIEWS_WITH_CAT.includes(uiState.currentView)
    ? uiState.currentCat
    : "";
  document.body.dataset.studio = studio;
}

// VIEW_TITLES and the title rule itself live in core/constants.js so the
// pre-bundle header script in index.html shares them.
function currentViewTitle() {
  return viewTitleFor(uiState.currentView, uiState.currentCat, uiState.spinCat);
}

export function updateHeaderTitle() {
  const titleEl = document.getElementById("page-title");
  if (!titleEl) return;
  const nextTitle = currentViewTitle();
  if (titleEl.textContent !== nextTitle) titleEl.textContent = nextTitle;
}

export async function showSection() {
  applyStudioTheme();
  if (typeof closePosterInfoModal === "function") closePosterInfoModal();
  if (typeof closeModal === "function") closeModal();
  if (typeof closeRenameModal === "function") closeRenameModal();
  if (uiState.currentView === "showcase" && typeof prepShowcaseSkeletonIfStale === "function") {
    prepShowcaseSkeletonIfStale();
  }

  const targetId = SECTION_IDS[uiState.currentView];
  const prevEl = document.querySelector(".section.active");
  const reduceMotion = reducedMotion();
  const isSwap = !!(prevEl && prevEl.id !== targetId);
  const hasViewTransitions = !reduceMotion && typeof document.startViewTransition === "function";
  const useViewTransition = isSwap && hasViewTransitions;

  if (uiState.currentView !== "home" && typeof pauseHomeMarquee === "function") pauseHomeMarquee();

  const resumeHomeMarqueeInline = uiState.currentView === "home" && homeLoaded && useViewTransition;

  const applyDom = () => {
    window.scrollTo(0, 0);
    for (const [view, id] of Object.entries(SECTION_IDS)) {
      document.getElementById(id).classList.toggle("active", uiState.currentView === view);
    }
    if (uiState.currentView === "spin" && spinMode === "wheel" && !isRandomSpin()) {
      prepIdleWheelSkeleton(uiState.spinCat);
    }
    updateHeaderTitle();
    if (resumeHomeMarqueeInline) {
      syncMarqueeSize();
      resumeHomeMarquee();
    }
  };

  if (useViewTransition) {
    await runViewTransition(applyDom, "vt-section");
  } else {
    applyDom();
    const activeEl = document.getElementById(targetId);
    if (activeEl && isSwap && !reduceMotion) {
      activeEl.classList.remove("section-fade-in");
      void activeEl.offsetWidth;
      activeEl.classList.add("section-fade-in");
      activeEl.addEventListener("animationend", function onDone(ev) {
        if (ev.target !== activeEl) return;
        activeEl.classList.remove("section-fade-in");
        activeEl.removeEventListener("animationend", onDone);
      });
    }
  }

  if (typeof updateWheelScrollLock === "function") updateWheelScrollLock();

  if (uiState.currentView === "home" && !resumeHomeMarqueeInline) loadHome();
  if (uiState.currentView === "spin") {
    renderAllDockControls("spin");
    uiState.currentCardData = null;
    if (spinMode === "wheel" && !isRandomSpin()) showIdleWheel(uiState.spinCat);
    else { resetWheelWraps(); resetSpinResult(); }
    if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
  }
  const loader = VIEW_LOADERS[uiState.currentView];
  if (loader) loader();
}
