import { BALL_R, CUP_R, rng, type Course, type Sim, type Vec } from "./engine";

// Bumper Plains' look: a mini golf board floating in the void. The void is a dark dot grid; the board
// is a thick green slab with a shadow under it, chunky cream walls you can see the sides of, and red
// bumpers that pop when the ball hits them. Everything is drawn straight to the screen each frame.

type Ctx = CanvasRenderingContext2D;

const C = {
  void: "#14161c",
  dot: "#2a2e38",
  slab: "#3f8f3c", // the board's sides
  slabDark: "#2f6e2e",
  carpet: "#6fcf5f",
  stripe: "rgba(255,255,255,0.07)",
  wallTop: "#fff6e2",
  wallSide: "#d8c49e",
  bumperTop: "#ff5a4e",
  bumperSide: "#b83a32",
  bumperRing: "#ffffff",
  cup: "#123214",
  flag: "#ff4b4b",
  box: "#ffcd4d",
  boxSide: "#e0a32a",
  ball: "#ffffff",
  ui: "#ffffff",
};
const SLAB = 0.9; // how thick the board looks
const WALL_UP = 0.32; // how much of a wall's side shows
const BUMP_UP = 0.4;

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx = { kind: "ring" | "splash" | "puff" | "spark" | "confetti"; x: number; y: number; t: number; color?: string; seed: number };
export type Frame = {
  c: Course;
  sim: Sim;
  cam: Camera;
  dpr: number;
  t: number;
  trail: Vec[];
  fx: Fx[];
  hits: Map<number, number>; // bumper index -> when it was last hit
  aim: { angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec } | null;
  inset?: { top: number; bottom: number };
};

function path(ctx: Ctx, pts: Vec[], dx = 0, dy = 0, closed = true) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)));
  if (closed) ctx.closePath();
}
function circ(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.001, r), 0, Math.PI * 2);
}

export function drawFrame(ctx: Ctx, f: Frame) {
  const { c, sim, cam, dpr, t } = f;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const T = () => ctx.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, (cam.ox - cam.x * cam.s) * dpr, (cam.oy - cam.y * cam.s) * dpr);
  const vx0 = cam.x - cam.ox / cam.s, vy0 = cam.y - cam.oy / cam.s;
  const vx1 = vx0 + W / dpr / cam.s, vy1 = vy0 + H / dpr / cam.s;

  // The void, and a dot grid that moves with the board.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = C.void;
  ctx.fillRect(0, 0, W, H);
  T();
  ctx.fillStyle = C.dot;
  const gap = 1.6;
  for (let x = Math.floor(vx0 / gap) * gap; x < vx1; x += gap)
    for (let y = Math.floor(vy0 / gap) * gap; y < vy1; y += gap) ctx.fillRect(x - 0.06, y - 0.06, 0.12, 0.12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const boards = c.greens.map((g) => g.poly);
  // A soft shadow on the void, then the slab's sides, then its top.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = cam.s * dpr * 1.2;
  ctx.shadowOffsetY = cam.s * dpr * 1.4;
  ctx.fillStyle = C.slabDark;
  for (const b of boards) {
    path(ctx, b, 0, SLAB);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = C.slab;
  for (const b of boards)
    for (let d = SLAB; d > 0; d -= 0.08) {
      path(ctx, b, 0, d);
      ctx.fill();
    }
  for (const b of boards) {
    path(ctx, b);
    ctx.fillStyle = C.carpet;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = C.stripe;
    for (let y = Math.floor(vy0 / 4) * 4; y < vy1; y += 4) ctx.fillRect(vx0, y, vx1 - vx0, 2);
    ctx.restore();
  }

  // Tee mat.
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.beginPath();
  ctx.roundRect(c.tee.x - 1.1, c.tee.y - 1.1, 2.2, 2.2, 0.35);
  ctx.fill();

  // The cup.
  const cupR = CUP_R * sim.cupScale;
  circ(ctx, c.cup.x, c.cup.y, cupR + 0.1);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fill();
  circ(ctx, c.cup.x, c.cup.y, cupR);
  ctx.fillStyle = C.cup;
  ctx.fill();
  ctx.save();
  circ(ctx, c.cup.x, c.cup.y, cupR);
  ctx.clip();
  circ(ctx, c.cup.x, c.cup.y + cupR * 0.5, cupR);
  ctx.fillStyle = "#081a09";
  ctx.fill();
  ctx.restore();

  drawFx(ctx, f.fx, t, true);

  // Walls: the board's edge and any baffles, chunky, side first then top.
  const walls = [...boards.map((pts) => ({ pts, w: 0.55, closed: true })), ...c.walls.map((w) => ({ pts: w.pts, w: Math.max(0.5, w.w), closed: !!w.closed }))];
  for (const w of walls) {
    ctx.strokeStyle = C.wallSide;
    ctx.lineWidth = w.w;
    path(ctx, w.pts, 0, WALL_UP, w.closed);
    ctx.stroke();
    path(ctx, w.pts, 0, WALL_UP / 2, w.closed);
    ctx.stroke();
  }
  for (const w of walls) {
    ctx.strokeStyle = C.wallTop;
    ctx.lineWidth = w.w;
    path(ctx, w.pts, 0, 0, w.closed);
    ctx.stroke();
  }

  // The ball's trail and the ball, under the bumpers' tops so it can't sit on them.
  const out = sim.mode === "out" ? Math.min(1, sim.modeT / 0.5) : 0;
  const sinking = sim.mode === "sunk" ? Math.min(1, sim.modeT / 0.25) : 0;
  if (f.trail.length > 1 && sim.mode === "roll")
    for (let i = 1; i < f.trail.length; i++) {
      const k = i / f.trail.length;
      ctx.strokeStyle = `rgba(255,255,255,${0.45 * k})`;
      ctx.lineWidth = BALL_R * 1.5 * k;
      ctx.beginPath();
      ctx.moveTo(f.trail[i - 1].x, f.trail[i - 1].y);
      ctx.lineTo(f.trail[i].x, f.trail[i].y);
      ctx.stroke();
    }
  const bx = sinking ? sim.x + (c.cup.x - sim.x) * sinking : sim.x;
  const by = sinking ? sim.y + (c.cup.y - sim.y) * sinking : sim.y;
  if (sinking < 1 && out < 1) {
    const R = BALL_R * (1 + sim.z * 0.18) * (1 - sinking * 0.5) * (1 - out);
    circ(ctx, bx + 0.12 + sim.z * 0.3, by + 0.22 + sim.z * 0.5, BALL_R * (1 - out));
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fill();
    const lift = sim.z * 0.5;
    const g = ctx.createRadialGradient(bx - R * 0.35, by - lift - R * 0.4, R * 0.1, bx, by - lift, R);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#d9dde2");
    circ(ctx, bx, by - lift, R);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // Bumpers: red cylinders with a white ring on top. Hit, they swell and flash.
  c.bumpers.forEach((b, i) => {
    const age = t - (f.hits.get(i) ?? -9);
    const pop = age < 0.25 ? Math.sin((age / 0.25) * Math.PI) : 0;
    const r = b.r * (1 + pop * 0.22);
    circ(ctx, b.at.x + 0.15, b.at.y + 0.35, b.r);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();
    ctx.fillStyle = C.bumperSide;
    circ(ctx, b.at.x, b.at.y + BUMP_UP, r);
    ctx.fill();
    ctx.fillRect(b.at.x - r, b.at.y, r * 2, BUMP_UP);
    circ(ctx, b.at.x, b.at.y, r);
    ctx.fillStyle = pop > 0.5 ? "#ffffff" : C.bumperTop;
    ctx.fill();
    ctx.lineWidth = r * 0.22;
    ctx.strokeStyle = C.bumperRing;
    circ(ctx, b.at.x, b.at.y, r * 0.62);
    ctx.stroke();
    circ(ctx, b.at.x - r * 0.3, b.at.y - r * 0.32, r * 0.14);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fill();
  });

  // Mystery boxes: a little cube that bobs.
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const s = 1.1, lift = 0.25 + Math.sin(t * 3 + i) * 0.1;
    circ(ctx, b.x + 0.15, b.y + 0.4, s * 0.45);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fill();
    ctx.fillStyle = C.boxSide;
    ctx.fillRect(b.x - s / 2, b.y - lift, s, 0.4);
    ctx.fillStyle = C.box;
    ctx.beginPath();
    ctx.roundRect(b.x - s / 2, b.y - lift - s * 0.85, s, s * 0.85, 0.12);
    ctx.fill();
  });

  // The flag, gone once the ball's close.
  const near = Math.hypot(sim.x - c.cup.x, sim.y - c.cup.y);
  const flagA = sim.mode === "sunk" ? 0 : Math.max(0, Math.min(1, (near - 1.5) / 1.5));
  if (flagA > 0) {
    ctx.globalAlpha = flagA;
    const top = { x: c.cup.x, y: c.cup.y - 2.2 };
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(c.cup.x, c.cup.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const wave = Math.sin(t * 4) * 0.08;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + 1.2, top.y + 0.35 + wave);
    ctx.lineTo(top.x, top.y + 0.75);
    ctx.closePath();
    ctx.fillStyle = C.flag;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawFx(ctx, f.fx, t, false);

  // Screen-space bits: question marks, the aim, the arrow to the cup.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.max(8, cam.s * 0.75)}px system-ui, sans-serif`;
  ctx.fillStyle = "#7a4a00";
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const lift = 0.25 + Math.sin(t * 3 + i) * 0.1;
    ctx.fillText("?", (b.x - cam.x) * cam.s + cam.ox, (b.y - lift - 0.45 - cam.y) * cam.s + cam.oy);
  });

  if (f.aim && sim.mode === "aim") {
    const { power, line } = f.aim;
    if (f.aim.from && f.aim.to) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(f.aim.from.x, f.aim.from.y);
      ctx.lineTo(f.aim.to.x, f.aim.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      circ(ctx, f.aim.from.x, f.aim.from.y, 6);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fill();
    }
    T();
    ctx.strokeStyle = C.ui;
    ctx.lineWidth = 0.2;
    ctx.setLineDash([0.02, 0.45]);
    path(ctx, line, 0, 0, false);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    ctx.arc(sim.x, sim.y, BALL_R + 0.4, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();
  }
  if (f.inset) holeArrow(ctx, f);
}

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
  ctx.strokeStyle = "#ffffff";
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
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

function drawFx(ctx: Ctx, fx: Fx[], t: number, ground: boolean) {
  for (const e of fx) {
    const age = t - e.t;
    const r = rng(e.seed);
    const onGround = e.kind === "ring" || e.kind === "splash" || e.kind === "puff";
    if (onGround !== ground) continue;
    if (e.kind === "ring" || e.kind === "splash") {
      const life = 0.45;
      if (age > life) continue;
      const k = age / life;
      ctx.strokeStyle = e.color ?? "#ffffff";
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 0.14;
      circ(ctx, e.x, e.y, 0.6 + k * 1.8);
      ctx.stroke();
    } else if (e.kind !== "puff") {
      const life = e.kind === "confetti" ? 1.6 : 0.6;
      if (age > life) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - k;
      const n = e.kind === "confetti" ? 34 : 12;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, sp = 1.5 + r() * 2.5;
        const ease = 1 - (1 - k) ** 3;
        ctx.fillStyle = e.kind === "confetti" ? ["#ff5a5a", "#ffd84a", "#4ae07a", "#4ab8ff", "#c07aff"][i % 5] : (e.color ?? C.box);
        ctx.fillRect(e.x + Math.cos(a) * sp * ease - 0.1, e.y + Math.sin(a) * sp * ease - 0.1 + k * k, 0.2, 0.2);
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
    sim: { x: c.tee.x, y: c.tee.y, z: 0, mode: "aim", modeT: 0, cupScale: 1, boxes: c.boxes.map(() => false) } as Sim,
    cam: { x: c.w / 2, y: c.h / 2, s, ox: el.width / 2, oy: el.height / 2 },
    dpr: 1,
    t: 0.5,
    trail: [],
    fx: [],
    hits: new Map(),
    aim: null,
  });
  return el;
}
