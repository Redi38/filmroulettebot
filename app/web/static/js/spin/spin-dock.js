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
      <div class="spin-controls-dock">
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
        <div class="spin-section spin-section-toggle" id="${prefix}-fx-section">
          <p class="spin-caption">Эффекты</p>
          <div class="spin-toggle-row">
            <div id="${prefix}-confetti-toggle"></div>
            <div id="${prefix}-appearance-toggle"></div>
          </div>
        </div>
        <div class="spin-section" id="${prefix}-autowatch-section">
          <p class="spin-caption">Функции</p>
          <div id="${prefix}-watch-toggle"></div>
        </div>
        <div id="${prefix}-spin-speed"></div>
        <button class="btn ${spinBtnClass}" id="${spinBtnId}"><span>🎲 Крутить</span></button>
      </div>
    </div>`;
}

function mountSpinDocks() {
  const mount = document.getElementById("spin-dock-mount");
  if (!mount) return;
  mount.outerHTML = renderSpinDockRow("spin", { spinBtnId: "spin-btn", spinBtnClass: "btn-primary" });
}
mountSpinDocks();
