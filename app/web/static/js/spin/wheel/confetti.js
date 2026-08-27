// Roulette wheel: a confetti burst over the wheel when it lands on the final answer.

const WHEEL_CONFETTI_COLORS = [
  "#8b7cf6", "#5b8def", "#34d399", "#f2596b",
  "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a",
];

function fireWheelConfetti(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rect = wrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const canvas = document.createElement("canvas");
  canvas.className = "wheel-confetti-canvas";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  wrap.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const cx = rect.width / 2;
  const cy = rect.height * 0.42;
  const count = Math.round(Math.min(220, Math.max(110, rect.width / 2.2)));
  const gravity = 0.12;
  const duration = 3200;
  const fadeFrom = duration * 0.62;

  const particles = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    return {
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      drag: 0.985 + Math.random() * 0.01,
      size: 5 + Math.random() * 7,
      color: WHEEL_CONFETTI_COLORS[Math.floor(Math.random() * WHEEL_CONFETTI_COLORS.length)],
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.5,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.03 + Math.random() * 0.04,
    };
  });

  const start = performance.now();
  function frame(now) {
    if (!canvas.isConnected) return;
    const t = now - start;
    const life = t <= fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / (duration - fadeFrom));
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const p of particles) {
      p.vy += gravity;
      p.vx *= p.drag;
      p.sway += p.swaySpeed;
      p.x += p.vx + Math.sin(p.sway) * 0.6;
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
    if (t < duration) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}
