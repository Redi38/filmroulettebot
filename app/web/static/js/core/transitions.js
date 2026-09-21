// Fade / slide / crossfade / View Transition helpers, plus the one global
// listener that keeps CSS animations from stalling in a hidden tab.

function nextFrame() {
  return new Promise((r) => {
    if (document.hidden) { setTimeout(r, 16); return; }
    requestAnimationFrame(r);
  });
}

function maxTransitionMs(el) {
  const cs = getComputedStyle(el);
  const parse = (v) => v.split(",").map((s) => {
    s = s.trim();
    return s.endsWith("ms") ? parseFloat(s) : parseFloat(s) * 1000;
  });
  const durs = parse(cs.transitionDuration);
  const delays = parse(cs.transitionDelay);
  let max = 0;
  for (let i = 0; i < durs.length; i++) {
    const d = (durs[i] || 0) + (delays[i % delays.length] || 0);
    if (d > max) max = d;
  }
  return max;
}

export function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

const NAV_SLIDE_PX = 22;

export function setNavDirection(el, dir) {
  if (el) el._navDir = dir;
}

export async function fadeOut(el) {
  const dir = reducedMotion() ? 0 : (el._navDir || 0);
  const ms = maxTransitionMs(el);
  el.style.opacity = "0";
  if (dir) el.style.transform = `translateX(${-dir * NAV_SLIDE_PX}px)`;
  await nextFrame();
  await new Promise((r) => setTimeout(r, Math.min(400, Math.max(60, ms + 20))));
}

export function fadeIn(el) {
  const dir = reducedMotion() ? 0 : (el._navDir || 0);
  el._navDir = 0;
  if (dir) {
    el.style.transition = "none";
    el.style.transform = `translateX(${dir * NAV_SLIDE_PX}px)`;
    void el.offsetWidth;
    el.style.transition = "";
  }
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "";
  });
}

// Swaps a container's contents with the outgoing and incoming markup
// overlapping, so a skeleton hands over to the real card instead of being
// replaced between two frames. The outgoing copy is taken out of the flow
// while it fades, so the box is sized by the incoming content throughout.
const CROSSFADE_MS = 220;

export function crossfadeContent(container, html) {
  if (!container) return;
  if (reducedMotion() || !container.firstChild) {
    container.innerHTML = html;
    return;
  }
  const outgoing = document.createElement("div");
  outgoing.className = "xfade-layer xfade-out";
  while (container.firstChild) outgoing.appendChild(container.firstChild);

  const incoming = document.createElement("div");
  incoming.className = "xfade-layer xfade-in";
  incoming.innerHTML = html;

  container.classList.add("xfade-host");
  container.appendChild(outgoing);
  container.appendChild(incoming);

  requestAnimationFrame(() => {
    outgoing.style.opacity = "0";
    incoming.style.opacity = "1";
  });

  setTimeout(() => {
    outgoing.remove();
    // Unwrap the incoming layer so callers keep querying a flat container.
    while (incoming.firstChild) container.insertBefore(incoming.firstChild, incoming);
    incoming.remove();
    container.classList.remove("xfade-host");
  }, CROSSFADE_MS + 30);
}

// Runs `update` inside a View Transition when the browser has one, with
// `vtClass` on <html> for the duration so the transition's CSS can be scoped
// to this particular navigation. Falls back to running `update` directly.
export function runViewTransition(update, vtClass) {
  if (reducedMotion() || typeof document.startViewTransition !== "function") {
    update();
    return Promise.resolve();
  }
  document.documentElement.classList.add(vtClass);
  let vt;
  try {
    vt = document.startViewTransition(update);
  } catch (e) {
    document.documentElement.classList.remove(vtClass);
    return Promise.resolve();
  }
  vt.ready.catch(() => {});
  return vt.finished
    .catch(() => {})
    .then(() => { document.documentElement.classList.remove(vtClass); });
}

// A CSS animation/transition that starts (or is mid-flight) while the tab is
// hidden doesn't advance — browsers pause the whole timeline for a
// backgrounded document — so it just resumes and plays out for real once the
// tab is shown again. That's invisible for something that was already
// mid-transition when the tab was switched away moments ago, but after a
// long absence (e.g. a spin result card built while the tab sat hidden — see
// swapWheelForCard in spin-actions.js) it reads as the entrance animation
// only starting on return, instead of the card just being there already.
// Snap anything still running to its end state the moment the tab becomes
// visible. Infinite-iteration animations (the home marquee) are excluded —
// finish() throws on those, and it seeks itself via currentTime instead
// (see pauseHomeMarquee/resumeHomeMarquee in home/home.js).
document.addEventListener("visibilitychange", () => {
  if (document.hidden || typeof document.getAnimations !== "function") return;
  for (const anim of document.getAnimations()) {
    try {
      const timing = anim.effect && anim.effect.getComputedTiming ? anim.effect.getComputedTiming() : null;
      if (!timing || timing.iterations === Infinity) continue;
      if (anim.playState === "running" || anim.playState === "pending") anim.finish();
    } catch {}
  }
});
