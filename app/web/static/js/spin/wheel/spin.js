// Roulette wheel: spin animation and rebuild/redraw triggers for visible wheels.

function spinWheelTo(canvas, n, winnerIndex, durationMs) {
  wheelSpinActive = true;
  return new Promise((resolve) => {
    const boundaries = canvas._wheelBoundaries || Array.from({length: n}, (_, i) => ({start: i * (360 / n), end: (i + 1) * (360 / n)}));
    const seg = boundaries[winnerIndex];
    const segSpan = seg.end - seg.start;
    const centerDeg = seg.start + segSpan / 2;
    const jitter = (Math.random() - 0.5) * (segSpan * 0.5);
    const finalMod = ((360 - centerDeg - jitter) % 360 + 360) % 360;
    const extraSpins = 6;
    const totalDeg = extraSpins * 360 + finalMod;

    canvas.style.transition = "none";
    canvas.style.transform = "rotate(0deg)";
    void canvas.offsetWidth;
    canvas.style.transition = `transform ${durationMs}ms cubic-bezier(0.11, 0.82, 0.2, 1)`;
    requestAnimationFrame(() => {
      canvas.style.transform = `rotate(${totalDeg}deg)`;
    });

    let rafId;
    const startTime = performance.now();
    const tick = () => {
      const rotDeg = getCanvasRotationDeg(canvas);
      updatePointerTitle(canvas, rotDeg);
      if (performance.now() - startTime < durationMs) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);

    setTimeout(() => {
      cancelAnimationFrame(rafId);
      updatePointerTitle(canvas, ((totalDeg % 360) + 360) % 360);
      wheelSpinActive = false;
      resolve();
    }, durationMs);
  });
}

function rebuildVisibleWheels() {
  if (wheelSpinActive) return;
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    const predicted = predictWheelSize(wrap);
    if (Math.abs(predicted - (wrap._wheelBuiltSize || 0)) < 3) continue;
    buildWheel(id, wrap._wheelPool, wrap._wheelWeights);
  }
}

function forceRebuildVisibleWheels() {
  if (wheelSpinActive) return;
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    buildWheel(id, wrap._wheelPool, wrap._wheelWeights);
  }
}

function redrawVisibleWheelCanvases() {
  if (wheelSpinActive) return;
  const dpr = getWheelDPR();
  for (const id of WHEEL_WRAP_IDS) {
    const wrap = document.getElementById(id);
    if (!wrap || wrap.style.display === "none" || !wrap._wheelPool) continue;
    const canvas = wrap.querySelector(".wheel-canvas");
    if (!canvas) continue;
    drawWheel(canvas, wrap._wheelPool, dpr, wrap._wheelWeights);
  }
}
