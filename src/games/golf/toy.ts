import { BALL_R, CUP_R, LASER_R, newSim, rng, type Course, type Sim, type Vec } from "./engine";

// The look: flat and straight down, in fixed natural golf colors, on a dot grid in the app theme's
// own background. Every part of the course is its own small drawing below (the board, a rail, a
// bumper, the cup, the flag, the ball, a box, a pad, a ramp, a mine), each taking how far along its
// animation is, so the asset sheet and the game draw exactly the same things.
//
// Rules the parts follow: one family of colors per kind of thing; the things you play with (ball,
// cup, bumpers, boxes) stand out by brightness from the grass and rails, not just by hue; nothing
// pretends to have depth. Motion is where the life is: the ball squashes against what it hits and
// stretches when it's fast, bumpers swell, the flag flies off when the ball drops, things pop in.

type Ctx = CanvasRenderingContext2D;

export const PALETTE = {
  grass: "#5c9a4b", // Dunn-Edwards' "Golf Course" green, nudged warmer
  mow: "#67a455", // the other way of the mowing stripes
  putting: "#4f8f40", // cut shorter round the cup
  rail: "#ece4d0", // a painted rail
  railLine: "#d6ccb3",
  bumper: "#b5533f",
  bumperRing: "#ece4d0",
  cup: "#1d2a1a",
  flag: "#c4473a",
  box: "#d4aa44",
  boxInk: "#5a4212",
  pad: "#c9853f",
  ramp: "#5f819c",
  sand: "#d8c9a8",
  mine: "#3a3934",
  mineLight: "#e0503f",
  ball: "#fbf9f3",
  ballShade: "#e1ddd2",
  ink: "#fbf9f3", // the aim line and markers
} as const;
const C = PALETTE;
export const CONFETTI = [C.flag, C.box, "#8cbf6a", C.ramp, C.rail];

// The void and its dots come from the app's theme: its background, and its border color for the dots.
let theme: { bg: string; dot: string } | null = null;
export function refreshTheme() {
  theme = null;
}
function themeColors() {
  if (!theme) {
    const cs = typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null;
    theme = { bg: cs?.getPropertyValue("--background").trim() || "#1c2620", dot: cs?.getPropertyValue("--border").trim() || "rgba(255,255,255,0.08)" };
  }
  return theme;
}

// --- Small helpers ---

function path(ctx: Ctx, pts: Vec[], closed = true) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
}
function circ(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.001, r), 0, Math.PI * 2);
}
// Text at a world position and size, drawn in device pixels: tiny fractional font sizes under a big
// scale render badly on Safari.
function worldText(ctx: Ctx, text: string, x: number, y: number, size: number, fill: string, stroke?: string, scale = 1) {
  const m = ctx.getTransform();
  const px = m.a * x + m.c * y + m.e, py = m.b * x + m.d * y + m.f;
  const fs = size * m.a * scale;
  if (fs < 3) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `800 ${fs}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = fs * 0.22;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, px, py);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, px, py);
  ctx.restore();
}

// A quick overshoot, for things popping in: 0 to 1, a little past 1, settling at 1.
export const popIn = (k: number) => (k >= 1 ? 1 : k <= 0 ? 0 : 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2);
const ease = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;

// --- The parts ---

export function drawBoard(ctx: Ctx, boards: Vec[][], cup: Vec | null, view: { x0: number; y0: number; x1: number; y1: number }) {
  for (const b of boards) {
    path(ctx, b);
    ctx.fillStyle = C.grass;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Mowing stripes, on the diagonal like a real green.
    ctx.fillStyle = C.mow;
    const band = 2.4;
    const { x0, y0, x1, y1 } = view;
    for (let k = Math.floor((x0 + y0) / (band * 2)) * band * 2; k < x1 + y1 + band * 2; k += band * 2) {
      ctx.beginPath();
      ctx.moveTo(k - y1, y1);
      ctx.lineTo(k + band - y1, y1);
      ctx.lineTo(k + band - y0, y0);
      ctx.lineTo(k - y0, y0);
      ctx.closePath();
      ctx.fill();
    }
    if (cup) {
      circ(ctx, cup.x, cup.y, 3.2);
      ctx.fillStyle = C.putting;
      ctx.fill();
    }
    ctx.restore();
  }
}

// A rail: flat, with a thin line just inside its edge so it reads as a made thing, not a stroke.
export function drawRail(ctx: Ctx, pts: Vec[], closed: boolean, w: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  path(ctx, pts, closed);
  ctx.strokeStyle = C.rail;
  ctx.lineWidth = w;
  ctx.stroke();
  path(ctx, pts, closed);
  ctx.strokeStyle = C.railLine;
  ctx.lineWidth = w * 0.18;
  ctx.stroke();
}

// A bumper. `pop` runs 0 to 1 after a hit: it swells, flashes and settles.
export function drawBumper(ctx: Ctx, at: Vec, r: number, pop = 1) {
  const swell = pop < 1 ? Math.sin(pop * Math.PI) : 0;
  const R = r * (1 + swell * 0.22);
  circ(ctx, at.x, at.y, R);
  ctx.fillStyle = swell > 0.9 ? C.rail : C.bumper; // a flash right at the peak
  ctx.fill();
  ctx.lineWidth = R * 0.2;
  ctx.strokeStyle = C.bumperRing;
  circ(ctx, at.x, at.y, R * 0.6);
  ctx.stroke();
  // A ring thrown off by the hit.
  if (pop < 1) {
    ctx.globalAlpha = 1 - pop;
    ctx.strokeStyle = C.bumper;
    ctx.lineWidth = 0.12;
    circ(ctx, at.x, at.y, R + pop * 1.4);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function drawCup(ctx: Ctx, at: Vec, r: number) {
  circ(ctx, at.x, at.y, r + 0.12);
  ctx.fillStyle = C.rail;
  ctx.fill();
  circ(ctx, at.x, at.y, r);
  ctx.fillStyle = C.cup;
  ctx.fill();
}

// The flag: a pole and a pennant that ripples. `out` runs 0 to 1 as it's pulled when the ball drops:
// it lifts away and fades.
export function drawFlag(ctx: Ctx, at: Vec, t: number, alpha = 1, out = 0) {
  if (alpha <= 0 || out >= 1) return;
  ctx.globalAlpha = alpha * (1 - out);
  const lift = ease(out) * 2.5;
  const base = { x: at.x, y: at.y - lift };
  ctx.strokeStyle = C.rail;
  ctx.lineWidth = 0.13;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(base.x, base.y - 2.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - 2.6);
  for (let k = 1; k <= 6; k++) {
    const u = k / 6;
    ctx.lineTo(base.x + u * 1.4, base.y - 2.6 + u * 0.45 + Math.sin(t * 5 - u * 3) * 0.06 * u);
  }
  for (let k = 6; k >= 0; k--) {
    const u = k / 6;
    ctx.lineTo(base.x + u * 1.4, base.y - 1.7 - u * 0.45 + Math.sin(t * 5 - u * 3) * 0.06 * u);
  }
  ctx.closePath();
  ctx.fillStyle = C.flag;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// The ball. `stretch` runs along its direction of travel (above 1 when it's fast), `squash` flattens
// it against whatever it just hit (normal `n`), `scale` is for popping in and dropping out.
export function drawBall(ctx: Ctx, x: number, y: number, r: number, o: { dir?: number; stretch?: number; squash?: number; n?: number; scale?: number; alpha?: number } = {}) {
  const s = o.scale ?? 1;
  if (s <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.translate(x, y);
  let sx = 1, sy = 1, rot = 0;
  if (o.squash && o.squash > 0) {
    rot = o.n ?? 0;
    sx = 1 - o.squash * 0.35;
    sy = 1 + o.squash * 0.25;
  } else if (o.stretch && o.stretch > 1) {
    rot = o.dir ?? 0;
    sx = o.stretch;
    sy = 1 / Math.sqrt(o.stretch);
  }
  ctx.rotate(rot);
  ctx.scale(sx * s, sy * s);
  circ(ctx, 0, 0, r);
  ctx.fillStyle = C.ball;
  ctx.fill();
  // A soft shade on the bottom right, so it reads as a ball, not a dot.
  ctx.save();
  circ(ctx, 0, 0, r);
  ctx.clip();
  circ(ctx, r * 0.35, r * 0.4, r * 0.95);
  ctx.globalAlpha *= 0.55;
  ctx.fillStyle = C.ballShade;
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

// A mystery box: it breathes a little until you roll through it.
export function drawBox(ctx: Ctx, at: Vec, t: number, i = 0, inkLabel = true) {
  const sz = 1.15 * (1 + Math.sin(t * 3 + i * 1.7) * 0.04);
  ctx.fillStyle = C.box;
  ctx.beginPath();
  ctx.roundRect(at.x - sz / 2, at.y - sz / 2, sz, sz, 0.18);
  ctx.fill();
  if (inkLabel) worldText(ctx, "?", at.x, at.y + sz * 0.05, sz * 0.78, C.boxInk);
}

// A speed pad (chevrons that run) or a jump ramp (a chevron and a lip).
export function drawPad(ctx: Ctx, poly: Vec[], dir: Vec, kind: "boost" | "ramp", t: number) {
  path(ctx, poly);
  ctx.fillStyle = kind === "boost" ? C.pad : C.ramp;
  ctx.fill();
  const m = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(Math.atan2(dir.y, dir.x));
  ctx.strokeStyle = C.rail;
  ctx.lineWidth = 0.22;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const n = kind === "boost" ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * 0.7 + (kind === "boost" ? ((t * 2) % 1) * 0.3 - 0.15 : 0);
    ctx.beginPath();
    ctx.moveTo(o - 0.35, -0.5);
    ctx.lineTo(o + 0.2, 0);
    ctx.lineTo(o - 0.35, 0.5);
    ctx.stroke();
  }
  if (kind === "ramp") {
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(0.9, -0.9);
    ctx.lineTo(0.9, 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawMine(ctx: Ctx, at: Vec, t: number) {
  circ(ctx, at.x, at.y, 0.55);
  ctx.fillStyle = C.mine;
  ctx.fill();
  circ(ctx, at.x, at.y, 0.18);
  ctx.fillStyle = Math.sin(t * 6 + at.x) > 0 ? C.mineLight : "#6e2a20";
  ctx.fill();
}

// --- Frames ---

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx =
  | { kind: "ring" | "splash" | "puff" | "spark" | "confetti" | "boom"; x: number; y: number; t: number; color?: string; seed: number }
  | { kind: "rail"; x: number; y: number; x2: number; y2: number; t: number; color?: string; seed: number }
  | { kind: "label"; x: number; y: number; t: number; text: string; color?: string; seed: number };
// Moments the renderer animates from, all in the frame's time.
export type Juice = {
  start: number; // the hole came up
  spawn: number; // the ball last appeared (on the tee, or back from off the edge)
  impact: { t: number; n: number; power: number } | null; // the ball last hit something, and which way it was pushed
};
export type Frame = {
  c: Course;
  sim: Sim;
  cam: Camera;
  dpr: number;
  t: number;
  trail: Vec[];
  fx: Fx[];
  hits: Map<number, number>; // bumper index -> when it was last hit
  juice?: Juice;
  aim: { angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec } | null;
  target?: { kind: "laser" | "mine" | "railgun"; at: Vec | null } | null; // picking where an item goes
  inset?: { top: number; bottom: number };
};

export function drawFrame(ctx: Ctx, f: Frame) {
  const { c, sim, cam, dpr, t } = f;
  const J = f.juice ?? { start: -9, spawn: -9, impact: null };
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const T = () => ctx.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, (cam.ox - cam.x * cam.s) * dpr, (cam.oy - cam.y * cam.s) * dpr);
  const vx0 = cam.x - cam.ox / cam.s, vy0 = cam.y - cam.oy / cam.s;
  const view = { x0: vx0, y0: vy0, x1: vx0 + W / dpr / cam.s, y1: vy0 + H / dpr / cam.s };

  // The void, and a dot grid that moves with the board.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const th = themeColors();
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  T();
  ctx.fillStyle = th.dot;
  const gap = 1.6;
  for (let x = Math.floor(view.x0 / gap) * gap; x < view.x1; x += gap)
    for (let y = Math.floor(view.y0 / gap) * gap; y < view.y1; y += gap) ctx.fillRect(x - 0.06, y - 0.06, 0.12, 0.12);

  // The course fades up as the hole starts.
  const intro = ease((t - J.start) / 0.4);
  ctx.globalAlpha = intro;
  drawBoard(ctx, c.greens.map((g) => g.poly), c.cup, view);
  for (const z of c.zones) {
    if (z.kind === "sand") {
      path(ctx, z.poly);
      ctx.fillStyle = C.sand;
      ctx.fill();
    } else if (z.kind === "boost" || z.kind === "ramp") drawPad(ctx, z.poly, z.dir, z.kind, t);
  }
  for (const m of sim.mines) if (m.live) drawMine(ctx, m, t);
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.beginPath();
  ctx.roundRect(c.tee.x - 1.1, c.tee.y - 1.1, 2.2, 2.2, 0.35);
  ctx.fill();
  drawCup(ctx, c.cup, CUP_R * sim.cupScale);
  drawFx(ctx, f.fx, t, true);
  for (const g of c.greens) drawRail(ctx, g.poly, true, 0.6);
  for (const w of c.walls) drawRail(ctx, w.pts, !!w.closed, Math.max(0.5, w.w));
  ctx.globalAlpha = 1;

  // The ball's trail: a streak that thins out behind it.
  if (f.trail.length > 1 && sim.mode === "roll")
    for (let i = 1; i < f.trail.length; i++) {
      const k = i / f.trail.length;
      ctx.strokeStyle = `rgba(251,249,243,${0.4 * k})`;
      ctx.lineWidth = BALL_R * 1.5 * k;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(f.trail[i - 1].x, f.trail[i - 1].y);
      ctx.lineTo(f.trail[i].x, f.trail[i].y);
      ctx.stroke();
    }

  // The ball, with its moments: popping onto the tee, squashing against walls, stretching at speed,
  // spiralling into the cup, dropping off the edge.
  const speed = Math.hypot(sim.vx, sim.vy);
  if (sim.mode === "sunk") {
    const k = Math.min(1, sim.modeT / 0.35);
    const a = k * Math.PI * 1.5;
    const rr = (1 - k) * 0.5;
    drawBall(ctx, c.cup.x + Math.cos(a) * rr, c.cup.y + Math.sin(a) * rr, sim.r, { scale: 1 - k * 0.6, alpha: 1 - Math.max(0, k - 0.7) / 0.3 });
  } else if (sim.mode === "out") {
    // Off the edge: it keeps drifting, shrinks and fades.
    const k = Math.min(1, sim.modeT / 0.5);
    drawBall(ctx, sim.x, sim.y, sim.r, { scale: 1 - ease(k), alpha: 1 - k });
  } else {
    const since = t - (J.impact?.t ?? -9);
    const squash = J.impact && since < 0.12 ? (1 - since / 0.12) * Math.min(1, J.impact.power * 3) : 0;
    const lift = sim.z * 0.5;
    if (sim.z > 0) {
      circ(ctx, sim.x + 0.12 + sim.z * 0.3, sim.y + 0.22 + sim.z * 0.5, sim.r);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fill();
    }
    drawBall(ctx, sim.x, sim.y - lift, sim.r * (1 + sim.z * 0.18), {
      dir: Math.atan2(sim.vy, sim.vx),
      stretch: 1 + Math.min(0.35, speed / 70),
      squash,
      n: J.impact?.n,
      scale: popIn((t - J.spawn) / 0.35),
    });
  }

  c.bumpers.forEach((b, i) => {
    if (sim.gone[i]) return;
    drawBumper(ctx, b.at, b.r, Math.min(1, (t - (f.hits.get(i) ?? -9)) / 0.3));
  });
  c.boxes.forEach((b, i) => {
    if (!sim.boxes[i]) drawBox(ctx, b, t, i);
  });

  // The flag stands until the ball's close, and flies off when it drops.
  const near = Math.hypot(sim.x - c.cup.x, sim.y - c.cup.y);
  if (sim.mode === "sunk") drawFlag(ctx, c.cup, t, 1, Math.min(1, sim.modeT / 0.6));
  else drawFlag(ctx, c.cup, t, Math.max(0, Math.min(1, (near - 1.5) / 1.5)) * intro);

  drawFx(ctx, f.fx, t, false);

  // The aim: where the finger went down and how far it's pulled, then a dotted line out to the first
  // bounce and a ring round the ball filling with power.
  if (f.aim && sim.mode === "aim") {
    const { power, line } = f.aim;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (f.aim.from && f.aim.to) {
      ctx.strokeStyle = "rgba(251,249,243,0.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(f.aim.from.x, f.aim.from.y);
      ctx.lineTo(f.aim.to.x, f.aim.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      circ(ctx, f.aim.from.x, f.aim.from.y, 6);
      ctx.fillStyle = "rgba(251,249,243,0.45)";
      ctx.fill();
    }
    T();
    ctx.strokeStyle = C.ink;
    ctx.lineCap = "round";
    ctx.lineWidth = 0.2;
    ctx.setLineDash([0.02, 0.45]);
    path(ctx, line, false);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    ctx.arc(sim.x, sim.y, BALL_R + 0.4, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();
  }

  // Orbital Lasers on their way: a target ring closing in.
  T();
  for (const st of sim.strikes) {
    const k = Math.max(0, Math.min(1, (st.t - sim.t) / 0.9));
    ctx.strokeStyle = C.mineLight;
    ctx.lineWidth = 0.15;
    circ(ctx, st.x, st.y, LASER_R * (0.4 + k * 0.6));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(st.x - 0.6, st.y);
    ctx.lineTo(st.x + 0.6, st.y);
    ctx.moveTo(st.x, st.y - 0.6);
    ctx.lineTo(st.x, st.y + 0.6);
    ctx.stroke();
  }
  // Picking where an item goes.
  if (f.target?.at) {
    const { kind, at } = f.target;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.14;
    ctx.setLineDash([0.4, 0.3]);
    if (kind === "railgun") {
      const dx = at.x - sim.x, dy = at.y - sim.y, d = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(sim.x, sim.y);
      ctx.lineTo(sim.x + (dx / d) * 80, sim.y + (dy / d) * 80);
      ctx.stroke();
    } else {
      circ(ctx, at.x, at.y, kind === "laser" ? LASER_R : 0.6);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (f.inset) holeArrow(ctx, f);
}

// When the cup is off screen, an arrow at the edge points to it.
function holeArrow(ctx: Ctx, f: Frame) {
  const { c, sim, cam, dpr } = f;
  if (sim.mode === "sunk") return;
  const sw = ctx.canvas.width / dpr, sh = ctx.canvas.height / dpr;
  const pad = 30;
  const box = { x0: pad, y0: f.inset!.top + pad, x1: sw - pad, y1: sh - f.inset!.bottom - pad };
  const sx = (c.cup.x - cam.x) * cam.s + cam.ox, sy = (c.cup.y - cam.y) * cam.s + cam.oy;
  if (sx > box.x0 && sx < box.x1 && sy > box.y0 && sy < box.y1) return;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const dx = sx - cx, dy = sy - cy;
  const k = Math.min(Math.abs((dx > 0 ? box.x1 - cx : box.x0 - cx) / (dx || 1e-9)), Math.abs((dy > 0 ? box.y1 - cy : box.y0 - cy) / (dy || 1e-9)));
  const x = cx + dx * k, y = cy + dy * k;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  circ(ctx, x, y, 17);
  ctx.fillStyle = C.flag;
  ctx.fill();
  ctx.strokeStyle = C.rail;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-4, -6.5);
  ctx.lineTo(-1.5, 0);
  ctx.lineTo(-4, 6.5);
  ctx.closePath();
  ctx.fillStyle = C.rail;
  ctx.fill();
  ctx.restore();
}

export function drawFx(ctx: Ctx, fx: Fx[], t: number, ground: boolean) {
  for (const e of fx) {
    const age = t - e.t;
    const r = rng(e.seed);
    if (e.kind === "label") {
      // An item's name floating up off the box it came from.
      const life = 1.2;
      if (age > life || ground) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
      worldText(ctx, e.text, e.x, e.y - 1 - ease(k) * 1.5, 0.9, e.color ?? C.box, C.cup, popIn(Math.min(1, age / 0.25)));
      ctx.globalAlpha = 1;
      continue;
    }
    if (e.kind === "boom") {
      const life = 0.6;
      if (age > life || !ground) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - k;
      circ(ctx, e.x, e.y, (e.color === "big" ? LASER_R : 1.4) * (0.5 + k));
      ctx.fillStyle = k < 0.25 ? "#fff2c4" : C.pad;
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (e.kind === "rail") {
      const life = 0.5;
      if (age > life || ground) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "#cfe9f2";
      ctx.lineWidth = 0.5 * (1 - k) + 0.1;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }
    const onGround = e.kind === "ring" || e.kind === "splash" || e.kind === "puff";
    if (onGround !== ground) continue;
    if (e.kind === "ring" || e.kind === "splash") {
      const life = 0.45;
      if (age > life) continue;
      const k = age / life;
      ctx.strokeStyle = e.color ?? C.rail;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.lineWidth = 0.14;
      circ(ctx, e.x, e.y, 0.5 + ease(k) * 1.6);
      ctx.stroke();
    } else if (e.kind === "puff") {
      const life = 0.45;
      if (age > life) continue;
      const k = age / life;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.fillStyle = e.color ?? C.rail;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r();
        circ(ctx, e.x + Math.cos(a) * ease(k) * 0.9, e.y + Math.sin(a) * ease(k) * 0.9, 0.16 * (1 - k));
        ctx.fill();
      }
    } else {
      const life = e.kind === "confetti" ? 1.6 : 0.6;
      if (age > life) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - k;
      const n = e.kind === "confetti" ? 34 : 12;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, sp = 1.5 + r() * 2.5;
        const spin = r() * 10;
        ctx.save();
        ctx.translate(e.x + Math.cos(a) * sp * ease(k), e.y + Math.sin(a) * sp * ease(k) + k * k * 2);
        ctx.rotate(spin * k);
        ctx.fillStyle = e.kind === "confetti" ? CONFETTI[i % CONFETTI.length] : (e.color ?? C.box);
        ctx.fillRect(-0.1, -0.06, 0.2, e.kind === "confetti" ? 0.12 : 0.2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// The whole hole as a picture, for the list.
export function still(c: Course, width: number): HTMLCanvasElement {
  const el = document.createElement("canvas");
  const s = width / c.w;
  el.width = Math.round(width);
  el.height = Math.round(c.h * s);
  drawFrame(el.getContext("2d")!, {
    c,
    sim: newSim(c),
    cam: { x: c.w / 2, y: c.h / 2, s, ox: el.width / 2, oy: el.height / 2 },
    dpr: 1,
    t: 5,
    trail: [],
    fx: [],
    hits: new Map(),
    aim: null,
  });
  return el;
}
