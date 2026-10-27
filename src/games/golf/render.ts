import { BALL_R, CUP_R, inPoly, rng, type Course, type Sim, type Vec } from "./engine";
import type { Light } from "./light";
import { bbox, centroid } from "./shapes";

// Flat, simple, top-down: solid shapes and a few colors, nothing pretending to be real. Three looks to
// pick from while we find the one: Flat (bright, white walls, hard little shadows), Ink (pastel with
// dark outlines, like a sticker) and Mono (dark and minimal). The time of day is just a tint.
//
// Everything that doesn't move is drawn once into a world-sized layer; each frame draws the part of it
// on screen, then the cup, flag, boxes and ball on top.

type Ctx = CanvasRenderingContext2D;

export type Style = "flat" | "ink" | "mono";
export const STYLES: { id: Style; name: string }[] = [
  { id: "flat", name: "Flat" },
  { id: "ink", name: "Ink" },
  { id: "mono", name: "Mono" },
];

type Look = {
  bg: string;
  course: string;
  wall: string;
  wallW: number;
  shadow: string | null; // hard drop shadows, down and to the right
  ink: string | null; // outlines
  water: string;
  waterLine: string;
  sand: string;
  hedge: string;
  post: string;
  bridge: string;
  ramp: string;
  arrow: string;
  bed: string;
  tree: string | null;
  treeEvery: number; // draw one tree in this many
  ball: string;
  cup: string;
  flag: string;
  box: string;
  ui: string; // the aim line
};

const LOOKS: Record<Style, Look> = {
  flat: {
    bg: "#4c9f50",
    course: "#7fd65a",
    wall: "#ffffff",
    wallW: 0.5,
    shadow: "rgba(16,64,24,0.3)",
    ink: null,
    water: "#3fb4e8",
    waterLine: "#8ddaf7",
    sand: "#f7d68c",
    hedge: "#2f8a43",
    post: "#ff6f59",
    bridge: "#d39a5a",
    ramp: "#ffcd4d",
    arrow: "rgba(255,255,255,0.55)",
    bed: "#3f9147",
    tree: "#3b9046",
    treeEvery: 3,
    ball: "#ffffff",
    cup: "#1c3a21",
    flag: "#ff4b4b",
    box: "#ffcd4d",
    ui: "#ffffff",
  },
  ink: {
    bg: "#bfe6a6",
    course: "#eaf8cc",
    wall: "#ffffff",
    wallW: 0.5,
    shadow: null,
    ink: "#26333a",
    water: "#8fd4f2",
    waterLine: "#ffffff",
    sand: "#ffe3a3",
    hedge: "#86cc78",
    post: "#ff9580",
    bridge: "#f1c28d",
    ramp: "#ffd47a",
    arrow: "rgba(38,51,58,0.35)",
    bed: "#a6d98c",
    tree: "#93d47f",
    treeEvery: 4,
    ball: "#ffffff",
    cup: "#26333a",
    flag: "#ff6b6b",
    box: "#ffd47a",
    ui: "#26333a",
  },
  mono: {
    bg: "#1d222c",
    course: "#2e3544",
    wall: "#e8e2d4",
    wallW: 0.24,
    shadow: null,
    ink: null,
    water: "#35557a",
    waterLine: "#4d7099",
    sand: "#4f4636",
    hedge: "#e8e2d4",
    post: "#e8e2d4",
    bridge: "#3b4354",
    ramp: "#f2b84b",
    arrow: "rgba(232,226,212,0.3)",
    bed: "#1d222c",
    tree: null,
    treeEvery: 1,
    ball: "#ffffff",
    cup: "#0d1016",
    flag: "#f2b84b",
    box: "#f2b84b",
    ui: "#f2b84b",
  },
};
export const lookOf = (s: Style) => LOOKS[s];

const SHADOW = { x: 0.16, y: 0.26 };

// --- Paths ---

function path(ctx: Ctx, pts: Vec[], closed = true) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
}
function loops(ctx: Ctx, polys: Vec[][], dx = 0, dy = 0) {
  ctx.beginPath();
  for (const pts of polys) {
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)));
    ctx.closePath();
  }
}
function circ(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.001, r), 0, Math.PI * 2);
}
function arrow(ctx: Ctx, at: Vec, dir: Vec, size: number) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(Math.atan2(dir.y, dir.x));
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, -size * 0.6);
  ctx.lineTo(size * 0.3, 0);
  ctx.lineTo(-size * 0.5, size * 0.6);
  ctx.stroke();
  ctx.restore();
}

// --- The course, drawn once ---

export const MARGIN = 10;
export type Layers = { ppu: number; style: Style; ground: HTMLCanvasElement };

function islandLoops(c: Course) {
  return c.greens.filter((g, i) => c.greens.some((o, j) => j !== i && inPoly(g.poly[0], o.poly))).map((g) => g.poly);
}

export function buildLayers(c: Course, ppu: number, style: Style = "flat"): Layers {
  const L = LOOKS[style];
  const el = document.createElement("canvas");
  el.width = Math.ceil((c.w + MARGIN * 2) * ppu);
  el.height = Math.ceil((c.h + MARGIN * 2) * ppu);
  const ctx = el.getContext("2d")!;
  ctx.setTransform(ppu, 0, 0, ppu, MARGIN * ppu, MARGIN * ppu);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const inkW = 0.13;
  const outline = (w = inkW) => {
    if (!L.ink) return;
    ctx.strokeStyle = L.ink;
    ctx.lineWidth = w;
    ctx.stroke();
  };

  ctx.fillStyle = L.bg;
  ctx.fillRect(-MARGIN, -MARGIN, c.w + MARGIN * 2, c.h + MARGIN * 2);

  // A few round trees around the outside.
  if (L.tree) {
    const trees = c.props.filter((p, i) => p.kind === "tree" && i % L.treeEvery === 0);
    if (L.shadow) {
      ctx.fillStyle = L.shadow;
      for (const p of trees) {
        circ(ctx, p.at.x + SHADOW.x * 2.5, p.at.y + SHADOW.y * 2.5, p.r);
        ctx.fill();
      }
    }
    for (const p of trees) {
      circ(ctx, p.at.x, p.at.y, p.r);
      ctx.fillStyle = L.tree;
      ctx.fill();
      outline();
    }
  }

  const greens = c.greens.map((g) => g.poly);
  // The course, and its walls' shadows falling on it.
  loops(ctx, greens);
  ctx.fillStyle = L.course;
  ctx.fill("evenodd");
  for (const h of islandLoops(c)) {
    path(ctx, h);
    ctx.fillStyle = L.bed;
    ctx.fill();
  }

  for (const z of c.zones) {
    switch (z.kind) {
      case "sand":
        path(ctx, z.poly);
        ctx.fillStyle = L.sand;
        ctx.fill();
        outline(0.08);
        break;
      case "water":
        path(ctx, z.poly);
        ctx.fillStyle = L.water;
        ctx.fill();
        ctx.save();
        ctx.clip();
        path(ctx, z.poly);
        ctx.strokeStyle = L.waterLine;
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();
        path(ctx, z.poly);
        outline(0.08);
        break;
      case "bridge": {
        path(ctx, z.poly);
        ctx.fillStyle = L.bridge;
        ctx.fill();
        outline(0.08);
        const [a, b, , d] = z.poly;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 0.06;
        for (let t = 0.5; t < len; t += 0.5) {
          const p = { x: a.x + ((b.x - a.x) / len) * t, y: a.y + ((b.y - a.y) / len) * t };
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + d.x - a.x, p.y + d.y - a.y);
          ctx.stroke();
        }
        break;
      }
      case "slope": {
        // Just arrows, pointing downhill.
        const bb = bbox(z.poly);
        ctx.save();
        path(ctx, z.poly);
        ctx.clip();
        ctx.strokeStyle = L.arrow;
        ctx.lineWidth = 0.16;
        for (let x = bb.x0 + 1.2; x < bb.x1; x += 2.6)
          for (let y = bb.y0 + 1.2; y < bb.y1; y += 2.6) arrow(ctx, { x: x + (Math.round(y / 2.6) % 2) * 1.3, y }, z.dir, 0.7);
        ctx.restore();
        break;
      }
      case "mound": {
        // Rings: arrows pointing out from a hill, in toward a bowl.
        ctx.save();
        loops(ctx, greens);
        ctx.clip("evenodd");
        ctx.strokeStyle = L.arrow;
        ctx.lineWidth = 0.12;
        circ(ctx, z.center.x, z.center.y, z.radius * 0.85);
        ctx.setLineDash([0.35, 0.45]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 0.16;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.3;
          const dir = { x: Math.cos(a) * Math.sign(z.strength), y: Math.sin(a) * Math.sign(z.strength) };
          arrow(ctx, { x: z.center.x + Math.cos(a) * z.radius * 0.55, y: z.center.y + Math.sin(a) * z.radius * 0.55 }, dir, 0.6);
        }
        ctx.restore();
        break;
      }
      case "ramp": {
        path(ctx, z.poly);
        ctx.fillStyle = L.ramp;
        ctx.fill();
        outline(0.08);
        ctx.strokeStyle = L.ink ?? "rgba(0,0,0,0.35)";
        ctx.lineWidth = 0.2;
        const m = centroid(z.poly);
        arrow(ctx, { x: m.x - z.dir.x * 0.4, y: m.y - z.dir.y * 0.4 }, z.dir, 0.9);
        arrow(ctx, { x: m.x + z.dir.x * 0.4, y: m.y + z.dir.y * 0.4 }, z.dir, 0.9);
        break;
      }
    }
  }

  // Tee mat.
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.roundRect(c.tee.x - 1.2, c.tee.y - 1.2, 2.4, 2.4, 0.4);
  ctx.fill();

  // Shadows, then walls, hedges and posts.
  const lines: { pts: Vec[]; closed: boolean; w: number; color: string }[] = [
    ...greens.map((pts) => ({ pts, closed: true, w: L.wallW, color: L.wall })),
    ...c.walls.map((w) => ({ pts: w.pts, closed: !!w.closed, w: style === "mono" ? 0.4 : w.w, color: w.style === "hedge" ? L.hedge : L.wall })),
  ];
  if (L.shadow) {
    ctx.strokeStyle = L.shadow;
    ctx.fillStyle = L.shadow;
    for (const l of lines) {
      ctx.lineWidth = l.w;
      path(ctx, l.pts.map((p) => ({ x: p.x + SHADOW.x, y: p.y + SHADOW.y })), l.closed);
      ctx.stroke();
    }
    for (const b of c.bumpers) {
      circ(ctx, b.at.x + SHADOW.x * 1.5, b.at.y + SHADOW.y * 1.5, b.r);
      ctx.fill();
    }
  }
  if (L.ink)
    for (const l of lines) {
      ctx.strokeStyle = L.ink;
      ctx.lineWidth = l.w + inkW * 2;
      path(ctx, l.pts, l.closed);
      ctx.stroke();
    }
  for (const l of lines) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.w;
    path(ctx, l.pts, l.closed);
    ctx.stroke();
  }
  for (const b of c.bumpers) {
    circ(ctx, b.at.x, b.at.y, b.r);
    ctx.fillStyle = L.post;
    ctx.fill();
    outline();
    if (style === "flat") {
      circ(ctx, b.at.x, b.at.y, b.r * 0.45);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
    }
  }
  return { ppu, style, ground: el };
}

// --- Frames ---

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx = { kind: "ring" | "splash" | "puff" | "spark" | "confetti"; x: number; y: number; t: number; color?: string; seed: number };

export type Frame = {
  c: Course;
  sim: Sim;
  layers: Layers;
  light: Light;
  cam: Camera;
  dpr: number;
  t: number;
  trail: Vec[];
  fx: Fx[];
  aim: { angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec } | null;
};

export function drawFrame(ctx: Ctx, f: Frame) {
  const { c, sim, layers, light, cam, dpr, t } = f;
  const L = LOOKS[layers.style];
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const T = () => ctx.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, (cam.ox - cam.x * cam.s) * dpr, (cam.oy - cam.y * cam.s) * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = L.bg;
  ctx.fillRect(0, 0, W, H);
  T();
  // Only the part of the course layer that's on screen.
  const vx0 = cam.x - cam.ox / cam.s, vy0 = cam.y - cam.oy / cam.s;
  const vx1 = vx0 + W / dpr / cam.s, vy1 = vy0 + H / dpr / cam.s;
  const k = layers.ground.width / (c.w + MARGIN * 2);
  const x0 = Math.max(-MARGIN, vx0 - 1), y0 = Math.max(-MARGIN, vy0 - 1);
  const x1 = Math.min(c.w + MARGIN, vx1 + 1), y1 = Math.min(c.h + MARGIN, vy1 + 1);
  if (x1 > x0 && y1 > y0) ctx.drawImage(layers.ground, (x0 + MARGIN) * k, (y0 + MARGIN) * k, (x1 - x0) * k, (y1 - y0) * k, x0, y0, x1 - x0, y1 - y0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const ink = (w = 0.1) => {
    if (!L.ink) return;
    ctx.strokeStyle = L.ink;
    ctx.lineWidth = w;
    ctx.stroke();
  };

  // The cup.
  const cupR = CUP_R * sim.cupScale;
  circ(ctx, c.cup.x, c.cup.y, cupR);
  ctx.fillStyle = L.cup;
  ctx.fill();

  drawFx(ctx, f.fx, t, L);

  // Mystery boxes: a square that bobs.
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const s = 0.8 + Math.sin(t * 3 + i) * 0.05;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.sin(t * 1.2 + i) * 0.15);
    if (L.shadow) {
      ctx.fillStyle = L.shadow;
      ctx.beginPath();
      ctx.roundRect(-s / 2 + SHADOW.x * 1.5, -s / 2 + SHADOW.y * 1.5, s, s, 0.15);
      ctx.fill();
    }
    ctx.fillStyle = L.box;
    ctx.beginPath();
    ctx.roundRect(-s / 2, -s / 2, s, s, 0.15);
    ctx.fill();
    ink();
    ctx.restore();
  });

  // The ball: in the air it grows and its shadow drops away.
  const out = sim.mode === "out" ? Math.min(1, sim.modeT / 0.5) : 0;
  const sinking = sim.mode === "sunk" ? Math.min(1, sim.modeT / 0.25) : 0;
  if (f.trail.length > 1 && sim.mode === "roll") {
    ctx.strokeStyle = layers.style === "mono" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = BALL_R * 1.1;
    path(ctx, f.trail, false);
    ctx.stroke();
  }
  if (sinking < 1 && out < 1) {
    const bx = sinking ? sim.x + (c.cup.x - sim.x) * sinking : sim.x;
    const by = sinking ? sim.y + (c.cup.y - sim.y) * sinking : sim.y;
    const R = BALL_R * (1 + sim.z * 0.18) * (1 - sinking * 0.5) * (1 - out);
    const lift = sim.z * 0.5;
    if (L.shadow || sim.z > 0) {
      circ(ctx, bx + SHADOW.x * (1 + sim.z * 2), by + SHADOW.y * (1 + sim.z * 2), BALL_R * (1 - out));
      ctx.fillStyle = L.shadow ?? "rgba(0,0,0,0.3)";
      ctx.fill();
    }
    circ(ctx, bx, by - lift, R);
    ctx.fillStyle = L.ball;
    ctx.fill();
    ink(0.08);
  }

  // The flag, flat on top: a pole and a pennant, gone once the ball's close.
  const near = Math.hypot(sim.x - c.cup.x, sim.y - c.cup.y);
  const flagA = sim.mode === "sunk" ? 0 : Math.max(0, Math.min(1, (near - 1.5) / 1.5));
  if (flagA > 0) {
    ctx.globalAlpha = flagA;
    const top = { x: c.cup.x, y: c.cup.y - 1.8 };
    if (L.ink) {
      ctx.strokeStyle = L.ink;
      ctx.lineWidth = 0.26;
      ctx.beginPath();
      ctx.moveTo(c.cup.x, c.cup.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }
    ctx.strokeStyle = layers.style === "mono" ? L.wall : "#ffffff";
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(c.cup.x, c.cup.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const wave = Math.sin(t * 4) * 0.08;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + 1.1, top.y + 0.32 + wave);
    ctx.lineTo(top.x, top.y + 0.7);
    ctx.closePath();
    ctx.fillStyle = L.flag;
    ctx.fill();
    ink(0.08);
    ctx.globalAlpha = 1;
  }

  // Question marks on the boxes, crisp in screen space.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.max(7, cam.s * 0.55)}px system-ui, sans-serif`;
  ctx.fillStyle = L.ink ?? (layers.style === "mono" ? "#1d222c" : "#ffffff");
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    ctx.fillText("?", (b.x - cam.x) * cam.s + cam.ox, (b.y - cam.y) * cam.s + cam.oy + 1);
  });

  // The time of day, as one tint: warm toward sunset, blue at night.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const warm = light.night < 0.5 ? Math.max(0, 1 - Math.abs(light.altitude) / 12) : 0;
  if (light.night > 0.02 || warm > 0.02) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = light.night > 0.02 ? `rgba(70,84,150,${light.night * (layers.style === "mono" ? 0.25 : 0.4)})` : `rgba(255,190,130,${warm * 0.35})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  // The aim: where the finger went down, and a dotted line out to the first bounce.
  if (f.aim && sim.mode === "aim") {
    const { power, line } = f.aim;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    ctx.strokeStyle = L.ui;
    ctx.lineWidth = 0.18;
    ctx.setLineDash([0.02, 0.42]);
    path(ctx, line, false);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.arc(sim.x, sim.y, BALL_R + 0.35, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();
  }
}

function drawFx(ctx: Ctx, fx: Fx[], t: number, L: Look) {
  for (const e of fx) {
    const age = t - e.t;
    const r = rng(e.seed);
    if (e.kind === "ring" || e.kind === "splash") {
      const life = e.kind === "splash" ? 0.9 : 0.5;
      if (age > life) continue;
      const k = age / life;
      ctx.strokeStyle = e.kind === "splash" ? L.waterLine : L.ui;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 0.12;
      circ(ctx, e.x, e.y, 0.3 + k * 1.6);
      ctx.stroke();
    } else if (e.kind === "puff") {
      if (age > 0.5) continue;
      const k = age / 0.5;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = L.sand;
      for (let i = 0; i < 6; i++) {
        const a = r() * Math.PI * 2;
        circ(ctx, e.x + Math.cos(a) * k, e.y + Math.sin(a) * k, 0.18);
        ctx.fill();
      }
    } else {
      const life = e.kind === "confetti" ? 1.6 : 0.6;
      if (age > life) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - k;
      const n = e.kind === "confetti" ? 30 : 12;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, sp = 1.5 + r() * 2.5;
        const ease = 1 - (1 - k) ** 3;
        ctx.fillStyle = e.kind === "confetti" ? ["#ff5a5a", "#ffd84a", "#4ae07a", "#4ab8ff", "#c07aff"][i % 5] : L.box;
        ctx.fillRect(e.x + Math.cos(a) * sp * ease - 0.1, e.y + Math.sin(a) * sp * ease - 0.1, 0.2, 0.2);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// A whole hole in one picture, for lists.
export function still(c: Course, width: number, light: Light, style: Style = "flat"): HTMLCanvasElement {
  const s = width / c.w;
  const layers = buildLayers(c, Math.max(3, s * 1.5), style);
  const el = document.createElement("canvas");
  el.width = Math.round(width);
  el.height = Math.round(c.h * s);
  drawFrame(el.getContext("2d")!, {
    c,
    sim: { x: c.tee.x, y: c.tee.y, z: 0, mode: "aim", modeT: 0, cupScale: 1, boxes: c.boxes.map(() => false) } as Sim,
    layers,
    light,
    cam: { x: c.w / 2, y: c.h / 2, s, ox: el.width / 2, oy: el.height / 2 },
    dpr: 1,
    t: 0.5,
    trail: [],
    fx: [],
    aim: null,
  });
  return el;
}

