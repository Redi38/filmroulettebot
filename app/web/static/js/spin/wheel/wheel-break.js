import { getLS } from "../../core/storage.js";
import { playWheelSfx } from "./wheel-audio.js";
import { cancelWheelFrame, scheduleWheelFrame, setCanvasRotation, wheelPrefersReducedMotion } from "./spin.js";
import { wheelSpinState } from "./wheel-constants.js";
import { getCanvasRotationDeg, updatePointerTitle } from "./wheel-draw.js";
import { hideWheelHoverLabel, startWheelIdle, stopWheelIdle, wheelIdleRedraw } from "./wheel-idle.js";

// A joke with a job: a wheel carrying too many titles gives up when it is
// spun. The first spin of an overloaded wheel never reaches the server — the
// disc shakes itself apart instead, and a flashing "Починить" button appears.
// Pressing it glues everything back with planks, nails and duct tape. The
// repairs are kept (the wheel stays patched) until the page is reloaded, so
// the wheel breaks once per visit, not on every spin.

// Per-list wheels are capped at 120 titles server-side, the "Рандом" wheel at
// 400, so 100 means "a full list" for the first and "a modest library" for the
// second. For testing, set localStorage `filmroulette_wheel_break_threshold`.
const WHEEL_BREAK_DEFAULT_THRESHOLD = 100;
const WHEEL_BREAK_THRESHOLD_KEY = "filmroulette_wheel_break_threshold";

const SHARD_COUNT = 6;
const STRAIN_MS = 1700;

// What survives the break: the plan (where the cracks, planks and tape are,
// in the wheel's own frame, 0..100 units, centre at 50,50) and whether the
// repair has been done.
const wheelBreakState = { patched: false, plan: null };

export function isWheelPatched() {
  return wheelBreakState.patched && !!wheelBreakState.plan;
}

export function wheelBreakThreshold() {
  const raw = parseInt(getLS(WHEEL_BREAK_THRESHOLD_KEY) || "", 10);
  return Number.isFinite(raw) && raw > 1 ? raw : WHEEL_BREAK_DEFAULT_THRESHOLD;
}

export function shouldBreakWheel(wrap) {
  if (!wrap || wheelBreakState.patched || wrap._breakState) return false;
  if (wrap.classList.contains("wheel-wrap--settling")) return false;
  if (!wrap.querySelector(".wheel-canvas")) return false;
  return (wrap._wheelPool || []).length > wheelBreakThreshold();
}

export function isWheelBroken(wrap) {
  return !!(wrap && wrap._breakState && wrap._breakState.phase !== "done");
}

// Called whenever the wheel's DOM is thrown away (rebuild, reset): whatever
// state a half-played break had is dropped with it.
export function clearWheelBreak(wrap) {
  const st = wrap && wrap._breakState;
  if (!st) return;
  wrap._breakState = null;
  if (st.url) URL.revokeObjectURL(st.url);
  wrap.classList.remove("wheel-wrap--breaking");
  wheelSpinState.active = false;
}

// ---- small helpers ---------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pt = (deg, r) => {
  const a = deg * Math.PI / 180;
  return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
};
const alive = (st) => st.wrap._breakState === st && st.holder.isConnected;

// Web Animations as a promise that never rejects (a cancelled animation just
// resolves) and never hangs in a background tab.
function play(el, keyframes, opts) {
  const a = el.animate(keyframes, opts);
  const total = (opts.delay || 0) + opts.duration + 80;
  return Promise.race([a.finished.catch(() => {}), sleep(total + 400)]).then(() => a);
}

function announce(text) {
  const el = document.getElementById("spin-announcer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 60);
}

// ---- plan: where everything goes ---------------------------------------------

function makePlan() {
  const base = rand(0, 360);
  const angles = Array.from({length: SHARD_COUNT}, (_, i) => base + i * (360 / SHARD_COUNT) + rand(-13, 13));
  const cracks = angles.map((a) => [
    {a, r: 0},
    {a: a + rand(-5, 5), r: 15},
    {a: a + rand(-6, 6), r: 28},
    {a: a + rand(-5, 5), r: 40},
    {a, r: 50},
  ]);
  const order = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);
  const plankIdx = [order[0], (order[0] + (Math.random() < 0.5 ? 2 : 4)) % SHARD_COUNT];
  const tapeIdx = order.filter((i) => !plankIdx.includes(i)).slice(0, 3);

  const planks = plankIdx.map((i) => {
    const a = angles[i];
    const [cx, cy] = pt(a, 27);
    const len = 36, w = 8.5, rot = a - 90 + rand(-4, 4);
    const rr = rot * Math.PI / 180;
    const nails = [-1, 1].map((side) => {
      const lx = side * (len / 2 - 4.5), ly = rand(-1.2, 1.2);
      return {x: cx + lx * Math.cos(rr) - ly * Math.sin(rr), y: cy + lx * Math.sin(rr) + ly * Math.cos(rr), lx, ly};
    });
    return {cx, cy, len, w, rot, nails};
  });
  const tapes = tapeIdx.map((i) => {
    const [cx, cy] = pt(angles[i], rand(26, 33));
    return {cx, cy, len: 31, w: 6.6, rot: angles[i] - 90 + (Math.random() < 0.5 ? -1 : 1) * rand(22, 34)};
  });
  return {angles, cracks, planks, tapes};
}

// The pieces the disc breaks into. Neighbouring pieces share one jagged
// crack, so they fit back together exactly. `rotDeg` is the wheel's current
// angle: the snapshot has it baked in, the plan does not.
function shardPolygons(plan, rotDeg) {
  const n = plan.cracks.length;
  const P = (c) => pt(c.a + rotDeg, c.r);
  return plan.cracks.map((crack, i) => {
    const next = plan.cracks[(i + 1) % n];
    const a0 = plan.angles[i];
    const a1 = i + 1 < n ? plan.angles[i + 1] : plan.angles[0] + 360;
    const steps = Math.max(2, Math.ceil((a1 - a0) / 10));
    const pts = crack.map(P);
    for (let s = 1; s < steps; s++) pts.push(pt(a0 + (a1 - a0) * s / steps + rotDeg, 50));
    pts.push(...next.map(P).reverse());
    const cxy = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
    return {points: pts, centroid: cxy};
  });
}

// ---- patches: planks, nails, tape, cracks -------------------------------------

let patchUid = 0;

function tapePolygon(len, w) {
  // A strip with torn, zig-zag ends.
  const hx = len / 2, hy = w / 2, z = 0.9;
  const left = [], right = [];
  for (let k = 0; k <= 4; k++) {
    const y = -hy + (w / 4) * k;
    left.push([-hx + (k % 2 ? z : 0), y]);
    right.push([hx - (k % 2 ? 0 : z), y]);
  }
  return [...left, ...right.reverse()].map((p) => p.join(",")).join(" ");
}

function patchSvg(plan, uid) {
  const cracks = plan.cracks.map((c) => {
    const d = c.map((p, i) => { const [x, y] = pt(p.a, p.r); return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`; }).join(" ");
    return `<path d="${d}" fill="none" stroke="#05060c" stroke-opacity=".85" stroke-width="1.1" stroke-linejoin="round"/>`
      + `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width=".35" stroke-linejoin="round" transform="translate(.5 .5)"/>`;
  }).join("");
  const planks = plan.planks.map((p) => {
    const hl = p.len / 2, hw = p.w / 2;
    const grain = [-0.45, -0.05, 0.32].map((f) => `<path d="M${-hl + 1.5} ${(f * p.w).toFixed(2)} q${p.len / 4} 1 ${p.len / 2 - 1.5} 0 t${p.len / 2 - 1.5} -.4" fill="none" stroke="#5b3212" stroke-opacity=".5" stroke-width=".38"/>`).join("");
    const nails = p.nails.map((n) => `<g class="wb-nail" transform="translate(${n.lx.toFixed(2)} ${n.ly.toFixed(2)})"><circle r="1.25" fill="#d9dde4" stroke="#33363e" stroke-width=".4"/><circle cx="-.4" cy="-.4" r=".42" fill="#fff" opacity=".85"/></g>`).join("");
    return `<g class="wb-plank" transform="translate(${p.cx.toFixed(2)} ${p.cy.toFixed(2)}) rotate(${p.rot.toFixed(2)})">`
      + `<g class="wb-in"><rect x="${-hl}" y="${-hw}" width="${p.len}" height="${p.w}" rx="1" fill="url(#wbWood${uid})" stroke="#432408" stroke-width=".55"/>`
      + `${grain}<rect x="${-hl + 1}" y="${-hw + .8}" width="${p.len - 2}" height="1" rx=".5" fill="#fff" opacity=".14"/></g>${nails}</g>`;
  }).join("");
  const tapes = plan.tapes.map((t) => {
    const hl = t.len / 2, hw = t.w / 2;
    return `<g class="wb-tape" transform="translate(${t.cx.toFixed(2)} ${t.cy.toFixed(2)}) rotate(${t.rot.toFixed(2)})"><g class="wb-in">`
      + `<polygon points="${tapePolygon(t.len, t.w)}" fill="url(#wbTape${uid})" stroke="#6d727b" stroke-width=".3" stroke-opacity=".8"/>`
      + `<path d="M${-hl + 1} ${-hw * 0.35} H${hl - 1} M${-hl + 1} ${hw * 0.4} H${hl - 1}" stroke="#fff" stroke-opacity=".35" stroke-width=".3"/></g></g>`;
  }).join("");
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`
    + `<defs><linearGradient id="wbWood${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d49a5d"/><stop offset=".55" stop-color="#b0702f"/><stop offset="1" stop-color="#8b5224"/></linearGradient>`
    + `<linearGradient id="wbTape${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e5e8"/><stop offset=".5" stop-color="#b6bac1"/><stop offset="1" stop-color="#8f949c"/></linearGradient></defs>`
    + `<g class="wb-cracks">${cracks}</g>${planks}${tapes}</svg>`;
}

// Builds the (finished) patch layer into the wheel's mask and ties it to the
// canvas, so it turns with the wheel. Also used by buildWheel() to put a
// repaired wheel's patches back after a rebuild.
export function attachWheelPatches(canvas, mask) {
  const plan = wheelBreakState.plan;
  if (!plan || !canvas || !mask) return null;
  const old = mask.querySelector(".wheel-patches");
  if (old) old.remove();
  const layer = document.createElement("div");
  layer.className = "wheel-patches";
  layer.innerHTML = patchSvg(plan, ++patchUid);
  mask.appendChild(layer);
  canvas._patchLayer = layer;
  layer.style.transform = `rotate(${getCanvasRotationDeg(canvas)}deg)`;
  return layer;
}

// ---- snapshot ----------------------------------------------------------------

// The wheel as the screen shows it right now (rotation included), as an
// object URL. Throws if the canvas cannot be read back (tainted by a poster
// from another origin); the caller then falls back to breaking the whole disc
// as one piece.
async function snapshotWheel(canvas) {
  const S = canvas.offsetWidth;
  const scale = Math.min(2, Math.max(1, canvas.width / S));
  const snap = document.createElement("canvas");
  snap.width = snap.height = Math.round(S * scale);
  const ctx = snap.getContext("2d");
  ctx.scale(scale, scale);
  const cs = getComputedStyle(canvas);
  const border = parseFloat(cs.borderTopWidth) || 0;
  ctx.fillStyle = cs.backgroundColor;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(getCanvasRotationDeg(canvas) * Math.PI / 180);
  const inner = S / 2 - border;
  ctx.beginPath(); ctx.arc(0, 0, inner, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(canvas, -inner, -inner, inner * 2, inner * 2);
  ctx.restore();
  if (border) {
    ctx.strokeStyle = cs.borderTopColor;
    ctx.lineWidth = border;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - border / 2, 0, Math.PI * 2); ctx.stroke();
  }
  const blob = await new Promise((res) => snap.toBlob(res));
  if (!blob) throw new Error("snapshot failed");
  return URL.createObjectURL(blob);
}

// ---- the break -----------------------------------------------------------------

function strain(st) {
  const {canvas, holder} = st;
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0, lastCreak = 0, deg = getCanvasRotationDeg(canvas), handle;
    const tick = (now) => {
      if (!alive(st)) { resolve(false); return; }
      const t = Math.min(1, (now - t0) / STRAIN_MS);
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      deg += (90 + 1250 * t * t) * dt;
      setCanvasRotation(canvas, deg);
      updatePointerTitle(canvas, ((deg % 360) + 360) % 360, true);
      const j = t * t;
      holder.style.transform = `translate(${rand(-3.5, 3.5) * j}px, ${rand(-2.5, 2.5) * j}px) rotate(${rand(-0.8, 0.8) * j}deg)`;
      if (t > 0.35 && now - lastCreak > 240) { lastCreak = now; playWheelSfx("creak"); }
      if (t < 1) handle = scheduleWheelFrame(tick);
      else resolve(true);
    };
    handle = scheduleWheelFrame(tick);
    st.cancelStrain = () => cancelWheelFrame(handle);
  });
}

function makePieces(st, polygons, url) {
  const S = st.size;
  const stage = document.createElement("div");
  stage.className = "wheel-break-stage";
  const slots = [0.2, 0.5, 0.8].sort(() => Math.random() - 0.5);
  const falling = new Set([...Array(SHARD_COUNT).keys()].sort(() => Math.random() - 0.5).slice(0, 3));
  let slot = 0;
  const pieces = polygons.map((poly, i) => {
    const el = document.createElement("div");
    el.className = "wheel-break-shard";
    el.style.backgroundImage = `url("${url}")`;
    el.style.clipPath = `polygon(${poly.points.map((p) => `${p[0].toFixed(2)}% ${p[1].toFixed(2)}%`).join(",")})`;
    el.style.transformOrigin = `${poly.centroid[0].toFixed(2)}% ${poly.centroid[1].toFixed(2)}%`;
    stage.appendChild(el);
    const gx = poly.centroid[0] / 100 * S, gy = poly.centroid[1] / 100 * S;
    let pose;
    if (falling.has(i)) {
      const rx = slots[slot++ % 3] * S + rand(-0.04, 0.04) * S, ry = (0.64 + rand(0, 0.04)) * S;
      pose = {tx: rx - gx, ty: ry - gy, rot: rand(40, 120) * (Math.random() < 0.5 ? -1 : 1), fall: true};
    } else {
      pose = {tx: rand(-0.025, 0.025) * S, ty: rand(0.025, 0.06) * S, rot: rand(3, 7) * (Math.random() < 0.5 ? -1 : 1), fall: false};
    }
    return {el, pose};
  });
  return {stage, pieces};
}

const px = (v) => `${v.toFixed(1)}px`;
const setPose = (el, p) => { el.style.translate = `${px(p.tx)} ${px(p.ty)}`; el.style.rotate = `${p.rot.toFixed(1)}deg`; };

function flyApart(piece, S, delay) {
  const {el, pose} = piece;
  if (!pose.fall) {
    return play(el, [
      {translate: "0px 0px", rotate: "0deg"},
      {translate: `${px(pose.tx * 1.5)} ${px(pose.ty * 0.4)}`, rotate: `${(pose.rot * 1.4).toFixed(1)}deg`, offset: 0.35, easing: "ease-in-out"},
      {translate: `${px(pose.tx)} ${px(pose.ty)}`, rotate: `${pose.rot}deg`},
    ], {duration: 900, delay, easing: "cubic-bezier(.2,.8,.3,1)"}).then(() => setPose(el, pose));
  }
  const apex = `${px(pose.tx * 0.5)} ${px(Math.min(0, pose.ty) - 0.2 * S)}`;
  return play(el, [
    {translate: "0px 0px", rotate: "0deg", easing: "cubic-bezier(.2,.7,.3,1)"},
    {translate: apex, rotate: `${(pose.rot * 0.4).toFixed(1)}deg`, offset: 0.34, easing: "cubic-bezier(.5,0,.9,.6)"},
    {translate: `${px(pose.tx)} ${px(pose.ty)}`, rotate: `${pose.rot}deg`, offset: 0.76, easing: "ease-out"},
    {translate: `${px(pose.tx)} ${px(pose.ty - 0.035 * S)}`, rotate: `${(pose.rot + 6).toFixed(1)}deg`, offset: 0.87, easing: "ease-in"},
    {translate: `${px(pose.tx)} ${px(pose.ty)}`, rotate: `${pose.rot}deg`},
  ], {duration: 1500, delay}).then(() => setPose(el, pose));
}

function spawnBurst(st, text) {
  const burst = document.createElement("div");
  burst.className = "wheel-break-burst";
  burst.textContent = text;
  st.holder.appendChild(burst);
  play(burst, [
    {transform: "scale(.2) rotate(-14deg)", opacity: 0},
    {transform: "scale(1.15) rotate(-8deg)", opacity: 1, offset: 0.25},
    {transform: "scale(1) rotate(-8deg)", opacity: 1, offset: 0.75},
    {transform: "scale(1.05) rotate(-8deg)", opacity: 0},
  ], {duration: 1100, easing: "ease-out"}).then(() => burst.remove());
  // A handful of splinters.
  for (let i = 0; i < 16; i++) {
    const chip = document.createElement("i");
    chip.className = "wheel-break-chip";
    const a = rand(0, Math.PI * 2), d = rand(0.25, 0.7) * st.size;
    const s = rand(5, 11);
    chip.style.cssText = `width:${s}px;height:${s * 0.45}px;`;
    st.holder.appendChild(chip);
    play(chip, [
      {translate: "0 0", rotate: "0deg", opacity: 1},
      {translate: `${px(Math.cos(a) * d)} ${px(Math.sin(a) * d + 0.12 * st.size)}`, rotate: `${rand(-540, 540).toFixed(0)}deg`, opacity: 0},
    ], {duration: rand(650, 1100), easing: "cubic-bezier(.1,.7,.4,1)"}).then(() => chip.remove());
  }
}

function showRepairButton(st) {
  const {wrap, holder} = st;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wheel-repair-btn";
  btn.setAttribute("aria-label", "Починить колесо");
  btn.innerHTML = "<span aria-hidden=\"true\">🔧</span> Починить";
  btn.style.left = `${holder.offsetLeft + st.size / 2}px`;
  btn.style.top = `${holder.offsetTop + st.size / 2}px`;
  wrap.appendChild(btn);
  st.btn = btn;
  play(btn, [
    {opacity: 0, translate: "-50% -30%", scale: "0.6"},
    {opacity: 1, translate: "-50% -50%", scale: "1"},
  ], {duration: 320, easing: "cubic-bezier(.3,1.5,.5,1)"});
  try { btn.focus({preventScroll: true}); } catch { /* ignore */ }
}

export async function breakWheel(wrap) {
  const holder = wrap.querySelector(".wheel-holder");
  const mask = wrap.querySelector(".wheel-canvas-mask");
  const canvas = wrap.querySelector(".wheel-canvas");
  if (!holder || !mask || !canvas) return;
  const n = (wrap._wheelPool || []).length;
  const reduced = wheelPrefersReducedMotion();
  const st = {
    wrap, holder, mask, canvas, size: holder.offsetWidth, phase: "breaking",
    pieces: [], stage: null, url: null, btn: null, plan: makePlan(),
    hub: holder.querySelector(".wheel-hub-media"), pointer: holder.querySelector(".wheel-pointer"),
    titleEl: canvas._wheelTitleEl, cancelStrain: null,
  };
  wrap._breakState = st;
  wrap.classList.add("wheel-wrap--breaking");

  // Same hand-off a real spin does: the wheel is ours until we say otherwise.
  wheelSpinState.active = true;
  stopWheelIdle(canvas);
  hideWheelHoverLabel(canvas);
  canvas._idleHovering = false;
  canvas._hoverLocked = true;
  canvas._idleHoverIdx = -1;
  wheelIdleRedraw(canvas, -1);
  holder.style.transition = "none";
  if (st.pointer) st.pointer.classList.remove("wheel-pointer--flick");

  if (!reduced) {
    const ok = await strain(st);
    if (!ok) return;
    holder.style.transform = "";
  }

  // Swap the disc for pieces of itself.
  let polygons = [];
  try {
    st.url = await snapshotWheel(canvas);
    polygons = shardPolygons(st.plan, getCanvasRotationDeg(canvas));
  } catch {
    polygons = [];
  }
  if (!alive(st)) return;

  playWheelSfx("crack");
  if (st.titleEl) { canvas._wheelTitleEl = null; st.titleEl.textContent = "Колесо сломалось 💥"; }
  const jobs = [];
  if (polygons.length) {
    const {stage, pieces} = makePieces(st, polygons, st.url);
    st.stage = stage; st.pieces = pieces;
    holder.insertBefore(stage, st.pointer || null);
    mask.style.visibility = "hidden";
    if (reduced) pieces.forEach((p) => setPose(p.el, p.pose));
    else pieces.forEach((p, i) => jobs.push(flyApart(p, st.size, i * 45)));
  } else {
    // Fallback: the disc cannot be cut up, so it just sags as a whole.
    st.pieces = [{el: mask, pose: {tx: 0, ty: 0.05 * st.size, rot: 7}}];
    if (reduced) setPose(mask, st.pieces[0].pose);
    else jobs.push(play(mask, [{translate: "0 0", rotate: "0deg"}, {translate: `0 ${px(0.05 * st.size)}`, rotate: "7deg"}], {duration: 700, easing: "cubic-bezier(.3,1.6,.5,1)"}).then(() => setPose(mask, st.pieces[0].pose)));
  }
  if (!reduced) {
    spawnBurst(st, "КРАК!");
    holder.animate([{translate: "0 0"}, {translate: "7px -5px"}, {translate: "-6px 4px"}, {translate: "4px -2px"}, {translate: "0 0"}], {duration: 380});
    if (st.hub) {
      const hx = rand(-0.3, 0.3) * st.size, rest = 0.34 * st.size;
      jobs.push(play(st.hub, [
        {translate: "0 0", rotate: "0deg", easing: "cubic-bezier(.2,.7,.3,1)"},
        {translate: `${px(hx * 0.6)} ${px(-0.5 * st.size)}`, rotate: "360deg", offset: 0.4, easing: "cubic-bezier(.5,0,.9,.6)"},
        {translate: `${px(hx)} ${px(rest)}`, rotate: "620deg", offset: 0.8, easing: "ease-out"},
        {translate: `${px(hx)} ${px(rest - 0.06 * st.size)}`, rotate: "650deg", offset: 0.9, easing: "ease-in"},
        {translate: `${px(hx)} ${px(rest)}`, rotate: "680deg"},
      ], {duration: 1600, delay: 60}).then(() => { st.hubPose = {tx: hx, ty: rest, rot: 680}; if (st.hub) setPose(st.hub, st.hubPose); }));
    }
    if (st.pointer) {
      jobs.push(play(st.pointer, [
        {translate: "0 0", rotate: "0deg"},
        {translate: `${px(-0.07 * st.size)} ${px(0.04 * st.size)}`, rotate: "-62deg"},
      ], {duration: 900, delay: 80, easing: "cubic-bezier(.3,1.7,.5,1)"}).then(() => { st.pointerPose = {tx: -0.07 * st.size, ty: 0.04 * st.size, rot: -62}; setPose(st.pointer, st.pointerPose); }));
    }
    jobs.push(play(holder, [{rotate: "0deg"}, {rotate: "-3deg"}], {duration: 900, delay: 100, easing: "cubic-bezier(.3,1.6,.5,1)"}).then(() => { holder.style.rotate = "-3deg"; }));
    await Promise.all(jobs);
  } else {
    if (st.hub) { st.hubPose = {tx: 0.1 * st.size, ty: 0.34 * st.size, rot: 40}; setPose(st.hub, st.hubPose); }
    if (st.pointer) { st.pointerPose = {tx: -0.07 * st.size, ty: 0.04 * st.size, rot: -62}; setPose(st.pointer, st.pointerPose); }
    holder.style.rotate = "-3deg";
  }
  if (!alive(st)) return;

  // Broken and idle: nothing is animating, so the page may lay itself out again.
  st.phase = "broken";
  wheelSpinState.active = false;
  showRepairButton(st);
  announce(`Колесо сломалось: в нём ${n} позиций. Нажмите «Починить».`);
}

// Pressing "Крутить" while the wheel is in pieces: the button is the answer.
export function nudgeRepair(wrap) {
  const st = wrap && wrap._breakState;
  if (!st || !st.btn) return;
  playWheelSfx("clack");
  play(st.btn, [
    {translate: "-50% -50%", rotate: "0deg"}, {translate: "-56% -50%", rotate: "-4deg"},
    {translate: "-44% -50%", rotate: "4deg"}, {translate: "-50% -50%", rotate: "0deg"},
  ], {duration: 320});
  try { st.btn.focus({preventScroll: true}); } catch { /* ignore */ }
}

// ---- the repair ------------------------------------------------------------------

function hammerSvg(st) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "wheel-hammer-layer");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<g class="wb-hammer" opacity="0"><g class="wb-swing" style="transform-origin:0px 22px">`
    + `<rect x="-1.4" y="0" width="2.8" height="22" rx="1.1" fill="#8a5a2b" stroke="#3d2411" stroke-width=".4"/>`
    + `<rect x="-6.8" y="-4.8" width="13.6" height="6.4" rx="1.3" fill="#b4bac5" stroke="#3f434c" stroke-width=".45"/>`
    + `<rect x="-5.8" y="-4" width="11.6" height="1.5" rx=".7" fill="#fff" opacity=".45"/></g></g>`;
  st.holder.appendChild(svg);
  return svg;
}

async function hammerNail(st, svg, nailEl, x, y, rotDeg) {
  const hammer = svg.querySelector(".wb-hammer");
  const swing = svg.querySelector(".wb-swing");
  // The patch layer is turned by the wheel's angle; the hammer layer is not.
  const a = rotDeg * Math.PI / 180;
  const sx = 50 + (x - 50) * Math.cos(a) - (y - 50) * Math.sin(a);
  const sy = 50 + (x - 50) * Math.sin(a) + (y - 50) * Math.cos(a);
  hammer.setAttribute("transform", `translate(${sx.toFixed(2)} ${(sy - 1.6).toFixed(2)})`);
  hammer.setAttribute("opacity", "1");
  for (let hit = 0; hit < 2; hit++) {
    await play(swing, [{transform: "rotate(-58deg)"}, {transform: "rotate(0deg)"}], {duration: 120, easing: "cubic-bezier(.6,0,1,1)"});
    if (!alive(st)) return;
    playWheelSfx("hammer");
    st.holder.animate([{translate: "0 0"}, {translate: "0 2px"}, {translate: "0 0"}], {duration: 90});
    play(nailEl, [{opacity: hit ? 1 : 0.6, transform: hit ? "scale(1.5)" : "scale(0.3)"}, {opacity: 1, transform: "scale(1)"}], {duration: 130, fill: "forwards"});
    nailEl.style.opacity = "1";
    await sleep(70);
    if (hit === 0) await play(swing, [{transform: "rotate(0deg)"}, {transform: "rotate(-42deg)"}], {duration: 90, easing: "ease-out", fill: "forwards"});
  }
  hammer.setAttribute("opacity", "0");
}

export async function repairWheel(wrap) {
  const st = wrap && wrap._breakState;
  if (!st || st.phase !== "broken") return;
  st.phase = "repairing";
  wheelSpinState.active = true;
  const reduced = wheelPrefersReducedMotion();
  const {holder, mask, canvas} = st;
  const S = st.size;

  if (st.btn) {
    const b = st.btn; st.btn = null;
    play(b, [{opacity: 1, scale: "1"}, {opacity: 0, scale: "0.7"}], {duration: 180}).then(() => b.remove());
  }
  if (st.titleEl) st.titleEl.textContent = "Чиним…";
  announce("Чиним колесо.");

  // 1. Every piece hops back to where it belongs.
  const home = (el, pose, delay) => (pose
    ? play(el, [{translate: `${px(pose.tx)} ${px(pose.ty)}`, rotate: `${pose.rot}deg`}, {translate: "0px 0px", rotate: "0deg"}],
      {duration: 650, delay, easing: "cubic-bezier(.3,1.5,.5,1)"}).then(() => { el.style.translate = ""; el.style.rotate = ""; })
    : Promise.resolve());
  if (!reduced) {
    const jobs = st.pieces.map((p, i) => home(p.el, p.pose, i * 90));
    jobs.push(home(st.hub, st.hubPose, 120), home(st.pointer, st.pointerPose, 300));
    jobs.push(play(holder, [{rotate: "-3deg"}, {rotate: "0deg"}], {duration: 650, delay: 200, easing: "cubic-bezier(.3,1.5,.5,1)"}));
    st.pieces.forEach((_, i) => setTimeout(() => playWheelSfx("clack"), 560 + i * 90));
    await Promise.all(jobs);
  }
  for (const el of [st.hub, st.pointer, ...st.pieces.map((p) => p.el)]) if (el) { el.style.translate = ""; el.style.rotate = ""; }
  holder.style.rotate = "";
  if (!alive(st)) return;

  // 2. Whole again (hairline cracks and all): the real disc replaces the pieces.
  mask.style.visibility = "";
  if (st.stage) st.stage.remove();
  wheelBreakState.plan = st.plan;
  const layer = attachWheelPatches(canvas, mask);
  const planks = [...layer.querySelectorAll(".wb-plank")];
  const tapes = [...layer.querySelectorAll(".wb-tape")];
  const hideAll = [...planks, ...tapes, ...layer.querySelectorAll(".wb-nail")];

  if (!reduced) {
    hideAll.forEach((el) => { el.style.opacity = "0"; });
    const rot = getCanvasRotationDeg(canvas);
    const hammerLayer = hammerSvg(st);
    await sleep(250);

    // 3. Planks, then the nails that hold them.
    for (let k = 0; k < planks.length; k++) {
      if (!alive(st)) return;
      const plank = planks[k];
      const inner = plank.querySelector(".wb-in");
      plank.style.opacity = "1";
      await play(inner, [{opacity: 0, transform: "translateY(-9px) scale(1.5)"}, {opacity: 1, transform: "translateY(0) scale(1)"}], {duration: 260, easing: "cubic-bezier(.5,0,1,.6)", fill: "backwards"});
      playWheelSfx("hammer");
      holder.animate([{translate: "0 0"}, {translate: "0 3px"}, {translate: "0 0"}], {duration: 110});
      const nails = [...plank.querySelectorAll(".wb-nail")];
      for (let i = 0; i < nails.length; i++) {
        const nl = st.plan.planks[k].nails[i];
        await hammerNail(st, hammerLayer, nails[i], nl.x, nl.y, rot);
        if (!alive(st)) return;
      }
      await sleep(80);
    }
    hammerLayer.remove();

    // 4. Duct tape for everything the nails could not reach.
    for (const tape of tapes) {
      if (!alive(st)) return;
      const inner = tape.querySelector(".wb-in");
      tape.style.opacity = "1";
      inner.style.transformOrigin = "0% 50%";
      playWheelSfx("tape");
      await play(inner, [{transform: "scaleX(0)"}, {transform: "scaleX(1)"}], {duration: 300, easing: "cubic-bezier(.3,.6,.4,1)", fill: "backwards"});
      inner.style.transformOrigin = "";
    }
    hideAll.forEach((el) => { el.style.opacity = ""; });
  }
  if (!alive(st)) return;

  // 5. Done: the wheel works again, with its scars.
  wheelBreakState.patched = true;
  playWheelSfx("fixed");
  if (!reduced) play(holder, [{transform: "scale(1)"}, {transform: "scale(1.05)"}, {transform: "scale(1)"}], {duration: 380, easing: "cubic-bezier(.3,1.6,.5,1)"});
  holder.style.transition = "";
  holder.style.transform = "";
  if (st.titleEl) { canvas._wheelTitleEl = st.titleEl; updatePointerTitle(canvas, getCanvasRotationDeg(canvas)); }
  canvas._hoverLocked = false;
  wrap._breakState = null;
  if (st.url) URL.revokeObjectURL(st.url);
  wrap.classList.remove("wheel-wrap--breaking");
  wheelSpinState.active = false;
  startWheelIdle(canvas);
  announce("Колесо починено. Можно крутить.");
}
