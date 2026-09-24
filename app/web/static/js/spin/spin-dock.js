import { setPanelOpen } from "../showcase/filters.js";

// The roulette dock. There used to be two of these — one for the "Наугад"
// view and an identical one for the per-category spin view — kept in sync by
// rendering every setting twice. There is a single roulette now, so there is
// a single dock, with a category picker at the top of it.
function renderSpinDockRow(prefix, { spinBtnId, spinBtnClass }) {
  return `
    <div class="spin-dock-row">
      <div class="wheel-audio-controls">
        <div id="${prefix}-mute-toggle"></div>
        <div id="${prefix}-sound-theme-toggle"></div>
      </div>
      <div class="spin-controls-dock filter-panel-collapsible filter-panel-collapsible--always">
        <button type="button" class="filter-panel-toggle spin-settings-toggle" aria-expanded="false">
          <span class="filter-panel-toggle-label">Настройки рулетки</span>
          <svg class="filter-panel-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <div class="filter-panel-body">
        <div class="filter-panel-inner">
        <div class="spin-section">
          <p class="spin-caption">Категория</p>
          <div id="${prefix}-cat-select"></div>
        </div>
        <div class="spin-section">
          <p class="spin-caption">Режим</p>
          <div id="${prefix}-mode-toggle"></div>
        </div>
        <div class="spin-section spin-section-toggle" id="${prefix}-weight-section">
          <p class="spin-caption">Вероятность</p>
          <div id="${prefix}-weight-toggle"></div>
        </div>
        <div class="spin-section spin-section-toggle" id="${prefix}-random-filter-section">
          <p class="spin-caption">Фильтры</p>
          <div class="spin-toggle-row">
            <div id="${prefix}-films-only-toggle"></div>
            <div id="${prefix}-max-runtime-toggle"></div>
          </div>
        </div>
        <div class="spin-section spin-section-toggle" id="${prefix}-fx-section">
          <p class="spin-caption">Эффекты</p>
          <div class="spin-toggle-row">
            <div id="${prefix}-confetti-toggle"></div>
            <div id="${prefix}-appearance-toggle"></div>
          </div>
        </div>
        <div class="spin-section" id="${prefix}-autowatch-section">
          <p class="spin-caption">Функции</p>
          <div class="spin-toggle-row">
            <div id="${prefix}-watch-toggle"></div>
            <div id="${prefix}-poster-toggle"></div>
          </div>
        </div>
        <div id="${prefix}-spin-speed"></div>
        </div>
        </div>
        <button class="btn ${spinBtnClass}" id="${spinBtnId}"><span>🎲 Крутить</span></button>
      </div>
    </div>`;
}

function mountSpinDocks() {
  const mount = document.getElementById("spin-dock-mount");
  if (!mount) return;
  mount.outerHTML = renderSpinDockRow("spin", { spinBtnId: "spin-btn", spinBtnClass: "btn-primary" });
  wireSettingsToggles();
}

// The settings collapse behind one header on every screen size (same panel
// as the filters on the theaters tab); the spin button stays outside it.
function wireSettingsToggles() {
  for (const dock of document.querySelectorAll(".spin-controls-dock")) {
    const head = dock.querySelector(":scope > .spin-settings-toggle");
    if (!head) continue;
    head.onclick = () => setPanelOpen(dock, head, !dock.classList.contains("open"));
  }
}
mountSpinDocks();
