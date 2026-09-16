function switchCat(code, view) {
  currentCat = code; currentView = view;
  saveState(); renderMenu();
  pushViewToHistory(view, code);
  showSection();
}

// Category switch *within* the single roulette view — no section swap, just a
// fresh idle wheel and a cleared result.
function switchSpinCat(code) {
  if (spinCat === code) return;
  spinCat = code;
  saveState();
  renderSpinCatChips();
  updateHeaderTitle();
  pushViewToHistory("spin", code);
  currentCardData = null;
  // Same as showSection(): the outgoing wheel stays put until the incoming
  // one is ready, so switching category is a swap rather than a blank gap.
  if (spinMode === "wheel" && !isRandomSpin()) showIdleWheel(spinCat);
  else { resetWheelWraps(); resetSpinResult(); }
  if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
}

// Entry point for the main-menu "Списки" item. Plain switchView("list")
// would leave currentCat at whatever a Marvel/DC showcase visit last set it
// to, so re-entering the list screen from elsewhere silently jumped into the
// Marvel/DC list. Restore the list's own last category instead — but only
// when actually arriving from another view; re-clicking while already on
// the list screen must not reset a category picked via the chips.
function switchToList() {
  if (currentView !== "list") currentCat = lastListCat;
  switchView("list");
}

// Category switch within the single list view.
function switchListCat(code) {
  lastListCat = code;
  if (currentCat === code) return;
  currentCat = code;
  saveState();
  renderListCatChips();
  renderMenu();
  applyStudioTheme();
  updateHeaderTitle();
  pushViewToHistory("list", code);
  loadList();
}
function switchView(view) {
  currentView = view;
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

// Per-view "the section is now on screen, load its data" hooks, keyed the
// same way as SECTION_IDS. showSection() looks the current view up here
// instead of chaining `if (currentView === ...)` checks — a view with
// nothing to load on entry (e.g. "spin", handled separately above the
// table since it also needs to run before the async DOM swap settles)
// simply has no entry.
const VIEW_LOADERS = {
  list: () => loadList(),
  upcoming: () => loadUpcoming(),
  history: () => loadHistory(),
  showcase: () => loadShowcase(),
  theaters: () => loadTheaters(),
  series_releases: () => loadSeriesReleases(),
  tracked_series: () => loadTrackedSeries(),
};

function applyStudioTheme() {
  const studio = (currentCat === "marvel" || currentCat === "dc") && VIEWS_WITH_CAT.includes(currentView)
    ? currentCat
    : "";
  document.body.dataset.studio = studio;
}

// VIEW_TITLES and the title rule itself live in core/constants.js so the
// pre-bundle header script in index.html shares them.
function currentViewTitle() {
  return viewTitleFor(currentView, currentCat, spinCat);
}

function updateHeaderTitle() {
  const titleEl = document.getElementById("page-title");
  if (!titleEl) return;
  const nextTitle = currentViewTitle();
  if (titleEl.textContent !== nextTitle) titleEl.textContent = nextTitle;
}

async function showSection() {
  applyStudioTheme();
  if (typeof closePosterInfoModal === "function") closePosterInfoModal();
  if (typeof closeModal === "function") closeModal();
  if (typeof closeRenameModal === "function") closeRenameModal();

  const targetId = SECTION_IDS[currentView];
  const prevEl = document.querySelector(".section.active");
  const reduceMotion = reducedMotion();
  const isSwap = !!(prevEl && prevEl.id !== targetId);
  const hasViewTransitions = !reduceMotion && typeof document.startViewTransition === "function";
  const useViewTransition = isSwap && hasViewTransitions;

  if (currentView !== "home" && typeof pauseHomeMarquee === "function") pauseHomeMarquee();

  const resumeHomeMarqueeInline = currentView === "home" && homeLoaded && useViewTransition;

  const applyDom = () => {
    window.scrollTo(0, 0);
    for (const [view, id] of Object.entries(SECTION_IDS)) {
      document.getElementById(id).classList.toggle("active", currentView === view);
    }
    if (currentView === "spin" && spinMode === "wheel" && !isRandomSpin()) {
      prepIdleWheelSkeleton(spinCat);
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

  if (currentView === "home" && !resumeHomeMarqueeInline) loadHome();
  if (currentView === "spin") {
    renderAllDockControls("spin");
    currentCardData = null;
    if (spinMode === "wheel" && !isRandomSpin()) showIdleWheel(spinCat);
    else { resetWheelWraps(); resetSpinResult(); }
    if (typeof syncSpinResultClearance === "function") syncSpinResultClearance();
  }
  const loader = VIEW_LOADERS[currentView];
  if (loader) loader();
}
