import { BALL_R, CUP_R, edges, inPoly, rng, type Course, type Prop, type Sim, type Theme, type Vec, type Wall } from "./engine";
import { mixRGB, type Light, type RGB } from "./light";
import { bbox, centroid } from "./shapes";

// A toy diorama seen from above and a little to the south: the ground is flat, and anything with
// height (walls, hedges, trees, lamps, the flag) stands up the screen by K per unit, so you see its
// front and its top. Shadows are soft and faded, laid on the ground by the sun from the phone's clock.
//
// Layers, drawn once per hole:
//   ground  carpet, meadow, water, sand, slopes: flat colors, no lighting
//   light   sunlight and soft shadows on the ground (and lamp light at night), multiplied over it
//   tall    everything standing up, sorted back to front, lit by the sun as it's drawn
//   glow    lamp bulbs and halos, added on top after dark
// Each frame stacks them through the camera, with the ball, flag and boxes in between, then clouds,
// fireflies or pollen, and a vignette.

type Ctx = CanvasRenderingContext2D;
export const K = 0.55; // screen units up per unit of height

// --- Colors ---

const hexRGB = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
// A surface's color under a light.
const lit = (hex: string, light: RGB, a = 1) => {
  const c = hexRGB(hex);
  return css([(c[0] * light[0]) / 255, (c[1] * light[1]) / 255, (c[2] * light[2]) / 255], a);
};

type Pal = {
  beyond: string;
  meadow: string;
  meadowPatches: string[];
  carpet: string;
  putting: string;
  bed: string;
  rim: [top: string, side: string];
  hedge: [top: string, side: string, leaf: string];
  rail: [top: string, side: string];
  post: [top: string, side: string, band: string];
  water: [deep: string, shallow: string, foam: string];
  sand: [base: string, edge: string];
  bridge: [base: string, line: string];
  ramp: string;
  trunk: string;
  canopy: string[];
  bush: string[];
  rock: [top: string, side: string];
  flowers: string[];
  flag: string;
  lamp: RGB;
};

const PAL: Partial<Record<Theme, Pal>> = {
  hills: {
    beyond: "#5b9748",
    meadow: "#62a04d",
    meadowPatches: ["#6dab56", "#74b05a", "#7aa94f"],
    carpet: "#97d272",
    putting: "#ace184",
    bed: "#8d7656",
    rim: ["#f6ead0", "#c99f70"],
    hedge: ["#5aa64e", "#3e8139", "#72bd60"],
    rail: ["#f6ead0", "#b98d5f"],
    post: ["#fbf3e2", "#d9644f", "#f6ead0"],
    water: ["#4ba5be", "#7fd0dc", "#eefafa"],
    sand: ["#f3e0ae", "#dcc38d"],
    bridge: ["#cfa16d", "#a87a4b"],
    ramp: "#dcb27c",
    trunk: "#80603f",
    canopy: ["#3b8745", "#4b9b4f", "#5fb05a", "#7bc76a"],
    bush: ["#3e8b45", "#56a851", "#6fbd60"],
    rock: ["#cfc9bb", "#a49c8d"],
    flowers: ["#ffffff", "#ffd95a", "#ff8fb1", "#c3a3ff", "#ff9a5c"],
    flag: "#ff5a4e",
    lamp: [255, 200, 130],
  },
};
export const paletteOf = (t: Theme): Pal => PAL[t] ?? PAL.hills!;

// --- Paths ---

function path(ctx: Ctx, pts: Vec[], closed = true) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
}
function loops(ctx: Ctx, polys: Vec[][]) {
  ctx.beginPath();
  for (const pts of polys) {
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
}
function circ(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.001, r), 0, Math.PI * 2);
}
const shift = (pts: Vec[], dx: number, dy: number) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));

// --- Layers ---

export const MARGIN = 10;
export type Layers = {
  ppu: number;
  ground: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  tall?: HTMLCanvasElement;
  light?: HTMLCanvasElement;
  key?: string;
};

function canvas(c: Course, ppu: number) {
  const el = document.createElement("canvas");
  el.width = Math.ceil((c.w + MARGIN * 2) * ppu);
  el.height = Math.ceil((c.h + MARGIN * 2) * ppu);
  const ctx = el.getContext("2d")!;
  ctx.setTransform(ppu, 0, 0, ppu, MARGIN * ppu, MARGIN * ppu);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { el, ctx };
}
const hasFilter = typeof document !== "undefined" && "filter" in (document.createElement("canvas").getContext("2d") ?? {});

export function buildLayers(c: Course, ppu: number): Layers {
  return { ppu, ground: buildGround(c, ppu), glow: buildGlow(c, ppu) };
}

// Holes in the green (islands) are the loops inside another loop.
function islandLoops(c: Course) {
  return c.greens.filter((g, i) => c.greens.some((o, j) => j !== i && inPoly(g.poly[0], o.poly))).map((g) => g.poly);
}

function buildGround(c: Course, ppu: number) {
  const pal = paletteOf(c.theme);
  const { el, ctx } = canvas(c, ppu);
  const r = rng(Math.round(c.w * 100 + c.h));
  const X = -MARGIN, Y = -MARGIN, W = c.w + MARGIN * 2, H = c.h + MARGIN * 2;

  // Meadow, in big soft patches.
  ctx.fillStyle = pal.meadow;
  ctx.fillRect(X, Y, W, H);
  for (let i = 0; i < (W * H) / 40; i++) {
    const x = X + r() * W, y = Y + r() * H, rad = 3 + r() * 7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const col = hexRGB(pal.meadowPatches[Math.floor(r() * pal.meadowPatches.length)]);
    g.addColorStop(0, css(col, 0.7));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  const greens = c.greens.map((g) => g.poly);
  const holes = islandLoops(c);
  // The carpet, with broad, gentle stripes.
  ctx.save();
  loops(ctx, greens);
  ctx.fillStyle = pal.carpet;
  ctx.fill("evenodd");
  ctx.clip("evenodd");
  for (let y = Y; y < Y + H; y += 5) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(X, y, W, 2.5);
  }
  // The putting green, lighter round the cup.
  const pg = ctx.createRadialGradient(c.cup.x, c.cup.y, 0, c.cup.x, c.cup.y, 6);
  const pc = hexRGB(pal.putting);
  pg.addColorStop(0, css(pc, 1));
  pg.addColorStop(0.8, css(pc, 1));
  pg.addColorStop(1, css(pc, 0));
  ctx.fillStyle = pg;
  circ(ctx, c.cup.x, c.cup.y, 6);
  ctx.fill();
  // The tee mat.
  ctx.fillStyle = "rgba(40,90,40,0.18)";
  ctx.beginPath();
  ctx.roundRect(c.tee.x - 1.5, c.tee.y - 1.5, 3, 3, 0.5);
  ctx.fill();
  ctx.restore();

  // Garden beds on the islands.
  for (const h of holes) {
    ctx.save();
    path(ctx, h);
    ctx.fillStyle = pal.bed;
    ctx.fill();
    ctx.clip();
    const bb = bbox(h);
    for (let i = 0; i < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 1.5; i++) {
      ctx.fillStyle = r() < 0.6 ? "rgba(0,0,0,0.08)" : pal.flowers[Math.floor(r() * pal.flowers.length)];
      circ(ctx, bb.x0 + r() * (bb.x1 - bb.x0), bb.y0 + r() * (bb.y1 - bb.y0), 0.08 + r() * 0.08);
      ctx.fill();
    }
    ctx.restore();
  }

  for (const z of c.zones) {
    const bb = bbox(z.poly);
    switch (z.kind) {
      case "sand":
        path(ctx, z.poly);
        ctx.fillStyle = pal.sand[0];
        ctx.fill();
        innerEdge(ctx, z.poly, pal.sand[1], [[0.9, 0.35], [0.35, 0.6]]);
        break;
      case "water": {
        path(ctx, z.poly);
        ctx.fillStyle = pal.water[0];
        ctx.fill();
        innerEdge(ctx, z.poly, pal.water[1], [[2.2, 0.3], [1.1, 0.45], [0.45, 0.7]]);
        path(ctx, z.poly);
        ctx.strokeStyle = pal.water[2];
        ctx.lineWidth = 0.14;
        ctx.stroke();
        break;
      }
      case "bridge": {
        ctx.save();
        path(ctx, z.poly);
        ctx.fillStyle = pal.bridge[0];
        ctx.fill();
        ctx.clip();
        const [a, b, , d] = z.poly;
        const along = { x: b.x - a.x, y: b.y - a.y };
        const L = Math.hypot(along.x, along.y);
        ctx.strokeStyle = pal.bridge[1];
        ctx.lineWidth = 0.05;
        for (let t = 0.45; t < L; t += 0.45) {
          const p = { x: a.x + (along.x / L) * t, y: a.y + (along.y / L) * t };
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + d.x - a.x, p.y + d.y - a.y);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case "slope": {
        ctx.save();
        path(ctx, z.poly);
        ctx.clip();
        const m = centroid(z.poly);
        const half = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
        const g = ctx.createLinearGradient(m.x - z.dir.x * half, m.y - z.dir.y * half, m.x + z.dir.x * half, m.y + z.dir.y * half);
        g.addColorStop(0, "rgba(255,255,255,0.12)");
        g.addColorStop(1, "rgba(20,60,20,0.12)");
        ctx.fillStyle = g;
        ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
        chevrons(ctx, bb, z.dir, 2.2, "rgba(255,255,255,0.32)");
        ctx.restore();
        break;
      }
      case "mound": {
        const g = ctx.createRadialGradient(z.center.x, z.center.y, 0, z.center.x, z.center.y, z.radius);
        if (z.strength > 0) {
          g.addColorStop(0, "rgba(255,255,255,0.16)");
          g.addColorStop(0.55, "rgba(255,255,255,0.05)");
          g.addColorStop(1, "rgba(20,60,20,0)");
        } else {
          g.addColorStop(0, "rgba(20,60,20,0.14)");
          g.addColorStop(1, "rgba(20,60,20,0)");
        }
        ctx.save();
        loops(ctx, greens);
        ctx.clip("evenodd");
        ctx.fillStyle = g;
        circ(ctx, z.center.x, z.center.y, z.radius);
        ctx.fill();
        ctx.strokeStyle = z.strength > 0 ? "rgba(255,255,255,0.16)" : "rgba(20,60,20,0.12)";
        ctx.lineWidth = 0.07;
        ctx.setLineDash([0.4, 0.4]);
        for (const k of [0.45, 0.8]) {
          circ(ctx, z.center.x, z.center.y, z.radius * k);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
        break;
      }
      case "ramp": {
        const m = centroid(z.poly);
        const half = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
        ctx.save();
        path(ctx, z.poly);
        ctx.fillStyle = pal.ramp;
        ctx.fill();
        ctx.clip();
        const g = ctx.createLinearGradient(m.x - z.dir.x * half, m.y - z.dir.y * half, m.x + z.dir.x * half, m.y + z.dir.y * half);
        g.addColorStop(0, "rgba(0,0,0,0.18)");
        g.addColorStop(1, "rgba(255,255,255,0.3)");
        ctx.fillStyle = g;
        ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
        ctx.restore();
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(Math.atan2(z.dir.y, z.dir.x));
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.moveTo(0.8, 0);
        ctx.lineTo(-0.1, -0.65);
        ctx.lineTo(-0.1, -0.25);
        ctx.lineTo(-0.85, -0.25);
        ctx.lineTo(-0.85, 0.25);
        ctx.lineTo(-0.1, 0.25);
        ctx.lineTo(-0.1, 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
    }
  }

  // Soft contact shade along the inside of every wall.
  ctx.save();
  loops(ctx, greens);
  ctx.clip("evenodd");
  ctx.shadowColor = "rgba(30,70,30,0.45)";
  ctx.shadowBlur = ppu * 0.6;
  ctx.strokeStyle = "rgba(30,70,30,0.35)";
  ctx.lineWidth = 0.5;
  for (const g of greens) {
    path(ctx, g);
    ctx.stroke();
  }
  ctx.restore();

  // Flowers in the meadow.
  for (const p of c.props) {
    if (p.kind !== "flowers") continue;
    const fr = rng(p.seed ?? 1);
    for (let i = 0; i < 9; i++) {
      const a = fr() * Math.PI * 2, d = fr() * p.r;
      circ(ctx, p.at.x + Math.cos(a) * d, p.at.y + Math.sin(a) * d, 0.1);
      ctx.fillStyle = pal.flowers[Math.floor(fr() * pal.flowers.length)];
      ctx.fill();
    }
  }
  return el;
}

function innerEdge(ctx: Ctx, poly: Vec[], color: string, widths: [number, number][]) {
  ctx.save();
  path(ctx, poly);
  ctx.clip();
  ctx.strokeStyle = color;
  for (const [w, a] of widths) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    path(ctx, poly);
    ctx.stroke();
  }
  ctx.restore();
}

function chevrons(ctx: Ctx, bb: ReturnType<typeof bbox>, dir: Vec, spacing: number, color: string) {
  const ang = Math.atan2(dir.y, dir.x);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.12;
  for (let x = bb.x0 + spacing / 2; x < bb.x1; x += spacing)
    for (let y = bb.y0 + spacing / 2; y < bb.y1; y += spacing) {
      ctx.save();
      ctx.translate(x + (Math.round(y / spacing) % 2) * spacing * 0.5, y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(-0.2, -0.35);
      ctx.lineTo(0.2, 0);
      ctx.lineTo(-0.2, 0.35);
      ctx.stroke();
      ctx.restore();
    }
}

// --- Things that stand up ---

type Tall = { y: number; draw: (ctx: Ctx) => void };

// A wall seen from above and the south: its front face, then its top.
function extrude(ctx: Ctx, a: Vec, b: Vec, w: number, h: number, top: string, side: string, ppu: number, cap: CanvasLineCap = "round") {
  const up = h * K;
  ctx.lineCap = cap;
  ctx.lineWidth = w;
  ctx.strokeStyle = side;
  const stepPx = 1.2 / ppu;
  for (let d = 0; d < up; d += stepPx) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - d);
    ctx.lineTo(b.x, b.y - d);
    ctx.stroke();
  }
  ctx.strokeStyle = top;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - up);
  ctx.lineTo(b.x, b.y - up);
  ctx.stroke();
  ctx.lineCap = "round";
}

function faces(l: Light) {
  // Fronts face south: they're lit when the sun is in the south, in shade when it's behind.
  const front = Math.max(0, Math.min(1, -l.shadow.y * 0.8 + 0.2));
  return { top: l.lit, side: mixRGB(l.shade, l.lit, 0.25 + 0.55 * front) };
}

export function buildTall(c: Course, ppu: number, l: Light) {
  const pal = paletteOf(c.theme);
  const { el, ctx } = canvas(c, ppu);
  const f = faces(l);
  const items: Tall[] = [];
  const wallSegs = (pts: Vec[], closed: boolean, w: number, h: number, top: string, side: string, extra?: (ctx: Ctx, a: Vec, b: Vec) => void, cap: CanvasLineCap = "round") => {
    for (const [a, b] of edges(pts, closed))
      items.push({
        y: Math.max(a.y, b.y),
        draw: (g) => {
          extrude(g, a, b, w, h, lit(top, f.top), lit(side, f.side), ppu, cap);
          extra?.(g, a, b);
        },
      });
  };
  for (const g of c.greens) if (g.rim !== false) wallSegs(g.poly, true, 0.42, 0.62, pal.rim[0], pal.rim[1]);
  for (const w of c.walls) {
    if (w.style === "hedge") {
      const leaf = rng(Math.round(w.pts[0].x * 97));
      wallSegs(w.pts, !!w.closed, w.w, w.h, pal.hedge[0], pal.hedge[1], (g, a, b) => {
        // A trimmed box hedge: leafy texture on the top and down the front.
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
        for (let t = 0.1; t < L - 0.1; t += 0.22) {
          const k = t / L;
          const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
          const across = (leaf() - 0.5) * w.w * 0.8;
          g.fillStyle = lit(leaf() < 0.5 ? pal.hedge[2] : pal.hedge[0], f.top);
          circ(g, x + nx * across, y + ny * across - w.h * K, w.w * (0.1 + leaf() * 0.1));
          g.fill();
          g.fillStyle = lit(pal.hedge[2], f.side, 0.5);
          circ(g, x + nx * w.w * 0.45 * Math.sign(ny || 1), y + Math.abs(ny) * w.w * 0.45 - leaf() * w.h * K, w.w * 0.09);
          g.fill();
        }
      }, "butt");
    } else wallSegs(w.pts, !!w.closed, w.w, w.h, pal.rail[0], pal.rail[1]);
  }
  for (const b of c.bumpers) items.push({ y: b.at.y + b.r, draw: (g) => post(g, b.at, b.r, 0.8, pal, f) });
  for (const p of c.props) if (p.kind !== "flowers") items.push({ y: p.at.y + p.r * 0.3, draw: (g) => prop(g, p, pal, l) });
  for (const at of c.lamps) items.push({ y: at.y, draw: (g) => lampPost(g, at, f) });
  // Tee markers.
  for (const dx of [-1.2, 1.2]) items.push({ y: c.tee.y, draw: (g) => post(g, { x: c.tee.x + dx, y: c.tee.y }, 0.18, 0.3, pal, f) });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw(ctx);
  return el;
}

function post(ctx: Ctx, at: Vec, r: number, h: number, pal: Pal, f: ReturnType<typeof faces>) {
  const up = h * K;
  ctx.fillStyle = lit(pal.post[1], f.side);
  circ(ctx, at.x, at.y, r);
  ctx.fill();
  ctx.fillRect(at.x - r, at.y - up, r * 2, up);
  ctx.fillStyle = lit(pal.post[2], f.side);
  ctx.fillRect(at.x - r, at.y - up * 0.6, r * 2, up * 0.2);
  ctx.fillStyle = lit(pal.post[0], f.top);
  circ(ctx, at.x, at.y - up, r);
  ctx.fill();
}

function lampPost(ctx: Ctx, at: Vec, f: ReturnType<typeof faces>) {
  const up = 2.6 * K;
  ctx.strokeStyle = lit("#3f434b", f.side);
  ctx.lineWidth = 0.14;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(at.x, at.y - up);
  ctx.stroke();
  ctx.fillStyle = lit("#3f434b", f.side);
  circ(ctx, at.x, at.y, 0.2);
  ctx.fill();
  ctx.fillStyle = lit("#fff3d1", f.top);
  ctx.beginPath();
  ctx.roundRect(at.x - 0.22, at.y - up - 0.3, 0.44, 0.42, 0.12);
  ctx.fill();
  ctx.fillStyle = lit("#3f434b", f.side);
  ctx.fillRect(at.x - 0.28, at.y - up - 0.36, 0.56, 0.1);
}

function prop(ctx: Ctx, p: Prop, pal: Pal, l: Light) {
  const r = rng(p.seed ?? 1);
  const f = faces(l);
  const sun = { x: -l.shadow.x, y: -l.shadow.y * 0.7 - 0.3 }; // where the light comes from, on screen
  const blobby = (cx: number, cy: number, R: number, cols: string[], n: number) => {
    // A rounded crown: a dark base, lighter clusters up toward the sun.
    ctx.fillStyle = lit(cols[0], f.side);
    circ(ctx, cx, cy, R);
    ctx.fill();
    cols.slice(1).forEach((col, layer) => {
      const k = 1 - (layer + 1) * 0.2;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = R * k * 0.4 * r();
        const ox = sun.x * R * 0.12 * (layer + 1), oy = sun.y * R * 0.12 * (layer + 1);
        ctx.fillStyle = lit(col, mixRGB(f.side, f.top, (layer + 1) / cols.length));
        circ(ctx, cx + Math.cos(a) * d + ox, cy + Math.sin(a) * d + oy, R * k * (0.4 + r() * 0.2));
        ctx.fill();
      }
    });
  };
  switch (p.kind) {
    case "tree": {
      const trunkH = Math.max(0.8, p.h * 0.35) * K;
      ctx.strokeStyle = lit(pal.trunk, f.side);
      ctx.lineWidth = Math.max(0.22, p.r * 0.22);
      ctx.beginPath();
      ctx.moveTo(p.at.x, p.at.y);
      ctx.lineTo(p.at.x, p.at.y - trunkH - p.r * 0.5);
      ctx.stroke();
      blobby(p.at.x, p.at.y - trunkH - p.r * 0.85, p.r, pal.canopy, 5);
      break;
    }
    case "bush":
      blobby(p.at.x, p.at.y - p.r * 0.6, p.r, pal.bush, 3);
      break;
    case "rock": {
      const up = p.r * 0.7 * K;
      ctx.fillStyle = lit(pal.rock[1], f.side);
      ctx.beginPath();
      ctx.ellipse(p.at.x, p.at.y - up * 0.4, p.r, p.r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lit(pal.rock[0], f.top);
      ctx.beginPath();
      ctx.ellipse(p.at.x - p.r * 0.1, p.at.y - up, p.r * 0.8, p.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

// --- Ground light ---

function sweepLine(ctx: Ctx, pts: Vec[], closed: boolean, w: number, s: Vec) {
  ctx.lineWidth = w;
  for (const [a, b] of edges(pts, closed)) {
    path(ctx, [a, b, { x: b.x + s.x, y: b.y + s.y }, { x: a.x + s.x, y: a.y + s.y }]);
    ctx.fill();
    ctx.stroke();
  }
}
const sv = (l: Light, h: number): Vec => ({ x: l.shadow.x * l.len * h, y: l.shadow.y * l.len * h });
// Shadows are faded: some light always bounces in.
export const shadeOf = (l: Light): RGB => mixRGB(l.shade, l.lit, 0.3);

export function buildLight(c: Course, l: Light) {
  const ppu = 5;
  const { el, ctx } = canvas(c, ppu);
  const shadows = canvas(c, ppu);
  const s = shadows.ctx;
  s.fillStyle = "#000";
  s.strokeStyle = "#000";
  const walls: Wall[] = [...c.greens.filter((g) => g.rim !== false).map((g) => ({ pts: g.poly, w: 0.42, h: 0.62, style: "rim" as const, closed: true })), ...c.walls];
  for (const w of walls) sweepLine(s, w.pts, !!w.closed, w.w, sv(l, w.h));
  for (const b of c.bumpers) {
    const o = sv(l, 0.8);
    s.lineWidth = b.r * 2;
    s.beginPath();
    s.moveTo(b.at.x, b.at.y);
    s.lineTo(b.at.x + o.x, b.at.y + o.y);
    s.stroke();
  }
  for (const p of c.props) {
    if (p.kind === "tree") {
      // The crown's shadow, where the sun puts it; the trunk's is too thin to notice once softened.
      const o = sv(l, p.h * 0.75);
      circ(s, p.at.x + o.x, p.at.y + o.y, p.r * 0.95);
      s.fill();
      circ(s, p.at.x, p.at.y, p.r * 0.35);
      s.fill();
    } else if (p.kind === "bush" || p.kind === "rock") {
      const o = sv(l, p.r * 0.8);
      circ(s, p.at.x + o.x * 0.6, p.at.y + o.y * 0.6, p.r);
      s.fill();
    }
  }
  for (const at of c.lamps) {
    const o = sv(l, 2.6);
    s.lineWidth = 0.15;
    s.beginPath();
    s.moveTo(at.x, at.y);
    s.lineTo(at.x + o.x, at.y + o.y);
    s.stroke();
    circ(s, at.x + o.x, at.y + o.y, 0.3);
    s.fill();
  }
  // Light, then the shadows laid over it softly.
  ctx.fillStyle = css(l.lit);
  ctx.fillRect(-MARGIN, -MARGIN, c.w + MARGIN * 2, c.h + MARGIN * 2);
  const tint = document.createElement("canvas");
  tint.width = shadows.el.width;
  tint.height = shadows.el.height;
  const t = tint.getContext("2d")!;
  t.drawImage(shadows.el, 0, 0);
  t.globalCompositeOperation = "source-in";
  t.fillStyle = css(shadeOf(l));
  t.fillRect(0, 0, tint.width, tint.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (hasFilter) ctx.filter = "blur(2.5px)";
  ctx.drawImage(tint, 0, 0);
  ctx.restore();
  // Lamp light after dark.
  if (l.night > 0.01) {
    ctx.globalCompositeOperation = "lighter";
    const col = paletteOf(c.theme).lamp;
    for (const at of c.lamps) {
      const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, 7);
      g.addColorStop(0, css(col, 0.75 * l.night));
      g.addColorStop(0.5, css(col, 0.25 * l.night));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      circ(ctx, at.x, at.y, 7);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  return el;
}

function buildGlow(c: Course, ppu: number) {
  const { el, ctx } = canvas(c, Math.max(6, ppu / 2));
  const col = paletteOf(c.theme).lamp;
  for (const at of c.lamps) {
    const head = { x: at.x, y: at.y - 2.6 * K - 0.1 };
    for (const [rad, a] of [[2.2, 0.35], [0.8, 0.7], [0.3, 1]] as const) {
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, rad);
      g.addColorStop(0, css(col, a));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      circ(ctx, head.x, head.y, rad);
      ctx.fill();
    }
  }
  return el;
}

// --- Frames ---

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx = { kind: "ring" | "splash" | "puff" | "spark" | "confetti"; x: number; y: number; t: number; color?: string; seed: number };
export type Mote = { x: number; y: number; vx: number; vy: number; ph: number };

type Water = { poly: Vec[]; holes: Vec[][]; glints: { x: number; y: number; ph: number }[] };
const waterCache = new WeakMap<Course, Water[]>();
function waters(c: Course): Water[] {
  let w = waterCache.get(c);
  if (w) return w;
  w = [];
  c.zones.forEach((z, i) => {
    if (z.kind !== "water") return;
    const holes = c.zones.slice(i + 1).filter((o) => o.kind === "bridge").map((o) => o.poly);
    const bb = bbox(z.poly);
    const r = rng(i * 99 + 1);
    const glints = [];
    for (let k = 0; k < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 0.25; k++) {
      const p = { x: bb.x0 + r() * (bb.x1 - bb.x0), y: bb.y0 + r() * (bb.y1 - bb.y0) };
      if (inPoly(p, z.poly)) glints.push({ ...p, ph: r() * 10 });
    }
    w!.push({ poly: z.poly, holes, glints });
  });
  waterCache.set(c, w);
  return w;
}

export type Frame = {
  c: Course;
  sim: Sim;
  layers: Layers;
  light: Light;
  cam: Camera;
  dpr: number;
  t: number;
  roll: { dist: number; dx: number; dy: number };
  trail: Vec[];
  fx: Fx[];
  motes: Mote[];
  wind: Vec;
  lightCanvas: HTMLCanvasElement;
  aim: { angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec } | null;
  effects?: boolean; // clouds, motes and vignette; off for still pictures
};

const FLAG_H = 2.8;

export function drawFrame(ctx: Ctx, f: Frame) {
  const { c, sim, layers, light, cam, dpr, t } = f;
  const pal = paletteOf(c.theme);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const T = (g: Ctx, k = 1) => g.setTransform(cam.s * dpr * k, 0, 0, cam.s * dpr * k, (cam.ox - cam.x * cam.s) * dpr * k, (cam.oy - cam.y * cam.s) * dpr * k);
  // Only the part of a world-sized layer that's on screen gets drawn.
  const vx0 = cam.x - cam.ox / cam.s, vy0 = cam.y - cam.oy / cam.s;
  const vx1 = vx0 + W / dpr / cam.s, vy1 = vy0 + H / dpr / cam.s;
  const big = (img: HTMLCanvasElement, g: Ctx = ctx) => {
    const k = img.width / (c.w + MARGIN * 2);
    const x0 = Math.max(-MARGIN, vx0 - 1), y0 = Math.max(-MARGIN, vy0 - 1);
    const x1 = Math.min(c.w + MARGIN, vx1 + 1), y1 = Math.min(c.h + MARGIN, vy1 + 1);
    if (x1 <= x0 || y1 <= y0) return;
    g.drawImage(img, (x0 + MARGIN) * k, (y0 + MARGIN) * k, (x1 - x0) * k, (y1 - y0) * k, x0, y0, x1 - x0, y1 - y0);
  };
  const day = 1 - light.night;
  const f0 = faces(light);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.beyond;
  ctx.fillRect(0, 0, W, H);
  T(ctx);
  ctx.imageSmoothingQuality = "medium";
  big(layers.ground);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Water: glints by day, slow rings.
  // Glints are only ever placed inside the water, so nothing needs clipping.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 0.08;
  for (const w of waters(c)) {
    for (const s of w.glints) {
      if (s.x < vx0 - 1 || s.x > vx1 + 1 || s.y < vy0 - 1 || s.y > vy1 + 1) continue;
      const a = Math.max(0, Math.sin(t * 1.3 + s.ph)) ** 8 * (0.25 + 0.6 * day);
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(s.x - 0.3, s.y);
      ctx.lineTo(s.x + 0.3, s.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // The cup: a hole you can see a little way into.
  const cupR = CUP_R * sim.cupScale;
  circ(ctx, c.cup.x, c.cup.y, cupR + 0.09);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();
  circ(ctx, c.cup.x, c.cup.y, cupR);
  ctx.fillStyle = "#1b2a1c";
  ctx.fill();
  ctx.save();
  circ(ctx, c.cup.x, c.cup.y, cupR);
  ctx.clip();
  circ(ctx, c.cup.x, c.cup.y + cupR * 0.45, cupR * 0.95);
  ctx.fillStyle = "#0b120b";
  ctx.fill();
  ctx.restore();

  drawFx(ctx, f.fx, t, pal, "ground");

  // Light on the ground: the sun's layer, plus everything that moves.
  const L = f.lightCanvas;
  const lw = Math.ceil(W / 3), lh = Math.ceil(H / 3);
  if (L.width !== lw || L.height !== lh) {
    L.width = lw;
    L.height = lh;
  }
  const lc = L.getContext("2d")!;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.globalCompositeOperation = "source-over";
  lc.fillStyle = css(light.lit);
  lc.fillRect(0, 0, lw, lh);
  T(lc, 1 / 3);
  if (layers.light) big(layers.light, lc);
  const shade = shadeOf(light);
  // Clouds drifting over, by day.
  if (f.effects !== false && day > 0.05) {
    for (let k = 0; k < 5; k++) {
      const span = c.w + c.h + 60;
      const along = ((t * 0.8 + k * span * 0.37) % span) - 30;
      const cx = -30 + f.wind.x * along + ((k * 23) % c.w), cy = -30 + f.wind.y * along + ((k * 41) % c.h);
      const rr = 9 + (k % 3) * 4;
      const g = lc.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, css(shade, 0.35 * day));
      g.addColorStop(1, css(shade, 0));
      lc.fillStyle = g;
      circ(lc, cx, cy, rr);
      lc.fill();
    }
  }
  lc.fillStyle = css(shade, 0.85);
  const out = sim.mode === "out" ? Math.min(1, sim.modeT / 0.6) : 0;
  const sinking = sim.mode === "sunk" ? Math.min(1, sim.modeT / 0.3) : 0;
  if (sinking < 1 && out < 1) {
    const o = sv(light, sim.z + 0.3);
    circ(lc, sim.x + o.x * 0.7, sim.y + o.y * 0.7, BALL_R * (1 + sim.z * 0.05));
    lc.fill();
  }
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const o = sv(light, 1);
    circ(lc, b.x + o.x, b.y + o.y, 0.45);
    lc.fill();
  });
  const dCup = Math.hypot(sim.x - c.cup.x, sim.y - c.cup.y);
  const flagA = sim.mode === "sunk" ? 0 : Math.max(0, Math.min(1, (dCup - 1.6) / 2));
  if (flagA > 0.3) {
    const o = sv(light, FLAG_H);
    lc.strokeStyle = css(shade, 0.85);
    lc.lineWidth = 0.1;
    lc.beginPath();
    lc.moveTo(c.cup.x, c.cup.y);
    lc.lineTo(c.cup.x + o.x, c.cup.y + o.y);
    lc.stroke();
    const o2 = sv(light, FLAG_H - 0.8);
    lc.beginPath();
    lc.moveTo(c.cup.x + o.x, c.cup.y + o.y);
    lc.lineTo(c.cup.x + o2.x + 1.2, c.cup.y + o2.y);
    lc.lineTo(c.cup.x + o2.x, c.cup.y + o2.y);
    lc.closePath();
    lc.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(L, 0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  T(ctx);

  // The ball on the ground, under anything tall that's in front of it.
  const ballR = BALL_R * (1 + sim.z * 0.08) * (1 - sinking * 0.45) * (1 - out);
  const bx = sinking ? sim.x + (c.cup.x - sim.x) * sinking : sim.x;
  const by = sinking ? sim.y + (c.cup.y - sim.y) * sinking : sim.y;
  const flying = sim.z > 0.35;
  if (f.trail.length > 1 && sim.mode === "roll") {
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = BALL_R * 1.2;
    path(ctx, f.trail, false);
    ctx.stroke();
  }
  if (!flying && sinking < 1 && out < 1) ball(ctx, bx, by - sim.z * K, ballR, f.roll, f0, light);

  // Everything standing up.
  if (layers.tall) big(layers.tall);

  // Mystery boxes, floating.
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const lift = (1 + Math.sin(t * 2 + i) * 0.12) * K;
    const s = 0.75, x = b.x - s / 2, y = b.y - lift - s;
    ctx.fillStyle = lit("#e0569a", f0.side);
    ctx.fillRect(x, y + s * 0.55, s, s * K);
    ctx.fillStyle = lit("#ffc94a", f0.top);
    ctx.beginPath();
    ctx.roundRect(x, y, s, s * 0.6, 0.08);
    ctx.fill();
  });

  // The flag, pulled out as the ball gets close.
  if (flagA > 0) {
    ctx.globalAlpha = flagA;
    const top = { x: c.cup.x, y: c.cup.y - FLAG_H * K };
    ctx.strokeStyle = lit("#f8f8f8", f0.side);
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(c.cup.x, c.cup.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      ctx.lineTo(top.x + u * 1.4, top.y + Math.sin(t * 4 - u * 4) * 0.1 * u + u * 0.12);
    }
    for (let k = 8; k >= 0; k--) {
      const u = k / 8;
      ctx.lineTo(top.x + u * 1.4, top.y + 0.8 - u * 0.58 + Math.sin(t * 4 - u * 4) * 0.1 * u);
    }
    ctx.closePath();
    ctx.fillStyle = lit(pal.flag, f0.top);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (flying && out < 1) ball(ctx, bx, by - sim.z * K, ballR, f.roll, f0, light);
  // A faint outline, so the ball shows through anything tall in front of it.
  if (!flying && sinking < 1 && out < 1 && sim.mode !== "sunk") {
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 0.06;
    circ(ctx, bx, by, ballR);
    ctx.stroke();
  }
  drawFx(ctx, f.fx, t, pal, "air");

  // Glow: lamps and fireflies after dark, the boxes always.
  ctx.globalCompositeOperation = "lighter";
  if (light.night > 0.02) {
    ctx.globalAlpha = light.night;
    big(layers.glow);
    ctx.globalAlpha = 1;
  }
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const y = b.y - (1 + Math.sin(t * 2 + i) * 0.12) * K - 0.4;
    const g = ctx.createRadialGradient(b.x, y, 0, b.x, y, 1.4);
    g.addColorStop(0, `rgba(255,190,220,${0.15 + 0.35 * light.night})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    circ(ctx, b.x, y, 1.4);
    ctx.fill();
  });
  if (f.effects !== false) motes(ctx, f, light);
  ctx.globalCompositeOperation = "source-over";

  // Question marks on the boxes, crisp in screen space.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const lift = (1 + Math.sin(t * 2 + i) * 0.12) * K;
    const sx = (b.x - cam.x) * cam.s + cam.ox, sy = (b.y - lift - 0.75 + 0.22 - cam.y) * cam.s + cam.oy;
    ctx.font = `800 ${Math.max(7, cam.s * 0.42)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText("?", sx, sy);
  });

  // Vignette, deeper at night.
  if (f.effects !== false) {
    const cw = W / dpr, ch = H / dpr;
    const g = ctx.createRadialGradient(cw / 2, ch * 0.48, Math.min(cw, ch) * 0.35, cw / 2, ch * 0.5, Math.max(cw, ch) * 0.75);
    g.addColorStop(0, "rgba(10,20,40,0)");
    g.addColorStop(1, `rgba(10,20,40,${0.22 + 0.25 * light.night})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }

  // The aim.
  if (f.aim && sim.mode === "aim") {
    const { power, line } = f.aim;
    const col = power < 0.5 ? mixRGB([255, 255, 255], [255, 214, 90], power * 2) : mixRGB([255, 214, 90], [255, 96, 80], (power - 0.5) * 2);
    if (f.aim.from && f.aim.to) {
      // Where the finger went down, and how far it's pulled.
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(f.aim.from.x, f.aim.from.y);
      ctx.lineTo(f.aim.to.x, f.aim.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      circ(ctx, f.aim.from.x, f.aim.from.y, 6);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
    }
    T(ctx);
    ctx.strokeStyle = css(col, 0.95);
    ctx.lineWidth = 0.16;
    ctx.setLineDash([0.05, 0.4]);
    ctx.lineDashOffset = -t * 1.2;
    path(ctx, line, false);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(sim.x, sim.y, BALL_R + 0.35, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();
  }
}

// The ball: shaded toward the sun, with two dimples that roll as it moves.
function ball(ctx: Ctx, x: number, y: number, R: number, roll: Frame["roll"], f: ReturnType<typeof faces>, l: Light) {
  const sun = { x: -l.shadow.x * R * 0.35, y: (-l.shadow.y * 0.7 - 0.4) * R * 0.5 };
  const g = ctx.createRadialGradient(x + sun.x, y + sun.y, R * 0.1, x, y, R);
  g.addColorStop(0, css(mixRGB(f.top, [255, 255, 255], 0.4)));
  g.addColorStop(0.75, css(mixRGB(f.top, f.side, 0.25)));
  g.addColorStop(1, css(mixRGB(f.side, [0, 0, 0], 0.15)));
  circ(ctx, x, y, R);
  ctx.fillStyle = g;
  ctx.fill();
  const ph = roll.dist / R;
  for (const k of [0, Math.PI]) {
    const c = Math.cos(ph + k);
    if (c <= 0) continue;
    const s = Math.sin(ph + k);
    ctx.fillStyle = `rgba(120,130,140,${0.55 * c})`;
    ctx.beginPath();
    ctx.ellipse(x + roll.dx * s * R * 0.7, y + roll.dy * s * R * 0.7, R * 0.2, R * 0.2 * Math.max(0.3, c), Math.atan2(roll.dy, roll.dx) + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Pollen by day, warm dust at golden hour, fireflies at night.
function motes(ctx: Ctx, f: Frame, l: Light) {
  const { t } = f;
  for (const m of f.motes) {
    const tw = Math.sin(t * 1.7 + m.ph);
    if (l.night > 0.5) {
      const a = Math.max(0, tw) ** 2 * l.night;
      if (a < 0.03) continue;
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 0.7);
      g.addColorStop(0, `rgba(230,255,140,${a})`);
      g.addColorStop(0.3, `rgba(200,255,100,${a * 0.4})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      circ(ctx, m.x, m.y, 0.7);
      ctx.fill();
    } else {
      const warm = l.altitude < 12;
      ctx.fillStyle = warm ? `rgba(255,220,160,${0.35 + 0.25 * tw})` : `rgba(255,255,255,${0.22 + 0.15 * tw})`;
      circ(ctx, m.x, m.y, 0.07);
      ctx.fill();
    }
  }
}

export function stepMotes(f: Pick<Frame, "motes" | "cam" | "wind" | "t">, dt: number, view: { w: number; h: number }, night: boolean) {
  const r = Math.random;
  const vw = view.w / f.cam.s, vh = view.h / f.cam.s;
  const x0 = f.cam.x - f.cam.ox / f.cam.s, y0 = f.cam.y - f.cam.oy / f.cam.s;
  while (f.motes.length < 28) f.motes.push({ x: x0 + r() * vw, y: y0 + r() * vh, vx: 0, vy: 0, ph: r() * 10 });
  for (const m of f.motes) {
    if (night) {
      m.vx += (r() - 0.5) * 2 * dt;
      m.vy += (r() - 0.5) * 2 * dt;
      m.vx *= 0.98;
      m.vy *= 0.98;
    } else {
      m.vx = f.wind.x * 0.6 + Math.sin(f.t * 0.7 + m.ph) * 0.25;
      m.vy = f.wind.y * 0.6 + Math.cos(f.t * 0.5 + m.ph) * 0.2;
    }
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.x < x0 - 2 || m.x > x0 + vw + 2 || m.y < y0 - 2 || m.y > y0 + vh + 2) {
      m.x = x0 + r() * vw;
      m.y = y0 + r() * vh;
    }
  }
}

function drawFx(ctx: Ctx, fx: Fx[], t: number, pal: Pal, layer: "ground" | "air") {
  for (const e of fx) {
    const age = t - e.t;
    const r = rng(e.seed);
    const ground = e.kind === "ring" || e.kind === "splash" || e.kind === "puff";
    if (ground !== (layer === "ground")) continue;
    if (e.kind === "ring" || e.kind === "splash") {
      const life = e.kind === "splash" ? 1.2 : 0.6;
      if (age > life) continue;
      const k = age / life;
      for (let i = 0; i < (e.kind === "splash" ? 3 : 1); i++) {
        const kk = Math.max(0, k - i * 0.15);
        ctx.strokeStyle = e.color ?? "#ffffff";
        ctx.globalAlpha = (1 - kk) * 0.8;
        ctx.lineWidth = 0.09;
        circ(ctx, e.x, e.y, 0.3 + kk * (e.kind === "splash" ? 1.8 : 1.2));
        ctx.stroke();
      }
      if (e.kind === "splash")
        for (let i = 0; i < 12; i++) {
          const a = r() * Math.PI * 2, sp = 1 + r() * 2;
          circ(ctx, e.x + Math.cos(a) * sp * k, e.y + Math.sin(a) * sp * k - Math.sin(k * Math.PI) * 1.2, 0.08);
          ctx.fillStyle = e.color ?? pal.water[1];
          ctx.fill();
        }
    } else if (e.kind === "puff") {
      if (age > 0.7) continue;
      const k = age / 0.7;
      for (let i = 0; i < 8; i++) {
        const a = r() * Math.PI * 2, sp = 0.4 + r() * 0.8;
        ctx.globalAlpha = (1 - k) * 0.6;
        circ(ctx, e.x + Math.cos(a) * sp * k, e.y + Math.sin(a) * sp * k - k * 0.3, 0.14 + k * 0.22);
        ctx.fillStyle = e.color ?? pal.sand[0];
        ctx.fill();
      }
    } else {
      const life = e.kind === "confetti" ? 2 : 0.8;
      if (age > life) continue;
      const k = age / life;
      const n = e.kind === "confetti" ? 40 : 16;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, sp = (e.kind === "confetti" ? 2.5 : 1.2) + r() * 2.5;
        const ease = 1 - (1 - k) ** 3;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = e.kind === "confetti" ? ["#ff5a5a", "#ffd84a", "#4ae07a", "#4ab8ff", "#c07aff"][i % 5] : (e.color ?? "#fff1b8");
        const x = e.x + Math.cos(a) * sp * ease, y = e.y + Math.sin(a) * sp * ease * 0.7 - Math.sin(k * Math.PI) * 2 + k * k * 1.5;
        ctx.fillRect(x - 0.08, y - 0.08, 0.16, e.kind === "confetti" ? 0.1 : 0.16);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// A whole hole in one picture, for lists.
export function still(c: Course, width: number, light: Light): HTMLCanvasElement {
  const ppu = Math.max(3, width / c.w);
  const layers = buildLayers(c, ppu);
  layers.light = buildLight(c, light);
  layers.tall = buildTall(c, ppu, light);
  const el = document.createElement("canvas");
  el.width = Math.round(width);
  el.height = Math.round((c.h / c.w) * width);
  const s = width / c.w;
  drawFrame(el.getContext("2d")!, {
    c,
    sim: { x: c.tee.x, y: c.tee.y, z: 0, mode: "aim", modeT: 0, cupScale: 1, boxes: c.boxes.map(() => false) } as Sim,
    layers,
    light,
    cam: { x: c.w / 2, y: c.h / 2, s, ox: el.width / 2, oy: el.height / 2 },
    dpr: 1,
    t: 0.5,
    roll: { dist: 0, dx: 1, dy: 0 },
    trail: [],
    fx: [],
    motes: [],
    wind: { x: 1, y: 0 },
    lightCanvas: document.createElement("canvas"),
    aim: null,
    effects: false,
  });
  return el;
}
