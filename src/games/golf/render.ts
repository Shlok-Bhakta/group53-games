import { BALL_R, CUP_R, inPoly, rng, type Course, type Sim, type Vec } from "./engine";
import type { Light } from "./light";
import { bbox, centroid } from "./shapes";

// Flat, simple, top-down: solid shapes and a few colors, nothing pretending to be real. Three looks to
// pick from while we find the one: Flat (bright, white walls, hard little shadows), Ink (pastel with
// dark outlines, like a sticker) and Mono (dark and minimal). The time of day is just a tint.
//
// It's all simple shapes, so the course is drawn straight to the screen every frame (only what's in
// view): sharp at any zoom, however big the hole.

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
  rough: string;
  stripes: string | null; // mowing stripes on the fairway
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
  boost: string;
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
    rough: "#62b84c",
    stripes: "rgba(255,255,255,0.08)",
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
    boost: "#ff8a3d",
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
    rough: "#d3eeb2",
    stripes: "rgba(255,255,255,0.45)",
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
    boost: "#ffab76",
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
    rough: "#262c39",
    stripes: null,
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
    boost: "#f2b84b",
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
function chevron(ctx: Ctx, at: Vec, dir: Vec, size: number) {
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

// --- What's worth working out once per course ---

type Box = { x0: number; y0: number; x1: number; y1: number };
type Prepared = {
  greens: Vec[][];
  islands: Vec[][];
  trees: { at: Vec; r: number }[];
  lines: { pts: Vec[]; closed: boolean; w: number; hedge: boolean; bb: Box }[];
  arrows: Map<number, { at: Vec; dir: Vec }[]>; // per slope or mound zone
  zoneBoxes: Box[];
};
const prepared = new WeakMap<Course, Prepared>();
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const meets = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

function prepare(c: Course): Prepared {
  let p = prepared.get(c);
  if (p) return p;
  const greens = c.greens.map((g) => g.poly);
  const islands = greens.filter((g, i) => greens.some((o, j) => j !== i && inPoly(g[0], o)));
  const arrows = new Map<number, { at: Vec; dir: Vec }[]>();
  c.zones.forEach((z, i) => {
    if (z.kind === "slope") {
      const bb = bbox(z.poly);
      const list = [];
      for (let x = bb.x0 + 1.2; x < bb.x1; x += 2.8)
        for (let y = bb.y0 + 1.2; y < bb.y1; y += 2.8) {
          const at = { x: x + (Math.round(y / 2.8) % 2) * 1.4, y };
          if (inPoly(at, z.poly)) list.push({ at, dir: z.dir });
        }
      arrows.set(i, list);
    } else if (z.kind === "mound") {
      const list = [];
      for (const [ring, n] of [[0.45, 6], [0.8, 10]] as const)
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + ring;
          const at = { x: z.center.x + Math.cos(a) * z.radius * ring, y: z.center.y + Math.sin(a) * z.radius * ring };
          if (greens.some((g) => inPoly(at, g))) list.push({ at, dir: { x: Math.cos(a) * Math.sign(z.strength), y: Math.sin(a) * Math.sign(z.strength) } });
        }
      arrows.set(i, list);
    }
  });
  p = {
    greens,
    islands,
    trees: c.props.filter((q) => q.kind === "tree").map((q) => ({ at: q.at, r: q.r })),
    lines: [
      ...greens.map((pts) => ({ pts, closed: true, w: 0, hedge: false, bb: bbox(pts) })),
      ...c.walls.map((w) => ({ pts: w.pts, closed: !!w.closed, w: w.w, hedge: w.style === "hedge", bb: bbox(w.pts) })),
    ],
    arrows,
    zoneBoxes: c.zones.map((z) => bbox(z.poly)),
  };
  prepared.set(c, p);
  return p;
}

// --- The course ---

function drawCourse(ctx: Ctx, c: Course, style: Style, view: Box) {
  const L = LOOKS[style];
  const P = prepare(c);
  const inkW = 0.13;
  const outline = (w = inkW) => {
    if (!L.ink) return;
    ctx.strokeStyle = L.ink;
    ctx.lineWidth = w;
    ctx.stroke();
  };
  const near = (b: Box) => meets(grow(b, 3), view);

  // A few round trees around the outside.
  if (L.tree) {
    const trees = P.trees.filter((t, i) => i % L.treeEvery === 0 && t.at.x > view.x0 - 4 && t.at.x < view.x1 + 4 && t.at.y > view.y0 - 4 && t.at.y < view.y1 + 4);
    if (L.shadow) {
      ctx.fillStyle = L.shadow;
      for (const t of trees) {
        circ(ctx, t.at.x + SHADOW.x * 2.5, t.at.y + SHADOW.y * 2.5, t.r);
        ctx.fill();
      }
    }
    for (const t of trees) {
      circ(ctx, t.at.x, t.at.y, t.r);
      ctx.fillStyle = L.tree;
      ctx.fill();
      outline();
    }
  }

  loops(ctx, P.greens);
  ctx.fillStyle = L.course;
  ctx.fill("evenodd");
  if (L.stripes && !c.zones.some((z) => z.kind === "rough")) {
    ctx.save();
    loops(ctx, P.greens);
    ctx.clip("evenodd");
    ctx.fillStyle = L.stripes;
    for (let y = Math.floor(view.y0 / 6) * 6; y < view.y1; y += 6) ctx.fillRect(view.x0, y, view.x1 - view.x0, 3);
    ctx.restore();
  }
  for (const h of P.islands) {
    path(ctx, h);
    ctx.fillStyle = L.bed;
    ctx.fill();
  }

  c.zones.forEach((z, i) => {
    if (!near(P.zoneBoxes[i])) return;
    switch (z.kind) {
      case "rough":
        path(ctx, z.poly);
        ctx.fillStyle = L.rough;
        ctx.fill();
        break;
      case "green": {
        path(ctx, z.poly);
        ctx.fillStyle = L.course;
        ctx.fill();
        outline(0.06);
        if (L.stripes) {
          ctx.save();
          path(ctx, z.poly);
          ctx.clip();
          ctx.fillStyle = L.stripes;
          const bb = P.zoneBoxes[i];
          for (let y = Math.floor(bb.y0 / 6) * 6; y < bb.y1; y += 6) ctx.fillRect(bb.x0, y, bb.x1 - bb.x0, 3);
          ctx.restore();
        }
        break;
      }
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
          const q = { x: a.x + ((b.x - a.x) / len) * t, y: a.y + ((b.y - a.y) / len) * t };
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x + d.x - a.x, q.y + d.y - a.y);
          ctx.stroke();
        }
        break;
      }
      case "slope":
      case "mound":
        ctx.strokeStyle = L.arrow;
        ctx.lineWidth = 0.16;
        for (const ar of P.arrows.get(i) ?? []) chevron(ctx, ar.at, ar.dir, 0.7);
        break;
      case "ramp":
      case "boost": {
        path(ctx, z.poly);
        ctx.fillStyle = z.kind === "ramp" ? L.ramp : L.boost;
        ctx.fill();
        outline(0.08);
        ctx.strokeStyle = L.ink ?? "rgba(255,255,255,0.85)";
        ctx.lineWidth = 0.2;
        const m = centroid(z.poly);
        chevron(ctx, { x: m.x - z.dir.x * 0.45, y: m.y - z.dir.y * 0.45 }, z.dir, 0.9);
        chevron(ctx, { x: m.x + z.dir.x * 0.45, y: m.y + z.dir.y * 0.45 }, z.dir, 0.9);
        break;
      }
    }
  });

  // Tee mat.
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.roundRect(c.tee.x - 1.2, c.tee.y - 1.2, 2.4, 2.4, 0.4);
  ctx.fill();

  // Shadows, then walls, hedges and posts.
  const lines = P.lines.filter((l) => near(l.bb)).map((l) => ({ ...l, w: l.w || L.wallW, color: l.hedge ? L.hedge : L.wall }));
  if (style === "mono") for (const l of lines) if (l.w > L.wallW) l.w = 0.4;
  if (L.shadow) {
    ctx.strokeStyle = L.shadow;
    ctx.fillStyle = L.shadow;
    for (const l of lines) {
      ctx.lineWidth = l.w;
      path(ctx, l.pts.map((q) => ({ x: q.x + SHADOW.x, y: q.y + SHADOW.y })), l.closed);
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
}

// --- Frames ---

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx = { kind: "ring" | "splash" | "puff" | "spark" | "confetti"; x: number; y: number; t: number; color?: string; seed: number };

export type Frame = {
  c: Course;
  sim: Sim;
  style: Style;
  light: Light;
  cam: Camera;
  dpr: number;
  t: number;
  trail: Vec[];
  fx: Fx[];
  aim: { angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec } | null;
  map?: { x: number; y: number; w: number; h: number } | null; // the minimap, in screen points
  inset?: { top: number; bottom: number }; // how much of the screen the bars cover
};

export function drawFrame(ctx: Ctx, f: Frame) {
  const { c, sim, cam, dpr, t, light, style } = f;
  const L = LOOKS[style];
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const T = () => ctx.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, (cam.ox - cam.x * cam.s) * dpr, (cam.oy - cam.y * cam.s) * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = L.bg;
  ctx.fillRect(0, 0, W, H);
  T();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const vx0 = cam.x - cam.ox / cam.s, vy0 = cam.y - cam.oy / cam.s;
  drawCourse(ctx, c, style, { x0: vx0, y0: vy0, x1: vx0 + W / dpr / cam.s, y1: vy0 + H / dpr / cam.s });
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
    const s = 1.2 + Math.sin(t * 3 + i) * 0.06;
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

  // The ball: in the air it grows and its shadow drops away. Fast, it leaves a streak.
  const out = sim.mode === "out" ? Math.min(1, sim.modeT / 0.5) : 0;
  const sinking = sim.mode === "sunk" ? Math.min(1, sim.modeT / 0.25) : 0;
  if (f.trail.length > 1 && sim.mode === "roll") {
    for (let i = 1; i < f.trail.length; i++) {
      const k = i / f.trail.length;
      ctx.strokeStyle = style === "mono" ? `rgba(255,255,255,${0.18 * k})` : `rgba(255,255,255,${0.5 * k})`;
      ctx.lineWidth = BALL_R * 1.6 * k;
      ctx.beginPath();
      ctx.moveTo(f.trail[i - 1].x, f.trail[i - 1].y);
      ctx.lineTo(f.trail[i].x, f.trail[i].y);
      ctx.stroke();
    }
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

  // The flag: a pole and a pennant, gone once the ball's close.
  const nearCup = Math.hypot(sim.x - c.cup.x, sim.y - c.cup.y);
  const flagA = sim.mode === "sunk" ? 0 : Math.max(0, Math.min(1, (nearCup - 1.5) / 1.5));
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
    ctx.strokeStyle = style === "mono" ? L.wall : "#ffffff";
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
  ctx.font = `800 ${Math.max(8, cam.s * 0.8)}px system-ui, sans-serif`;
  ctx.fillStyle = L.ink ?? (style === "mono" ? "#1d222c" : "#ffffff");
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    ctx.fillText("?", (b.x - cam.x) * cam.s + cam.ox, (b.y - cam.y) * cam.s + cam.oy + 1);
  });

  // The time of day, as one tint: warm toward sunset, blue at night.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const warm = light.night < 0.5 ? Math.max(0, 1 - Math.abs(light.altitude) / 12) : 0;
  if (light.night > 0.02 || warm > 0.02) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = light.night > 0.02 ? `rgba(70,84,150,${light.night * (style === "mono" ? 0.25 : 0.4)})` : `rgba(255,190,130,${warm * 0.35})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  if (f.map) minimap(ctx, f, L);
  if (f.inset) holeArrow(ctx, f, L);

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

// When the cup is off screen, an arrow at the edge points to it, with how far it is.
function holeArrow(ctx: Ctx, f: Frame, L: Look) {
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
  const ang = Math.atan2(dy, dx);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  circ(ctx, x, y, 17);
  ctx.fillStyle = L.flag;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-4, -6.5);
  ctx.lineTo(-1.5, 0);
  ctx.lineTo(-4, 6.5);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  const d = Math.round(Math.hypot(c.cup.x - sim.x, c.cup.y - sim.y));
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ty = y + (y > sh / 2 ? -27 : 27);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.strokeText(`${d}m`, x, ty);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`${d}m`, x, ty);
}

// The whole hole small in a corner: where you are, where the cup is, what's in view.
function minimap(ctx: Ctx, f: Frame, L: Look) {
  const { c, sim, cam, dpr } = f;
  const m = f.map!;
  const P = prepare(c);
  const s = Math.min(m.w / c.w, m.h / c.h);
  const ox = m.x + (m.w - c.w * s) / 2, oy = m.y + (m.h - c.h * s) / 2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "rgba(17,19,24,0.55)";
  ctx.beginPath();
  ctx.roundRect(m.x - 6, m.y - 6, m.w + 12, m.h + 12, 12);
  ctx.fill();
  ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
  loops(ctx, P.greens);
  ctx.fillStyle = L.course;
  ctx.fill("evenodd");
  for (const z of c.zones)
    if (z.kind === "water") {
      path(ctx, z.poly);
      ctx.fillStyle = L.water;
      ctx.fill();
    }
  // What's on screen now.
  const vw = ctx.canvas.width / dpr / cam.s, vh = ctx.canvas.height / dpr / cam.s;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.2 / s;
  ctx.strokeRect(cam.x - cam.ox / cam.s, cam.y - cam.oy / cam.s, vw, vh);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const at = (p: Vec) => ({ x: ox + p.x * s, y: oy + p.y * s });
  const cup = at(c.cup), ball = at(sim);
  circ(ctx, cup.x, cup.y, 3);
  ctx.fillStyle = L.flag;
  ctx.fill();
  circ(ctx, ball.x, ball.y, 3.5);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
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
        ctx.fillStyle = e.kind === "confetti" ? ["#ff5a5a", "#ffd84a", "#4ae07a", "#4ab8ff", "#c07aff"][i % 5] : (e.color ?? L.box);
        ctx.fillRect(e.x + Math.cos(a) * sp * ease - 0.1, e.y + Math.sin(a) * sp * ease - 0.1, 0.2, 0.2);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// A whole hole in one picture, for lists.
export function still(c: Course, width: number, light: Light, style: Style = "flat"): HTMLCanvasElement {
  const s = width / c.w;
  const el = document.createElement("canvas");
  el.width = Math.round(width);
  el.height = Math.round(c.h * s);
  drawFrame(el.getContext("2d")!, {
    c,
    sim: { x: c.tee.x, y: c.tee.y, z: 0, mode: "aim", modeT: 0, cupScale: 1, boxes: c.boxes.map(() => false) } as Sim,
    style,
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
