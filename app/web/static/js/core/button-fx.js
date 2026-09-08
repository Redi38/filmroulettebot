// Global button feel: smooth press ripple everywhere, plus a confetti + neon
// burst on the "watch online" link before it redirects to the external site.

function fxReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const BTN_CONFETTI_COLORS = [
  "#8b7cf6", "#5b8def", "#34d399", "#f2596b",
  "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a",
];

function fireButtonConfetti(el) {
  if (fxReducedMotion()) return;
  if (typeof isConfettiEnabled === "function" && !isConfettiEnabled()) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const pad = 90;
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.className = "btn-confetti-canvas";
  canvas.style.position = "fixed";
  canvas.style.left = `${rect.left - pad}px`;
  canvas.style.top = `${rect.top - pad}px`;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const cx = w / 2;
  const cy = h / 2;
  const count = 70;
  const gravity = 0.12;
  const duration = 1100;
  const fadeFrom = duration * 0.5;

  const particles = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 6.5;
    return {
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      drag: 0.97 + Math.random() * 0.02,
      size: 4 + Math.random() * 5,
      color: BTN_CONFETTI_COLORS[Math.floor(Math.random() * BTN_CONFETTI_COLORS.length)],
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.6,
    };
  });

  const start = performance.now();
  function frame(now) {
    if (!canvas.isConnected) return;
    const t = now - start;
    const life = t <= fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / (duration - fadeFrom));
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.vy += gravity;
      p.vx *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

function spawnButtonRipple(btn, evt) {
  if (fxReducedMotion()) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.6;
  const hasPoint = typeof evt.clientX === "number" && (evt.clientX !== 0 || evt.clientY !== 0);
  const originX = hasPoint ? evt.clientX : rect.left + rect.width / 2;
  const originY = hasPoint ? evt.clientY : rect.top + rect.height / 2;

  const ripple = document.createElement("span");
  ripple.className = "btn-ripple";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${originX - rect.left - size / 2}px`;
  ripple.style.top = `${originY - rect.top - size / 2}px`;
  btn.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
}

// Press feedback (ripple + a quick scale) for every .btn and the watch-link.
document.addEventListener("click", (evt) => {
  const btn = evt.target.closest(".btn, .watch-link");
  if (!btn || btn.disabled) return;
  spawnButtonRipple(btn, evt);
  btn.classList.add("btn-press-fx");
  setTimeout(() => btn.classList.remove("btn-press-fx"), 220);
}, true);

// The "Смотреть онлайн" link gets a neon glow + confetti burst, then redirects
// to the external site once the effect has had a moment to play.
document.addEventListener("click", (evt) => {
  const link = evt.target.closest(".watch-link");
  if (!link || link.dataset.fxPending) return;
  const href = link.getAttribute("href");
  if (!href) return;

  evt.preventDefault();
  link.classList.remove("btn-neon-pulse");
  void link.offsetWidth;
  link.classList.add("btn-neon-pulse");
  fireButtonConfetti(link);

  link.dataset.fxPending = "1";
  const delay = fxReducedMotion() ? 0 : 480;
  setTimeout(() => {
    const win = window.open(href, link.getAttribute("target") || "_blank", "noopener");
    if (!win) showToast("Не удалось открыть вкладку — разрешите всплывающие окна");
    link.classList.remove("btn-neon-pulse");
    delete link.dataset.fxPending;
  }, delay);
});
