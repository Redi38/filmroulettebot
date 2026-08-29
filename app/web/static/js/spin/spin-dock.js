function renderSpinDockRow(prefix, { spinBtnId, spinBtnClass }) {
  return `
    <div class="spin-dock-row">
      <div class="wheel-audio-controls">
        <div id="${prefix}-mute-toggle"></div>
        <div id="${prefix}-sound-theme-toggle"></div>
      </div>
      <div class="spin-controls-dock">
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
        <div id="${prefix}-spin-speed"></div>
        <button class="btn ${spinBtnClass}" id="${spinBtnId}"><span>🎲 Крутить</span></button>
      </div>
    </div>`;
}

function mountSpinDocks() {
  const docks = [
    { mountId: "random-dock-mount", prefix: "random", spinBtnId: "random-spin-btn", spinBtnClass: "btn-success" },
    { mountId: "spin-dock-mount", prefix: "spin", spinBtnId: "spin-btn", spinBtnClass: "btn-primary" },
  ];
  for (const { mountId, prefix, spinBtnId, spinBtnClass } of docks) {
    const mount = document.getElementById(mountId);
    if (!mount) continue;
    mount.outerHTML = renderSpinDockRow(prefix, { spinBtnId, spinBtnClass });
  }
}
mountSpinDocks();
