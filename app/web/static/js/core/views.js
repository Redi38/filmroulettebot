import { TAB_REVISIT_STALE_MS, VIEW_TITLES, viewTitleFor } from "./constants.js";
import { renderMenu } from "./menu.js";
import { closeModal, closePosterInfoModal, closeRenameModal } from "./modal.js";
import { VIEWS_WITH_CAT, hashCatFor, pushViewToHistory } from "./router.js";
import { saveState, uiState } from "./state.js";
import { reducedMotion, runViewTransition } from "./transitions.js";
import { closeHistoryPanel } from "../history/panel.js";
import { homeLoaded, loadHome, pauseHomeMarquee, resumeHomeMarquee, syncMarqueeSize } from "../home/home.js";
import { loadList, renderListCatChips } from "../list/list-items.js";
import { loadUpcoming } from "../list/upcoming-list.js";
import { loadShowcase, loadTrackedSeries, prepShowcaseSkeletonIfStale } from "../showcase/showcase.js";
import { renderAllDockControls } from "../spin/settings/dock-controls.js";
import { renderSpinCatChips, resetSpinResult } from "../spin/settings/spin-category.js";
import { spinMode } from "../spin/settings/spin-mode.js";
import { loadWheel } from "../spin/wheel/loader.js";
import { loadSeriesReleases, loadTheaters } from "../theaters/theaters.js";

export function switchCat(code, view) {
  uiState.currentCat = code; uiState.currentView = view;
  saveState(); renderMenu();
  pushViewToHistory(view, code);
  showSection();
}

// Category switch *within* the single roulette view — no section swap, just a
// fresh idle wheel and a cleared result.
export async function switchSpinCat(code) {
  if (uiState.spinCat === code) return;
  uiState.spinCat = code;
  saveState();
  renderSpinCatChips();
  updateHeaderTitle();
  pushViewToHistory("spin", code);
  uiState.currentCardData = null;
  const wheel = await loadWheel();
  // Same as showSection(): the outgoing wheel stays put until the incoming
  // one is ready, so switching category is a swap rather than a blank gap.
  if (spinMode === "wheel") wheel.showIdleWheel(uiState.spinCat);
  else { wheel.resetWheelWraps(); resetSpinResult(); }
  wheel.syncSpinResultClearance();
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
  upcoming: "upcoming-section", showcase: "showcase-section",
  theaters: "theaters-section", series_releases: "series-releases-section",
  tracked_series: "tracked-series-section",
};

export const VIEW_LOADERS = {
  list: () => loadList(),
  upcoming: () => loadUpcoming(),
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
  closePosterInfoModal();
  closeModal();
  closeRenameModal();
  if (uiState.currentView === "showcase") {
    prepShowcaseSkeletonIfStale();
  }

  // The wheel is a separate lazy chunk (see spin/wheel/loader.js). Await it
  // up front whenever the roulette is the view being switched to, so
  // everything below — including the synchronous view-transition callback —
  // can call straight into it.
  const needsWheel = uiState.currentView === "spin";
  const wheel = needsWheel ? await loadWheel() : null;

  const targetId = SECTION_IDS[uiState.currentView];
  const prevEl = document.querySelector(".section.active");
  const reduceMotion = reducedMotion();
  const isSwap = !!(prevEl && prevEl.id !== targetId);
  const hasViewTransitions = !reduceMotion && typeof document.startViewTransition === "function";
  const useViewTransition = isSwap && hasViewTransitions;

  if (uiState.currentView !== "home") pauseHomeMarquee();

  const resumeHomeMarqueeInline = uiState.currentView === "home" && homeLoaded && useViewTransition;

  const applyDom = () => {
    window.scrollTo(0, 0);
    applyStudioTheme();
    // The history panel belongs to the roulette screen; leaving it closes the panel.
    if (uiState.currentView !== "spin") closeHistoryPanel();
    for (const [view, id] of Object.entries(SECTION_IDS)) {
      document.getElementById(id).classList.toggle("active", uiState.currentView === view);
    }
    if (wheel && spinMode === "wheel") {
      wheel.prepIdleWheelSkeleton(uiState.spinCat);
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

  if (wheel) wheel.updateWheelScrollLock();

  if (uiState.currentView === "home" && !resumeHomeMarqueeInline) loadHome();
  if (uiState.currentView === "spin") {
    renderAllDockControls("spin");
    uiState.currentCardData = null;
    if (spinMode === "wheel") wheel.showIdleWheel(uiState.spinCat);
    else { wheel.resetWheelWraps(); resetSpinResult(); }
    wheel.syncSpinResultClearance();
  }
  const loader = VIEW_LOADERS[uiState.currentView];
  if (loader) loader();
}
