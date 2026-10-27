import {
  BALL_R,
  CUP_R,
  edges,
  inPoly,
  poseOf,
  portalPoint,
  rng,
  sliderRect,
  type Course,
  type Prop,
  type Sim,
  type Theme,
  type Vec,
  type Wall,
  type WallStyle,
  type Zone,
} from "./engine";
import { mixRGB, type Light, type RGB } from "./light";
import { bbox, centroid, scalePoly } from "./shapes";

// Drawing a course. Everything that doesn't move is drawn once into world-sized layers:
//   base   the ground, walls, blocks and low props
//   over   roofs and treetops, drawn over the ball
//   light  sunlight and shadow (and lamp light at night), multiplied over everything
//   glow   lamps, lava, neon: added on top, brighter at night
// Each frame draws those through the camera, with the moving things (ball, flag, windmill, water
// shimmer) in between. Shadows go into the light layer, so they take the sky's color, the way real
// shadows do.

type Ctx = CanvasRenderingContext2D;

// --- Colors ---

const hexRGB = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const tone = (h: string, k: number, a = 1) => css(k >= 0 ? mixRGB(hexRGB(h), [255, 255, 255], k) : mixRGB(hexRGB(h), [0, 0, 0], -k), a);

type Pal = {
  beyond: string;
  off: string;
  green: string;
  fringe: string;
  rim: WallStyle;
  sand: string;
  quicksand: string;
  snow: string;
  ice: string;
  stone: string;
  bridge: string;
  water: [string, string];
  voidc: [string, string];
  canopy: string[];
  flag: string;
  ramp: string;
  lamp: RGB;
};

const PAL: Record<Theme, Pal> = {
  hills: {
    beyond: "#3d7631", off: "#4f8f3b", green: "#6cbd4b", fringe: "#5eab43", rim: "wood", sand: "#ecd9a0", quicksand: "#b08a50",
    snow: "#f4f7fa", ice: "#a7dcef", stone: "#bdb7a6", bridge: "#a8794a", water: ["#6fd0e0", "#2779a6"], voidc: ["#3a3a3a", "#0b0b0b"],
    canopy: ["#2c6a2d", "#3b8536", "#55a243", "#73b84f"], flag: "#e8453c", ramp: "#b07e4a", lamp: [255, 196, 120],
  },
  desert: {
    beyond: "#d9b57c", off: "#e6c891", green: "#cf9461", fringe: "#c48858", rim: "adobe", sand: "#f2e0b0", quicksand: "#a9783f",
    snow: "#f4f7fa", ice: "#a7dcef", stone: "#c6a079", bridge: "#a8794a", water: ["#5fdccb", "#178e9e"], voidc: ["#7a4a2c", "#1e0f08"],
    canopy: ["#3e6b2c", "#4f8434", "#6aa040", "#8bb855"], flag: "#2a9df4", ramp: "#9b6a3e", lamp: [255, 178, 96],
  },
  ice: {
    beyond: "#e4edf3", off: "#eef4f8", green: "#b4d8e8", fringe: "#c4dfeb", rim: "ice", sand: "#ecd9a0", quicksand: "#b08a50",
    snow: "#f8fbfd", ice: "#93d3ec", stone: "#9fb2bf", bridge: "#8a6a4a", water: ["#7cc3df", "#2a6f99"], voidc: ["#5a87a8", "#081624"],
    canopy: ["#1f4a3a", "#2a5e48", "#3b7357", "#f2f7fa"], flag: "#e8453c", ramp: "#7fb4d1", lamp: [255, 214, 150],
  },
  volcano: {
    beyond: "#2a2427", off: "#3c3438", green: "#615862", fringe: "#564e57", rim: "obsidian", sand: "#7a6a66", quicksand: "#5a4a44",
    snow: "#f4f7fa", ice: "#a7dcef", stone: "#7e7672", bridge: "#5a4a44", water: ["#ffd25a", "#e8461a"], voidc: ["#3a2a2a", "#050303"],
    canopy: ["#3a3a3a", "#4a4a4a", "#5a5a5a", "#6a6a6a"], flag: "#ffb02e", ramp: "#4b444d", lamp: [255, 150, 70],
  },
  arcade: {
    beyond: "#07061a", off: "#0d0b26", green: "#231b55", fringe: "#1d174a", rim: "neon", sand: "#3a2a6a", quicksand: "#2a1a4a",
    snow: "#f4f7fa", ice: "#a7dcef", stone: "#3a3270", bridge: "#3a3270", water: ["#2ef2ff", "#0a5a9a"], voidc: ["#1a0a3a", "#000000"],
    canopy: ["#000", "#000", "#000", "#000"], flag: "#ff3ec9", ramp: "#2c2466", lamp: [255, 80, 220],
  },
  orbit: {
    beyond: "#04050c", off: "#05060f", green: "#7a7385", fringe: "#6c6577", rim: "metal", sand: "#8a8090", quicksand: "#6a6070",
    snow: "#f4f7fa", ice: "#a7dcef", stone: "#8d8796", bridge: "#56606e", water: ["#2ef2ff", "#0a5a9a"], voidc: ["#0a0c1a", "#000000"],
    canopy: ["#000", "#000", "#000", "#000"], flag: "#ffcf3e", ramp: "#56606e", lamp: [120, 200, 255],
  },
  server: {
    beyond: "#0e1216", off: "#151a20", green: "#2b3742", fringe: "#26313b", rim: "metal", sand: "#3a4652", quicksand: "#2a3440",
    snow: "#f4f7fa", ice: "#a7dcef", stone: "#3a4652", bridge: "#3a4652", water: ["#47e6ff", "#0a6a8a"], voidc: ["#0a0c10", "#000000"],
    canopy: ["#000", "#000", "#000", "#000"], flag: "#3ee07a", ramp: "#3a4652", lamp: [120, 210, 255],
  },
  zen: {
    beyond: "#56743f", off: "#64844a", green: "#86ad5f", fringe: "#7aa156", rim: "timber", sand: "#ebe2cc", quicksand: "#b8a888",
    snow: "#f4f7fa", ice: "#a7dcef", stone: "#aaa69a", bridge: "#b4452e", water: ["#62b3bf", "#1f5a6c"], voidc: ["#3a3a3a", "#0b0b0b"],
    canopy: ["#c7577e", "#e07fa2", "#f2a7c1", "#fbd0de"], flag: "#d8372c", ramp: "#8a5a3a", lamp: [255, 190, 110],
  },
};
export const paletteOf = (t: Theme) => PAL[t];

// --- Paths ---

function path(ctx: Ctx, pts: Vec[], closed = true) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
}
const shift = (pts: Vec[], dx: number, dy: number) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
function circ(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.001, r), 0, Math.PI * 2);
}

let noiseTile: HTMLCanvasElement | null = null;
function noise() {
  if (noiseTile) return noiseTile;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const img = g.createImageData(128, 128);
  const r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r() < 0.5 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = r() * 26;
  }
  g.putImageData(img, 0, 0);
  return (noiseTile = c);
}
// Fine grain over whatever is clipped, in device pixels so it stays crisp at any scale.
function grain(ctx: Ctx, alpha = 1) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.createPattern(noise(), "repeat")!;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

// --- Layers ---

export type Layers = { ppu: number; base: HTMLCanvasElement; over: HTMLCanvasElement; light?: HTMLCanvasElement; glowA?: HTMLCanvasElement; glowL?: HTMLCanvasElement; lightKey?: string };

// The ground carries on a little past the map, so the edge of the world is never a hard line.
export const marginOf = (c: Course) => (c.open ? 6 : 10);
function canvas(c: Course, ppu: number) {
  const M = marginOf(c);
  const el = document.createElement("canvas");
  el.width = Math.ceil((c.w + M * 2) * ppu);
  el.height = Math.ceil((c.h + M * 2) * ppu);
  const ctx = el.getContext("2d")!;
  ctx.setTransform(ppu, 0, 0, ppu, M * ppu, M * ppu);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { el, ctx };
}

const OVER: Prop["kind"][] = ["tree", "pine", "palm", "cherry", "maple"];

export function buildLayers(c: Course, ppu: number): Layers {
  const pal = PAL[c.theme];
  const base = canvas(c, ppu);
  const over = canvas(c, ppu);
  drawGround(base.ctx, c, pal, ppu);
  for (const z of c.zones) drawZone(base.ctx, c, z, pal, ppu);
  for (const p of c.portals) for (const pt of [p.a, p.b]) portalPad(base.ctx, pt);
  for (const w of c.wells) wellArt(base.ctx, w.at, w.r);
  drawWalls(base.ctx, c, pal, ppu);
  for (const b of c.blocks) (b.roof ? drawRoof(over.ctx, b.poly, c.theme) : drawBlock(base.ctx, b, c.theme, ppu));
  for (const b of c.bumpers) bumperArt(base.ctx, b.at, b.r, c.theme);
  for (const p of c.props) drawProp(OVER.includes(p.kind) ? over.ctx : base.ctx, p, c.theme, pal);
  return { ppu, base: base.el, over: over.el };
}

function drawGround(ctx: Ctx, c: Course, pal: Pal, ppu: number) {
  const r = rng(c.w * 1000 + c.h);
  const M = marginOf(c);
  ctx.fillStyle = pal.off;
  ctx.fillRect(-M, -M, c.w + M * 2, c.h + M * 2);
  // Textures cover the margin too.
  const X = -M, Y = -M, CW = c.w + M * 2, CH = c.h + M * 2;
  const area = CW * CH;
  switch (c.theme) {
    case "hills":
    case "zen":
      for (let i = 0; i < area * 3; i++) {
        ctx.fillStyle = tone(pal.off, r() < 0.5 ? -0.12 : 0.1, 0.5);
        circ(ctx, X + r() * CW, Y + r() * CH, 0.15 + r() * 0.5);
        ctx.fill();
      }
      break;
    case "desert": {
      // Wind ripples.
      ctx.lineWidth = 0.07;
      for (let y = Y; y < Y + CH; y += 0.55) {
        ctx.strokeStyle = tone(pal.off, r() < 0.5 ? -0.08 : 0.12, 0.7);
        ctx.beginPath();
        const ph = r() * 6;
        for (let x = X; x <= X + CW; x += 0.5) ctx.lineTo(x, y + Math.sin(x * 0.35 + ph) * 0.35 + Math.sin(x * 0.11 + y) * 0.6);
        ctx.stroke();
      }
      break;
    }
    case "ice":
      for (let i = 0; i < area * 1.4; i++) {
        ctx.fillStyle = r() < 0.6 ? "rgba(170,200,225,0.35)" : "rgba(255,255,255,0.9)";
        circ(ctx, X + r() * CW, Y + r() * CH, 0.1 + r() * 0.6);
        ctx.fill();
      }
      break;
    case "volcano":
      ctx.lineWidth = 0.08;
      for (let i = 0; i < area * 0.12; i++) {
        ctx.strokeStyle = r() < 0.15 ? "rgba(255,110,40,0.55)" : "rgba(0,0,0,0.35)";
        let x = X + r() * CW, y = Y + r() * CH;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) ctx.lineTo((x += (r() - 0.5) * 2), (y += (r() - 0.5) * 2));
        ctx.stroke();
      }
      break;
    case "arcade":
      ctx.lineWidth = 0.04;
      ctx.strokeStyle = "rgba(255,62,201,0.22)";
      for (let x = X; x <= X + CW; x += 1.5) (ctx.beginPath(), ctx.moveTo(x, Y), ctx.lineTo(x, Y + CH), ctx.stroke());
      for (let y = Y; y <= Y + CH; y += 1.5) (ctx.beginPath(), ctx.moveTo(X, y), ctx.lineTo(X + CW, y), ctx.stroke());
      break;
    case "orbit":
      for (let i = 0; i < 3; i++) {
        const g = ctx.createRadialGradient(X + r() * CW, Y + r() * CH, 0, c.w / 2, c.h / 2, CH * 0.7);
        g.addColorStop(0, ["rgba(120,60,200,0.35)", "rgba(40,120,220,0.3)", "rgba(220,60,120,0.25)"][i]);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(X, Y, CW, CH);
      }
      for (let i = 0; i < area * 1.2; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.8})`;
        circ(ctx, X + r() * CW, Y + r() * CH, 0.02 + r() * r() * 0.09);
        ctx.fill();
      }
      break;
    case "server":
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      for (let x = X; x <= X + CW; x += 1.2) (ctx.beginPath(), ctx.moveTo(x, Y), ctx.lineTo(x, Y + CH), ctx.stroke());
      for (let y = Y; y <= Y + CH; y += 1.2) (ctx.beginPath(), ctx.moveTo(X, y), ctx.lineTo(X + CW, y), ctx.stroke());
      break;
  }
  grain(ctx, 0.9);

  for (const g of c.greens) {
    ctx.save();
    path(ctx, g.poly);
    ctx.fillStyle = pal.green;
    ctx.fill();
    ctx.clip();
    if (c.theme === "server" || c.theme === "arcade") {
      // Raised floor tiles, or a felt grid.
      const step = c.theme === "server" ? 1.2 : 1;
      for (let x = 0; x < c.w; x += step)
        for (let y = 0; y < c.h; y += step) {
          ctx.fillStyle = (Math.floor(x / step) + Math.floor(y / step)) % 2 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.06)";
          ctx.fillRect(x, y, step, step);
        }
      if (c.theme === "server") {
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = 0.05;
        for (let x = 0; x < c.w; x += step) (ctx.beginPath(), ctx.moveTo(x, 0), ctx.lineTo(x, c.h), ctx.stroke());
        for (let y = 0; y < c.h; y += step) (ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(c.w, y), ctx.stroke());
      }
    } else if (c.theme === "orbit") {
      // Asteroid rock: craters.
      const rr = rng(Math.round(g.poly[0].x * 100));
      const bb = bbox(g.poly);
      for (let i = 0; i < 18; i++) {
        const x = bb.x0 + rr() * (bb.x1 - bb.x0), y = bb.y0 + rr() * (bb.y1 - bb.y0), cr = 0.2 + rr() * 0.6;
        circ(ctx, x, y, cr);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fill();
        circ(ctx, x - cr * 0.15, y - cr * 0.15, cr * 0.8);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fill();
      }
    } else {
      // Mowing stripes.
      for (let y = 0; y < c.h; y += 2.4) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(0, y, c.w, 1.2);
      }
    }
    grain(ctx, 0.7);
    // A darker edge where the carpet meets the rim.
    path(ctx, g.poly);
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
    if (g.rim === false && c.theme !== "orbit") {
      path(ctx, g.poly);
      ctx.strokeStyle = tone(pal.green, -0.12, 0.6);
      ctx.lineWidth = 0.15;
      ctx.stroke();
    }
    if (c.theme === "orbit") {
      // Rock edges catch the light.
      path(ctx, g.poly);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.35;
      ctx.stroke();
      path(ctx, shift(g.poly, -0.06, -0.06));
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 0.1;
      ctx.stroke();
    }
  }
  void ppu;
}

// Darker toward the edge, from inside: depth for water, glow for lava, cliffs for pits.
function innerEdge(ctx: Ctx, poly: Vec[], color: string, widths: [number, number][]) {
  ctx.save();
  path(ctx, poly);
  ctx.clip();
  for (const [w, a] of widths) {
    path(ctx, poly);
    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  ctx.restore();
}

function chevrons(ctx: Ctx, poly: Vec[], dir: Vec, spacing: number, color: string, size = 0.35) {
  const bb = bbox(poly);
  const ang = Math.atan2(dir.y, dir.x);
  ctx.save();
  path(ctx, poly);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.11;
  for (let x = bb.x0 + spacing / 2; x < bb.x1; x += spacing)
    for (let y = bb.y0 + spacing / 2; y < bb.y1; y += spacing) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(-size * 0.6, -size);
      ctx.lineTo(size * 0.4, 0);
      ctx.lineTo(-size * 0.6, size);
      ctx.stroke();
      ctx.restore();
    }
  ctx.restore();
}

function drawZone(ctx: Ctx, c: Course, z: Zone, pal: Pal, ppu: number) {
  const r = rng(Math.round(z.poly[0].x * 977 + z.poly[0].y * 131));
  const bb = bbox(z.poly);
  const fillClip = (color: string) => {
    path(ctx, z.poly);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.save();
    ctx.clip();
  };
  switch (z.kind) {
    case "fringe":
      fillClip(pal.fringe);
      for (let y = 0; y < c.h; y += 2.4) {
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.fillRect(0, y, c.w, 1.2);
      }
      grain(ctx, 0.6);
      ctx.restore();
      break;
    case "green":
      fillClip(tone(pal.green, 0.08));
      for (let y = 0; y < c.h; y += 1.2) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(0, y, c.w, 0.6);
      }
      grain(ctx, 0.5);
      ctx.restore();
      path(ctx, z.poly);
      ctx.strokeStyle = tone(pal.green, -0.1, 0.5);
      ctx.lineWidth = 0.12;
      ctx.stroke();
      break;
    case "sand":
    case "quicksand": {
      const col = z.kind === "sand" ? pal.sand : pal.quicksand;
      fillClip(col);
      for (let i = 0; i < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 12; i++) {
        ctx.fillStyle = tone(col, r() < 0.5 ? -0.15 : 0.2, 0.6);
        circ(ctx, bb.x0 + r() * (bb.x1 - bb.x0), bb.y0 + r() * (bb.y1 - bb.y0), 0.03 + r() * 0.05);
        ctx.fill();
      }
      if (z.kind === "quicksand") {
        const m = centroid(z.poly);
        ctx.lineWidth = 0.09;
        for (let k = 1; k < 7; k++) {
          ctx.strokeStyle = `rgba(60,35,10,${0.32 - k * 0.03})`;
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 2 + 0.1; a += 0.2) {
            const rr = k * 0.28 + a * 0.05;
            ctx.lineTo(m.x + Math.cos(a + k) * rr, m.y + Math.sin(a + k) * rr * 0.85);
          }
          ctx.stroke();
        }
      } else if (c.theme === "zen") {
        // Raked lines.
        ctx.strokeStyle = "rgba(120,100,70,0.35)";
        ctx.lineWidth = 0.06;
        for (let y = bb.y0; y < bb.y1; y += 0.32) (ctx.beginPath(), ctx.moveTo(bb.x0, y), ctx.bezierCurveTo(bb.x0 + 4, y - 0.3, bb.x1 - 4, y + 0.3, bb.x1, y), ctx.stroke());
      }
      grain(ctx, 0.6);
      ctx.restore();
      innerEdge(ctx, z.poly, "rgba(90,60,20,1)", [[0.5, 0.18], [0.18, 0.25]]);
      break;
    }
    case "snow":
      fillClip(pal.snow);
      for (let i = 0; i < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 3; i++) {
        ctx.fillStyle = r() < 0.5 ? "rgba(180,205,225,0.5)" : "#ffffff";
        circ(ctx, bb.x0 + r() * (bb.x1 - bb.x0), bb.y0 + r() * (bb.y1 - bb.y0), 0.05 + r() * 0.15);
        ctx.fill();
      }
      ctx.restore();
      innerEdge(ctx, z.poly, "rgba(150,185,210,1)", [[0.4, 0.4]]);
      break;
    case "ice":
      fillClip(pal.ice);
      // Polished streaks and a few cracks.
      ctx.lineWidth = 0.35;
      for (let i = 0; i < 18; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`;
        const x = bb.x0 + r() * (bb.x1 - bb.x0), y = bb.y0 + r() * (bb.y1 - bb.y0);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 2.5, y - 2.5);
        ctx.stroke();
      }
      ctx.lineWidth = 0.04;
      for (let i = 0; i < (bb.x1 - bb.x0) * 0.8; i++) {
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        let x = bb.x0 + r() * (bb.x1 - bb.x0), y = bb.y0 + r() * (bb.y1 - bb.y0);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) ctx.lineTo((x += (r() - 0.5) * 1.6), (y += (r() - 0.5) * 1.6));
        ctx.stroke();
      }
      ctx.restore();
      innerEdge(ctx, z.poly, "rgba(255,255,255,1)", [[0.3, 0.55]]);
      break;
    case "bridge": {
      const across = bb.x1 - bb.x0 < bb.y1 - bb.y0; // planks run across the short side
      fillClip(pal.bridge);
      ctx.strokeStyle = "rgba(40,20,10,0.45)";
      ctx.lineWidth = 0.06;
      if (across) for (let y = bb.y0; y < bb.y1; y += 0.5) (ctx.beginPath(), ctx.moveTo(bb.x0, y), ctx.lineTo(bb.x1, y), ctx.stroke());
      else for (let x = bb.x0; x < bb.x1; x += 0.5) (ctx.beginPath(), ctx.moveTo(x, bb.y0), ctx.lineTo(x, bb.y1), ctx.stroke());
      grain(ctx, 1);
      ctx.restore();
      break;
    }
    case "stone": {
      fillClip(pal.stone);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 0.05;
      for (let i = 0; i < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 0.5; i++) {
        let x = bb.x0 + r() * (bb.x1 - bb.x0), y = bb.y0 + r() * (bb.y1 - bb.y0);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) ctx.lineTo((x += (r() - 0.5) * 1.2), (y += (r() - 0.5) * 1.2));
        ctx.stroke();
      }
      grain(ctx, 1);
      ctx.restore();
      innerEdge(ctx, z.poly, "rgba(0,0,0,1)", [[0.25, 0.25]]);
      path(ctx, shift(z.poly, -0.04, -0.04));
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 0.06;
      ctx.stroke();
      break;
    }
    case "water":
    case "coolant": {
      const [shallow, deep] = z.kind === "coolant" ? (["#59f0ff", "#0b7fa6"] as [string, string]) : pal.water;
      if (c.theme === "volcano") {
        lavaArt(ctx, z.poly, bb, r);
        break;
      }
      path(ctx, z.poly);
      ctx.fillStyle = deep;
      ctx.fill();
      innerEdge(ctx, z.poly, shallow, [[2.4, 0.25], [1.4, 0.4], [0.7, 0.6]]);
      ctx.save();
      path(ctx, z.poly);
      ctx.clip();
      grain(ctx, 0.5);
      ctx.restore();
      // Wet edge, then the bank.
      path(ctx, z.poly);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 0.12;
      ctx.stroke();
      path(ctx, z.poly);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 0.32;
      ctx.globalCompositeOperation = "multiply";
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      break;
    }
    case "lava":
      lavaArt(ctx, z.poly, bb, r);
      break;
    case "void": {
      path(ctx, z.poly);
      ctx.fillStyle = pal.voidc[1];
      ctx.fill();
      innerEdge(ctx, z.poly, pal.voidc[0], [[1.6, 0.25], [0.8, 0.45], [0.3, 0.8]]);
      path(ctx, z.poly);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 0.08;
      ctx.stroke();
      break;
    }
    case "slope": {
      ctx.save();
      path(ctx, z.poly);
      ctx.clip();
      const m = centroid(z.poly);
      const half = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
      const g = ctx.createLinearGradient(m.x - z.dir.x * half, m.y - z.dir.y * half, m.x + z.dir.x * half, m.y + z.dir.y * half);
      g.addColorStop(0, "rgba(255,255,255,0.13)");
      g.addColorStop(1, "rgba(0,0,0,0.14)");
      ctx.fillStyle = g;
      ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      ctx.restore();
      chevrons(ctx, z.poly, z.dir, 1.7, "rgba(255,255,255,0.3)", 0.32);
      break;
    }
    case "mound": {
      const g = ctx.createRadialGradient(z.center.x, z.center.y, 0, z.center.x, z.center.y, z.radius);
      if (z.strength > 0) {
        g.addColorStop(0, "rgba(255,255,255,0.12)");
        g.addColorStop(0.6, "rgba(255,255,255,0.03)");
        g.addColorStop(1, "rgba(0,0,0,0.08)");
      } else {
        g.addColorStop(0, "rgba(0,0,0,0.12)");
        g.addColorStop(1, "rgba(0,0,0,0)");
      }
      ctx.fillStyle = g;
      circ(ctx, z.center.x, z.center.y, z.radius);
      ctx.fill();
      // Contour lines.
      ctx.strokeStyle = z.strength > 0 ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.1)";
      ctx.lineWidth = 0.06;
      for (let k = 1; k <= 3; k++) {
        circ(ctx, z.center.x, z.center.y, (z.radius * k) / 3.6);
        ctx.stroke();
      }
      break;
    }
    case "boost": {
      path(ctx, z.poly);
      ctx.fillStyle = "rgba(10,10,20,0.75)";
      ctx.fill();
      chevrons(ctx, z.poly, z.dir, 0.9, c.theme === "arcade" ? "#2ef2ff" : "#ffb02e", 0.3);
      path(ctx, z.poly);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 0.08;
      ctx.stroke();
      break;
    }
    case "ramp": {
      const m = centroid(z.poly);
      const half = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
      path(ctx, z.poly);
      ctx.fillStyle = pal.ramp;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // Lower end in shade, the lip catching light.
      const g = ctx.createLinearGradient(m.x - z.dir.x * half, m.y - z.dir.y * half, m.x + z.dir.x * half, m.y + z.dir.y * half);
      g.addColorStop(0, "rgba(0,0,0,0.25)");
      g.addColorStop(1, "rgba(255,255,255,0.22)");
      ctx.fillStyle = g;
      ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 0.05;
      const across = { x: -z.dir.y, y: z.dir.x };
      for (let k = -half; k < half; k += 0.4) {
        ctx.beginPath();
        ctx.moveTo(m.x + z.dir.x * k - across.x * half, m.y + z.dir.y * k - across.y * half);
        ctx.lineTo(m.x + z.dir.x * k + across.x * half, m.y + z.dir.y * k + across.y * half);
        ctx.stroke();
      }
      grain(ctx, 1);
      ctx.restore();
      path(ctx, z.poly);
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 0.14;
      ctx.stroke();
      // A painted arrow.
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(Math.atan2(z.dir.y, z.dir.x));
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(0.75, 0);
      ctx.lineTo(-0.1, -0.6);
      ctx.lineTo(-0.1, -0.25);
      ctx.lineTo(-0.8, -0.25);
      ctx.lineTo(-0.8, 0.25);
      ctx.lineTo(-0.1, 0.25);
      ctx.lineTo(-0.1, 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case "conveyor": {
      path(ctx, z.poly);
      ctx.fillStyle = "#23262b";
      ctx.fill();
      path(ctx, z.poly);
      ctx.strokeStyle = "#5b6068";
      ctx.lineWidth = 0.2;
      ctx.stroke();
      break;
    }
  }
  void ppu;
}

function lavaArt(ctx: Ctx, poly: Vec[], bb: ReturnType<typeof bbox>, r: () => number) {
  path(ctx, poly);
  ctx.fillStyle = "#ff9a2a";
  ctx.fill();
  ctx.save();
  ctx.clip();
  const m = centroid(poly);
  const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2);
  g.addColorStop(0, "#ffe27a");
  g.addColorStop(1, "#ff7a1a");
  ctx.fillStyle = g;
  ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
  // Cooling crust floating on top.
  for (let i = 0; i < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 0.5; i++) {
    const x = bb.x0 + r() * (bb.x1 - bb.x0), y = bb.y0 + r() * (bb.y1 - bb.y0);
    const pts = Array.from({ length: 7 }, (_, k) => {
      const a = (k / 7) * Math.PI * 2, rr = 0.12 + r() * 0.3;
      return { x: x + Math.cos(a) * rr * 1.6, y: y + Math.sin(a) * rr };
    });
    path(ctx, pts);
    ctx.fillStyle = `rgba(${150 + r() * 50},${40 + r() * 30},10,0.35)`;
    ctx.fill();
  }
  // Bright seams where it flows.
  ctx.strokeStyle = "rgba(255,250,200,0.5)";
  ctx.lineWidth = 0.05;
  for (let i = 0; i < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 0.15; i++) {
    let x = bb.x0 + r() * (bb.x1 - bb.x0), y = bb.y0 + r() * (bb.y1 - bb.y0);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) ctx.lineTo((x += 0.4 + r() * 0.5), (y += (r() - 0.5) * 0.4));
    ctx.stroke();
  }
  ctx.restore();
  innerEdge(ctx, poly, "#5a1a0a", [[0.9, 0.4], [0.35, 0.8]]);
}

function portalPad(ctx: Ctx, at: Vec) {
  circ(ctx, at.x, at.y, 0.85);
  ctx.fillStyle = "#16112a";
  ctx.fill();
  ctx.strokeStyle = "#7a5cff";
  ctx.lineWidth = 0.14;
  ctx.stroke();
}

function wellArt(ctx: Ctx, at: Vec, r: number) {
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.12, "rgba(0,0,0,1)");
  g.addColorStop(0.16, "rgba(255,170,90,0.9)");
  g.addColorStop(0.22, "rgba(160,70,200,0.5)");
  g.addColorStop(0.5, "rgba(60,30,120,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  circ(ctx, at.x, at.y, r);
  ctx.fill();
  // Rings showing which way things fall.
  ctx.strokeStyle = "rgba(180,140,255,0.16)";
  ctx.lineWidth = 0.05;
  for (let k = 1; k <= 4; k++) {
    circ(ctx, at.x, at.y, r * (k / 4.5));
    ctx.stroke();
  }
}

function bumperArt(ctx: Ctx, at: Vec, r: number, theme: Theme) {
  if (theme === "ice") {
    rockShape(ctx, at, r, 11, "#cfe9f5", "#8fc0d8");
    return;
  }
  if (theme === "volcano") {
    circ(ctx, at.x, at.y, r);
    ctx.fillStyle = "#3d3a40";
    ctx.fill();
    circ(ctx, at.x, at.y, r * 0.6);
    ctx.fillStyle = "#56535a";
    ctx.fill();
    ctx.strokeStyle = "#ffb02e";
    ctx.lineWidth = 0.08;
    circ(ctx, at.x, at.y, r * 0.8);
    ctx.stroke();
    return;
  }
  circ(ctx, at.x, at.y, r);
  ctx.fillStyle = "#1a1438";
  ctx.fill();
  ctx.lineWidth = 0.16;
  ctx.strokeStyle = "#ff3ec9";
  ctx.stroke();
  circ(ctx, at.x, at.y, r * 0.55);
  ctx.fillStyle = "#2ef2ff";
  ctx.fill();
  circ(ctx, at.x - r * 0.15, at.y - r * 0.15, r * 0.22);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fill();
}

const WALL: Record<WallStyle, [string, string, string?]> = {
  rim: ["#6e4a2c", "#9a6b3f"],
  wood: ["#6a4528", "#9a6b3f", "#b98352"],
  stone: ["#7f7b70", "#b3ae9f"],
  hedge: ["#24502a", "#3d7a36", "#58963f"],
  adobe: ["#8f4f2e", "#c27a4c", "#d99566"],
  ice: ["#6fa6c6", "#c4e8f7", "#ffffff"],
  obsidian: ["#0d0b10", "#2a2531", "#ff7a2a"],
  neon: ["#0a0820", "#1a1440", "#2ef2ff"],
  metal: ["#3a4048", "#7a838e", "#a8b0ba"],
  rack: ["#11161b", "#2a333d"],
  timber: ["#3e2a1e", "#6a4a34", "#8a6446"],
  fence: ["#6a4528", "#a77a4a"],
  rail: ["#5a3c24", "#8a603a"],
};

function wallStroke(ctx: Ctx, pts: Vec[], closed: boolean, w: number, style: WallStyle, ppu: number) {
  const [base, top, line] = WALL[style];
  ctx.save();
  // Contact shadow: grounds the wall even at noon.
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = ppu * 0.3;
  path(ctx, pts, closed);
  ctx.strokeStyle = base;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.restore();
  path(ctx, pts, closed);
  ctx.strokeStyle = top;
  ctx.lineWidth = w * 0.62;
  ctx.stroke();
  if (style === "stone") {
    ctx.lineCap = "butt";
    ctx.setLineDash([0.05, 0.55]);
    ctx.strokeStyle = "rgba(60,55,45,0.55)";
    ctx.lineWidth = w * 0.62;
    path(ctx, pts, closed);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
  } else if (style === "hedge") {
    const r = rng(Math.round(pts[0].x * 100 + pts[0].y));
    for (const [a, b] of edges(pts, closed)) {
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      for (let t = 0; t < l; t += 0.18) {
        const k = t / l;
        ctx.fillStyle = r() < 0.5 ? (line as string) : "#2f6a30";
        circ(ctx, a.x + (b.x - a.x) * k + (r() - 0.5) * w * 0.7, a.y + (b.y - a.y) * k + (r() - 0.5) * w * 0.7, w * (0.12 + r() * 0.12));
        ctx.fill();
      }
    }
  } else if (line) {
    path(ctx, pts, closed);
    ctx.strokeStyle = line;
    ctx.lineWidth = w * (style === "neon" ? 0.28 : 0.14);
    ctx.stroke();
  }
}

function drawWalls(ctx: Ctx, c: Course, pal: Pal, ppu: number) {
  for (const g of c.greens) if (g.rim !== false) wallStroke(ctx, g.poly, true, 0.4, pal.rim, ppu);
  for (const w of c.walls) wallStroke(ctx, w.pts, !!w.closed, w.w, w.style, ppu);
}

function rockShape(ctx: Ctx, at: Vec, r: number, seed: number, light: string, dark: string) {
  const rr = rng(seed);
  const pts = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2 + rr() * 0.3;
    const d = r * (0.8 + rr() * 0.3);
    return { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d };
  });
  path(ctx, pts);
  ctx.fillStyle = dark;
  ctx.fill();
  path(ctx, scalePoly(pts, 0.72).map((p) => ({ x: p.x - r * 0.08, y: p.y - r * 0.1 })));
  ctx.fillStyle = light;
  ctx.fill();
}

function drawBlock(ctx: Ctx, b: Course["blocks"][number], theme: Theme, ppu: number) {
  const ground = () => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = ppu * 0.4;
    path(ctx, b.poly);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  };
  ground();
  switch (b.style) {
    case "mesa": {
      const layers = ["#9a4f2e", "#b8633a", "#c97a48", "#d98f58", "#e5a66c"];
      layers.forEach((col, i) => {
        path(ctx, scalePoly(b.poly, 1, i * 0.32));
        ctx.fillStyle = col;
        ctx.fill();
      });
      ctx.save();
      path(ctx, scalePoly(b.poly, 1, 1.6));
      ctx.clip();
      grain(ctx, 1.5);
      ctx.restore();
      break;
    }
    case "mill":
      path(ctx, b.poly);
      ctx.fillStyle = "#e9e1cf";
      ctx.fill();
      path(ctx, b.poly);
      ctx.strokeStyle = "#a99c82";
      ctx.lineWidth = 0.12;
      ctx.stroke();
      break;
    case "rack": {
      path(ctx, b.poly);
      ctx.fillStyle = "#12171c";
      ctx.fill();
      const bb = bbox(b.poly);
      ctx.fillStyle = "#222a33";
      ctx.fillRect(bb.x0 + 0.15, bb.y0 + 0.15, bb.x1 - bb.x0 - 0.3, bb.y1 - bb.y0 - 0.3);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 0.05;
      const long = bb.x1 - bb.x0 > bb.y1 - bb.y0;
      for (let t = 0.6; t < (long ? bb.x1 - bb.x0 : bb.y1 - bb.y0); t += 0.6) {
        ctx.beginPath();
        if (long) (ctx.moveTo(bb.x0 + t, bb.y0 + 0.15), ctx.lineTo(bb.x0 + t, bb.y1 - 0.15));
        else (ctx.moveTo(bb.x0 + 0.15, bb.y0 + t), ctx.lineTo(bb.x1 - 0.15, bb.y0 + t));
        ctx.stroke();
      }
      break;
    }
    case "cabin": {
      const bb = bbox(b.poly);
      path(ctx, b.poly);
      ctx.fillStyle = "#6a4a34";
      ctx.fill();
      const midY = (bb.y0 + bb.y1) / 2;
      ctx.fillStyle = theme === "ice" ? "#f3f7fa" : "#8a3a2a";
      ctx.fillRect(bb.x0 - 0.2, bb.y0 - 0.2, bb.x1 - bb.x0 + 0.4, midY - bb.y0 + 0.2);
      ctx.fillStyle = theme === "ice" ? "#d7e4ec" : "#6e2c20";
      ctx.fillRect(bb.x0 - 0.2, midY, bb.x1 - bb.x0 + 0.4, bb.y1 - midY + 0.2);
      ctx.fillStyle = "#5a5552";
      ctx.fillRect(bb.x1 - 1.2, bb.y0 + 0.3, 0.6, 0.6);
      break;
    }
    case "pillar":
      path(ctx, b.poly);
      ctx.fillStyle = "#16131b";
      ctx.fill();
      path(ctx, scalePoly(b.poly, 0.7));
      ctx.fillStyle = "#2c2733";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,122,42,0.7)";
      ctx.lineWidth = 0.06;
      path(ctx, scalePoly(b.poly, 0.4));
      ctx.stroke();
      break;
    case "ice": {
      path(ctx, b.poly);
      ctx.fillStyle = "#7fb7d3";
      ctx.fill();
      path(ctx, scalePoly(b.poly, 0.75).map((p) => ({ x: p.x - 0.1, y: p.y - 0.1 })));
      ctx.fillStyle = "#cdeaf7";
      ctx.fill();
      break;
    }
    default:
      path(ctx, b.poly);
      ctx.fillStyle = "#8a8378";
      ctx.fill();
  }
}

function drawRoof(ctx: Ctx, poly: Vec[], theme: Theme) {
  const bb = bbox(poly);
  const midX = (bb.x0 + bb.x1) / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 12;
  path(ctx, poly);
  ctx.fillStyle = "#7a2f22";
  ctx.fill();
  ctx.restore();
  ctx.save();
  path(ctx, poly);
  ctx.clip();
  ctx.fillStyle = "#9c3e2c";
  ctx.fillRect(bb.x0, bb.y0, midX - bb.x0, bb.y1 - bb.y0);
  ctx.fillStyle = "#b64a33";
  ctx.fillRect(midX, bb.y0, bb.x1 - midX, bb.y1 - bb.y0);
  // Rows of tiles.
  ctx.strokeStyle = "rgba(60,20,10,0.4)";
  ctx.lineWidth = 0.06;
  for (let y = bb.y0 + 0.35; y < bb.y1; y += 0.42) (ctx.beginPath(), ctx.moveTo(bb.x0, y), ctx.lineTo(bb.x1, y), ctx.stroke());
  for (let x = bb.x0; x < bb.x1; x += 0.5) {
    ctx.beginPath();
    for (let y = bb.y0; y < bb.y1; y += 0.84) (ctx.moveTo(x, y), ctx.lineTo(x, y + 0.42));
    ctx.stroke();
  }
  grain(ctx, 1);
  ctx.restore();
  ctx.strokeStyle = "#5a2016";
  ctx.lineWidth = 0.18;
  ctx.beginPath();
  ctx.moveTo(midX, bb.y0);
  ctx.lineTo(midX, bb.y1);
  ctx.stroke();
  void theme;
}

function drawProp(ctx: Ctx, p: Prop, theme: Theme, pal: Pal) {
  const r = rng(p.seed ?? Math.round(p.at.x * 1000 + p.at.y * 7));
  const { x, y } = p.at;
  const lobes = (cols: string[], R: number, n: number) => {
    // Dark base, then lighter clusters on top.
    circ(ctx, x, y, R);
    ctx.fillStyle = cols[0];
    ctx.fill();
    cols.slice(1).forEach((col, layer) => {
      const k = 1 - (layer + 1) * 0.22;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = R * k * 0.45 * r();
        circ(ctx, x + Math.cos(a) * d - R * 0.08 * layer, y + Math.sin(a) * d - R * 0.08 * layer, R * k * (0.42 + r() * 0.2));
        ctx.fillStyle = col;
        ctx.fill();
      }
    });
  };
  switch (p.kind) {
    case "tree":
      lobes(pal.canopy, p.r, 6);
      break;
    case "cherry":
      lobes(["#b84a72", "#d8709a", "#eea0bd", "#fcd3e1"], p.r, 7);
      break;
    case "maple":
      lobes(["#9c2a1e", "#c8442a", "#e2683a", "#f29a4a"], p.r, 6);
      break;
    case "bush":
      lobes(theme === "hills" ? ["#285c28", "#3a7f35", "#57a046"] : pal.canopy.slice(0, 3), p.r, 4);
      break;
    case "pine": {
      const snowy = theme === "ice";
      [["#173a2e", 1], ["#215040", 0.72], ["#2d6650", 0.46], [snowy ? "#e9f3f8" : "#3a7a5e", 0.2]].forEach(([col, k], i) => {
        const R = p.r * (k as number), n = 9;
        ctx.beginPath();
        for (let j = 0; j < n * 2; j++) {
          const a = (j / (n * 2)) * Math.PI * 2 + i * 0.3;
          const d = j % 2 ? R * 0.62 : R;
          ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
        }
        ctx.closePath();
        ctx.fillStyle = col as string;
        ctx.fill();
      });
      if (snowy)
        for (let i = 0; i < 8; i++) {
          const a = r() * Math.PI * 2, d = p.r * (0.3 + r() * 0.6);
          circ(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, 0.08 + r() * 0.1);
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fill();
        }
      break;
    }
    case "palm": {
      const R = 2.1;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + r() * 0.3;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(R * 0.5, -0.5, R, 0.15);
        ctx.quadraticCurveTo(R * 0.5, 0.45, 0, 0);
        ctx.fillStyle = i % 2 ? "#3e8a3a" : "#4fa043";
        ctx.fill();
        ctx.strokeStyle = "#2c6a2a";
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(R * 0.5, -0.05, R, 0.15);
        ctx.stroke();
        ctx.restore();
      }
      for (let i = 0; i < 3; i++) {
        circ(ctx, x + (r() - 0.5) * 0.4, y + (r() - 0.5) * 0.4, 0.16);
        ctx.fillStyle = "#6a4422";
        ctx.fill();
      }
      break;
    }
    case "cactus": {
      const body = "#4f8f48";
      const arms = [r() * Math.PI * 2, r() * Math.PI * 2];
      for (const a of arms) {
        circ(ctx, x + Math.cos(a) * p.r * 1.3, y + Math.sin(a) * p.r * 1.3, p.r * 0.55);
        ctx.fillStyle = "#467f40";
        ctx.fill();
      }
      circ(ctx, x, y, p.r);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = "#356a32";
      ctx.lineWidth = 0.04;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * p.r, y + Math.sin(a) * p.r);
        ctx.stroke();
      }
      circ(ctx, x, y, p.r * 0.25);
      ctx.fillStyle = r() < 0.4 ? "#f27aa0" : "#6aa860";
      ctx.fill();
      break;
    }
    case "rock":
      rockShape(ctx, p.at, p.r, p.seed ?? 1, theme === "volcano" ? "#4a444c" : theme === "desert" ? "#c09a76" : "#a6a39a", theme === "volcano" ? "#25212a" : theme === "desert" ? "#8a6648" : "#706d66");
      break;
    case "asteroid":
      rockShape(ctx, p.at, p.r, p.seed ?? 1, "#6a6270", "#3a3440");
      break;
    case "flowers":
      for (let i = 0; i < 7; i++) {
        circ(ctx, x + (r() - 0.5) * p.r * 2, y + (r() - 0.5) * p.r * 2, 0.09);
        ctx.fillStyle = ["#ffffff", "#ffd84a", "#ff7aa8", "#b48aff", "#ff8a4a"][Math.floor(r() * 5)];
        ctx.fill();
      }
      break;
    case "tuft":
      ctx.strokeStyle = theme === "desert" ? "#a49a52" : tone(pal.off, -0.25);
      ctx.lineWidth = 0.05;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (r() - 0.5) * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * p.r, y + Math.sin(a) * p.r);
        ctx.stroke();
      }
      break;
    case "skull":
      circ(ctx, x, y, p.r * 0.6);
      ctx.fillStyle = "#f2ead8";
      ctx.fill();
      ctx.fillStyle = "#6a5a48";
      circ(ctx, x - p.r * 0.2, y, p.r * 0.14);
      ctx.fill();
      circ(ctx, x + p.r * 0.2, y, p.r * 0.14);
      ctx.fill();
      break;
    case "snowman":
      circ(ctx, x, y + p.r * 0.2, p.r);
      ctx.fillStyle = "#f6f9fb";
      ctx.fill();
      circ(ctx, x, y - p.r * 0.4, p.r * 0.62);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      circ(ctx, x, y - p.r * 0.5, p.r * 0.12);
      ctx.fillStyle = "#ff8a2a";
      ctx.fill();
      break;
    case "lamp":
      circ(ctx, x, y, 0.22);
      ctx.fillStyle = "#2a2a2e";
      ctx.fill();
      circ(ctx, x, y, 0.13);
      ctx.fillStyle = "#fff2c8";
      ctx.fill();
      break;
    case "lantern":
      ctx.fillStyle = "#8d8a80";
      ctx.fillRect(x - 0.32, y - 0.32, 0.64, 0.64);
      ctx.fillStyle = "#6a675e";
      ctx.fillRect(x - 0.22, y - 0.22, 0.44, 0.44);
      ctx.fillStyle = "#ffe0a0";
      ctx.fillRect(x - 0.1, y - 0.1, 0.2, 0.2);
      break;
    case "beacon":
      circ(ctx, x, y, 0.24);
      ctx.fillStyle = "#4a5260";
      ctx.fill();
      circ(ctx, x, y, 0.12);
      ctx.fillStyle = "#9ad8ff";
      ctx.fill();
      break;
    case "crystal":
      // Hexagonal prisms seen from above: a pale top face ringed by darker sides.
      for (let i = 0; i < 4; i++) {
        const a = r() * Math.PI * 2, d = i ? p.r * 0.7 : 0, R = p.r * (i ? 0.38 : 0.55);
        const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
        const hex = Array.from({ length: 6 }, (_, k) => ({ x: cx + Math.cos((k / 6) * Math.PI * 2 + a) * R, y: cy + Math.sin((k / 6) * Math.PI * 2 + a) * R }));
        path(ctx, hex);
        ctx.fillStyle = i % 2 ? "#6a3aa8" : "#8a46c8";
        ctx.fill();
        path(ctx, scalePoly(hex, 0.55));
        ctx.fillStyle = i % 2 ? "#c89aff" : "#e6b8ff";
        ctx.fill();
      }
      break;
    case "vent":
      circ(ctx, x, y, p.r);
      ctx.fillStyle = "#1e1a20";
      ctx.fill();
      circ(ctx, x, y, p.r * 0.45);
      ctx.fillStyle = "#ff6a2a";
      ctx.fill();
      break;
    case "fern":
      ctx.strokeStyle = "#3f7a3a";
      ctx.lineWidth = 0.06;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * p.r, y + Math.sin(a) * p.r);
        ctx.stroke();
      }
      break;
  }
}

// --- Light ---

// The shape something tall casts: its footprint dragged along the shadow.
function sweepPoly(ctx: Ctx, poly: Vec[], s: Vec) {
  path(ctx, poly);
  ctx.fill();
  path(ctx, shift(poly, s.x, s.y));
  ctx.fill();
  for (const [a, b] of edges(poly)) {
    path(ctx, [a, b, { x: b.x + s.x, y: b.y + s.y }, { x: a.x + s.x, y: a.y + s.y }]);
    ctx.fill();
  }
}
function sweepLine(ctx: Ctx, pts: Vec[], closed: boolean, w: number, s: Vec) {
  ctx.lineWidth = w;
  path(ctx, pts, closed);
  ctx.stroke();
  path(ctx, shift(pts, s.x, s.y), closed);
  ctx.stroke();
  for (const [a, b] of edges(pts, closed)) {
    path(ctx, [a, b, { x: b.x + s.x, y: b.y + s.y }, { x: a.x + s.x, y: a.y + s.y }]);
    ctx.fill();
  }
}

const sv = (l: Light, h: number): Vec => ({ x: l.shadow.x * l.len * h, y: l.shadow.y * l.len * h });

export function buildLight(c: Course, layers: Layers, l: Light) {
  const ppu = layers.ppu < 30 ? 6 : 10;
  const { el, ctx } = canvas(c, ppu);
  // Shadows a touch lighter than the bare sky: light bounces off the ground into them.
  const lit = css(l.lit), shade = css(mixRGB(l.shade, l.lit, 0.22));
  const M = marginOf(c);
  ctx.fillStyle = lit;
  ctx.fillRect(-M, -M, c.w + M * 2, c.h + M * 2);
  ctx.fillStyle = shade;
  ctx.strokeStyle = shade;
  const walls: Wall[] = [...c.greens.filter((g) => g.rim !== false).map((g) => ({ pts: g.poly, w: 0.4, h: 0.6, style: "rim" as const, closed: true })), ...c.walls];
  for (const w of walls) sweepLine(ctx, w.pts, !!w.closed, w.w, sv(l, w.h));
  for (const b of c.blocks) sweepPoly(ctx, b.poly, sv(l, b.h));
  for (const b of c.bumpers) {
    const s = sv(l, 0.7);
    circ(ctx, b.at.x + s.x, b.at.y + s.y, b.r);
    ctx.fill();
  }
  for (const p of c.props) propShadow(ctx, p, l);
  // Tops stay in the sun.
  ctx.fillStyle = lit;
  ctx.strokeStyle = lit;
  for (const w of walls) {
    ctx.lineWidth = w.w * 0.9;
    path(ctx, w.pts, !!w.closed);
    ctx.stroke();
  }
  for (const b of c.blocks) {
    path(ctx, b.poly);
    ctx.fill();
  }
  for (const p of c.props) {
    if (!p.h || p.kind === "lamp" || p.kind === "beacon") continue;
    const R = p.kind === "palm" ? 2.1 : p.r;
    circ(ctx, p.at.x, p.at.y, R);
    ctx.fill();
    // The far side of anything round is in its own shade.
    ctx.save();
    circ(ctx, p.at.x, p.at.y, R);
    ctx.clip();
    circ(ctx, p.at.x + l.shadow.x * R * 1.1, p.at.y + l.shadow.y * R * 1.1, R);
    ctx.fillStyle = css(mixRGB(l.lit, l.shade, 0.55));
    ctx.fill();
    ctx.restore();
  }
  // Light sources.
  ctx.globalCompositeOperation = "lighter";
  const pal = PAL[c.theme];
  const glow = (at: Vec, r: number, col: RGB, a: number) => {
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
    g.addColorStop(0, css(col, a));
    g.addColorStop(0.45, css(col, a * 0.4));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    circ(ctx, at.x, at.y, r);
    ctx.fill();
  };
  for (const at of c.lamps) glow(at, 6, pal.lamp, 0.85 * l.night);
  const hot = 0.25 + 0.6 * l.night;
  for (const z of c.zones) {
    const lava = z.kind === "lava" || (z.kind === "water" && c.theme === "volcano");
    if (lava || z.kind === "coolant") {
      const col: RGB = lava ? [255, 120, 40] : [60, 220, 255];
      path(ctx, z.poly);
      ctx.fillStyle = css(col, hot * 0.9);
      ctx.fill();
      for (const [a, b] of edges(z.poly)) glow({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 3.2, col, hot * 0.22);
    }
    if (z.kind === "boost") glow(centroid(z.poly), 3, c.theme === "arcade" ? [46, 242, 255] : [255, 176, 46], hot * 0.5);
  }
  for (const w of c.walls)
    if (w.style === "neon")
      for (const [a, b] of edges(w.pts, !!w.closed)) {
        const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5);
        for (let i = 0; i <= n; i++) glow({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, 2.4, [46, 242, 255], hot * 0.25);
      }
  if (c.theme === "arcade")
    for (const g of c.greens)
      for (const p of g.poly.filter((_, i) => i % 2 === 0)) glow(p, 2.6, [255, 62, 201], hot * 0.3);
  for (const b of c.bumpers) if (c.theme === "arcade") glow(b.at, 3, [46, 242, 255], hot * 0.45);
  for (const b of c.blocks) if (b.style === "rack") for (const p of b.poly) glow(p, 2.5, [80, 200, 255], hot * 0.35);
  for (const p of c.props) {
    if (p.kind === "crystal") glow(p.at, 2.2, [200, 110, 255], hot * 0.45);
    if (p.kind === "vent") glow(p.at, 1.8, [255, 110, 40], hot * 0.5);
  }
  for (const p of c.portals) for (const at of [p.a, p.b]) glow(at, 3, [140, 100, 255], hot * 0.6);
  for (const w of c.wells) glow(w.at, 3.5, [255, 160, 90], hot * 0.6);
  return el;
}

function propShadow(ctx: Ctx, p: Prop, l: Light) {
  if (!p.h) return;
  const top = sv(l, p.h);
  ctx.lineWidth = 0.16;
  switch (p.kind) {
    case "tree":
    case "cherry":
    case "maple":
    case "pine":
    case "palm": {
      // The canopy, dragged out a little: the trunk hides under it.
      const R = p.kind === "palm" ? 2.1 : p.r;
      const lo = sv(l, p.h * 0.45), hi = sv(l, p.h * 0.8);
      ctx.lineWidth = R * 1.8;
      ctx.beginPath();
      ctx.moveTo(p.at.x + lo.x, p.at.y + lo.y);
      ctx.lineTo(p.at.x + hi.x, p.at.y + hi.y);
      ctx.stroke();
      break;
    }
    case "lamp":
    case "beacon":
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(p.at.x, p.at.y);
      ctx.lineTo(p.at.x + top.x, p.at.y + top.y);
      ctx.stroke();
      circ(ctx, p.at.x + top.x, p.at.y + top.y, 0.22);
      ctx.fill();
      break;
    default: {
      // Short round things: a blob dragged out.
      ctx.lineWidth = p.r * 2;
      ctx.beginPath();
      ctx.moveTo(p.at.x, p.at.y);
      ctx.lineTo(p.at.x + top.x * 0.8, p.at.y + top.y * 0.8);
      ctx.stroke();
    }
  }
}

export function buildGlow(c: Course, layers: Layers) {
  const ppu = Math.max(8, Math.round(layers.ppu / 2));
  const a = canvas(c, ppu);
  const lamps = canvas(c, ppu);
  const bloom = (ctx: Ctx, at: Vec, r: number, col: RGB, alpha = 1) => {
    const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
    g.addColorStop(0, css(col, alpha));
    g.addColorStop(0.25, css(col, alpha * 0.45));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    circ(ctx, at.x, at.y, r);
    ctx.fill();
  };
  const pal = PAL[c.theme];
  for (const at of c.lamps) {
    bloom(lamps.ctx, at, 1.6, pal.lamp, 0.9);
    bloom(lamps.ctx, at, 0.4, [255, 255, 240], 1);
  }
  const g = a.ctx;
  for (const z of c.zones) {
    const lava = z.kind === "lava" || (z.kind === "water" && c.theme === "volcano");
    if (lava || z.kind === "coolant") {
      path(g, z.poly);
      g.fillStyle = lava ? "rgba(255,110,30,0.45)" : "rgba(40,200,255,0.35)";
      g.fill();
    }
  }
  for (const w of c.walls) {
    if (w.style !== "neon" && w.style !== "obsidian") continue;
    const col = w.style === "neon" ? "rgba(46,242,255," : "rgba(255,110,40,";
    for (const [lw, al] of [[0.9, 0.18], [0.45, 0.35], [0.14, 0.9]] as const) {
      g.strokeStyle = col + al + ")";
      g.lineWidth = lw;
      path(g, w.pts, !!w.closed);
      g.stroke();
    }
  }
  if (c.theme === "arcade")
    for (const gr of c.greens)
      for (const [lw, al] of [[1, 0.15], [0.5, 0.3], [0.14, 0.9]] as const) {
        g.strokeStyle = `rgba(255,62,201,${al})`;
        g.lineWidth = lw;
        path(g, gr.poly);
        g.stroke();
      }
  for (const b of c.bumpers) if (c.theme === "arcade") bloom(g, b.at, b.r * 2, [46, 242, 255], 0.5);
  // Server LEDs.
  for (const b of c.blocks) {
    if (b.style === "pillar") {
      g.strokeStyle = "rgba(255,110,40,0.6)";
      g.lineWidth = 0.1;
      path(g, scalePoly(b.poly, 0.4));
      g.stroke();
    }
    if (b.style !== "rack") continue;
    const bb = bbox(b.poly);
    const r = rng(Math.round(bb.x0 * 100 + bb.y0));
    const long = bb.x1 - bb.x0 > bb.y1 - bb.y0;
    for (let t = 0.3; t < (long ? bb.x1 - bb.x0 : bb.y1 - bb.y0); t += 0.3) {
      const col: RGB = r() < 0.75 ? [60, 255, 140] : r() < 0.5 ? [80, 180, 255] : [255, 170, 40];
      const p = long ? { x: bb.x0 + t, y: bb.y1 - 0.35 } : { x: bb.x1 - 0.35, y: bb.y0 + t };
      bloom(g, p, 0.22, col, 1);
    }
  }
  for (const p of c.props) {
    if (p.kind === "crystal") bloom(g, p.at, 1, [210, 120, 255], 0.5);
    if (p.kind === "vent") bloom(g, p.at, 0.7, [255, 120, 40], 0.7);
  }
  for (const ch of c.zones) if (ch.kind === "boost") (path(g, ch.poly), (g.fillStyle = c.theme === "arcade" ? "rgba(46,242,255,0.2)" : "rgba(255,176,46,0.2)"), g.fill());
  return { glowA: a.el, glowL: lamps.el };
}

// --- Frames ---

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx = { kind: "ring" | "splash" | "puff" | "spark" | "confetti"; x: number; y: number; t: number; color?: string; seed: number };

type WaterInfo = { poly: Vec[]; holes: Vec[][]; sparkles: { x: number; y: number; ph: number }[] };
const waterCache = new WeakMap<Course, WaterInfo[]>();
function waters(c: Course): WaterInfo[] {
  let w = waterCache.get(c);
  if (w) return w;
  w = [];
  c.zones.forEach((z, i) => {
    if (z.kind !== "water" && z.kind !== "coolant") return;
    if (c.theme === "volcano") return;
    const holes = c.zones.slice(i + 1).filter((o) => o.kind === "bridge" || o.kind === "stone").map((o) => o.poly);
    const bb = bbox(z.poly);
    const r = rng(i * 99 + 1);
    const sparkles = [];
    for (let k = 0; k < (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * 0.5; k++) {
      const p = { x: bb.x0 + r() * (bb.x1 - bb.x0), y: bb.y0 + r() * (bb.y1 - bb.y0) };
      if (inPoly(p, z.poly)) sparkles.push({ ...p, ph: r() * 10 });
    }
    w!.push({ poly: z.poly, holes, sparkles });
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
  trail: Vec[];
  fx: Fx[];
  lightCanvas: HTMLCanvasElement;
  aim: { angle: number; power: number; line: Vec[] } | null;
};

export function drawFrame(ctx: Ctx, f: Frame) {
  const { c, sim, layers, light, cam, dpr, t } = f;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const pal = PAL[c.theme];
  const T = (g: Ctx, k = 1) => g.setTransform(cam.s * dpr * k, 0, 0, cam.s * dpr * k, (cam.ox - cam.x * cam.s) * dpr * k, (cam.oy - cam.y * cam.s) * dpr * k);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.beyond;
  ctx.fillRect(0, 0, W, H);
  T(ctx);
  ctx.imageSmoothingQuality = "high";
  const M = marginOf(c);
  ctx.drawImage(layers.base, -M, -M, c.w + M * 2, c.h + M * 2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Moving water: glints and, in the koi garden, fish.
  for (const w of waters(c)) {
    ctx.save();
    ctx.beginPath();
    for (const poly of [w.poly, ...w.holes]) {
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.clip("evenodd");
    if (c.theme === "zen") koi(ctx, w.poly, t);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.07;
    const sunny = 0.35 + 0.65 * (1 - light.night);
    for (const s of w.sparkles) {
      const a = Math.max(0, Math.sin(t * 1.6 + s.ph)) ** 6 * 0.8 * sunny;
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(s.x - 0.25, s.y);
      ctx.lineTo(s.x + 0.25, s.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // Belts and boost pads move.
  for (const z of c.zones) {
    if (z.kind !== "conveyor" && z.kind !== "boost") continue;
    ctx.save();
    path(ctx, z.poly);
    ctx.clip();
    const bb = bbox(z.poly);
    if (z.kind === "conveyor") {
      const off = (t * z.speed) % 0.8;
      ctx.strokeStyle = "rgba(255,255,255,0.13)";
      ctx.lineWidth = 0.18;
      const along = z.dir.x !== 0;
      for (let k = -1; k < (along ? bb.x1 - bb.x0 : bb.y1 - bb.y0) / 0.8 + 1; k++) {
        const d = k * 0.8 + off * (along ? z.dir.x : z.dir.y);
        ctx.beginPath();
        if (along) (ctx.moveTo(bb.x0 + d, bb.y0), ctx.lineTo(bb.x0 + d, bb.y1));
        else (ctx.moveTo(bb.x0, bb.y0 + d), ctx.lineTo(bb.x1, bb.y0 + d));
        ctx.stroke();
      }
    } else {
      const k = (t * 1.5) % 1;
      const m = centroid(z.poly);
      const half = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
      const p = { x: m.x + z.dir.x * half * (k * 2 - 1), y: m.y + z.dir.y * half * (k * 2 - 1) };
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 1.4);
      g.addColorStop(0, c.theme === "arcade" ? "rgba(46,242,255,0.5)" : "rgba(255,200,80,0.5)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    }
    ctx.restore();
  }
  // Portals swirl.
  for (let i = 0; i < c.portals.length * 2; i++) {
    const p = portalPoint(c, i);
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = `rgba(${170 - k * 30},${120 + k * 40},255,${0.8 - k * 0.2})`;
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      const a0 = t * (2 + k) * (i % 2 ? -1 : 1) + k * 2;
      ctx.arc(p.x, p.y, 0.25 + k * 0.18, a0, a0 + Math.PI * 1.3);
      ctx.stroke();
    }
  }

  // The cup.
  const cupR = CUP_R * sim.cupScale;
  circ(ctx, c.cup.x, c.cup.y, cupR + 0.08);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
  const cg = ctx.createRadialGradient(c.cup.x + light.shadow.x * cupR * 0.3, c.cup.y + light.shadow.y * cupR * 0.3, 0, c.cup.x, c.cup.y, cupR);
  cg.addColorStop(0, "#1c211d");
  cg.addColorStop(0.7, "#0e110f");
  cg.addColorStop(1, "#050605");
  circ(ctx, c.cup.x, c.cup.y, cupR);
  ctx.fillStyle = cg;
  ctx.fill();

  // Mystery boxes, floating.
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const bob = Math.sin(t * 2.2 + i) * 0.08;
    ctx.save();
    ctx.translate(b.x, b.y - 0.35 + bob);
    ctx.rotate(Math.sin(t * 0.9 + i) * 0.25);
    const g = ctx.createLinearGradient(-0.45, -0.45, 0.45, 0.45);
    g.addColorStop(0, "#ffd84a");
    g.addColorStop(0.5, "#ff7ab8");
    g.addColorStop(1, "#7a7aff");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-0.45, -0.45, 0.9, 0.9, 0.18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 0.07;
    ctx.stroke();
    ctx.restore();
  });

  // Splashes and puffs under the ball.
  drawFx(ctx, f.fx, t, pal);

  // The ball.
  const out = sim.mode === "out" ? Math.min(1, sim.modeT / 0.6) : 0;
  const sinking = sim.mode === "sunk" ? Math.min(1, sim.modeT / 0.3) : 0;
  if (f.trail.length > 1 && sim.mode === "roll") {
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = BALL_R * 1.4;
    path(ctx, f.trail, false);
    ctx.stroke();
  }
  if (sinking < 1 && out < 1) {
    const bx = sinking ? sim.x + (c.cup.x - sim.x) * sinking : sim.x;
    const by = sinking ? sim.y + (c.cup.y - sim.y) * sinking : sim.y;
    const R = BALL_R * (1 + sim.z * 0.14) * (1 - sinking * 0.45) * (1 - out);
    const hl = { x: -light.shadow.x * R * 0.35, y: -light.shadow.y * R * 0.35 };
    const g = ctx.createRadialGradient(bx + hl.x, by + hl.y, R * 0.1, bx, by, R);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.7, "#eef0f2");
    g.addColorStop(1, "#b9bec4");
    circ(ctx, bx, by, R);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.035;
    ctx.stroke();
  }

  // Roofs and treetops, see-through while the ball is under one.
  const under = c.blocks.some((b) => b.roof && inPoly(sim, b.poly)) || c.props.some((p) => OVER.includes(p.kind) && Math.hypot(p.at.x - sim.x, p.at.y - sim.y) < (p.kind === "palm" ? 2.1 : p.r));
  ctx.globalAlpha = under ? 0.5 : 1;
  ctx.drawImage(layers.over, -M, -M, c.w + M * 2, c.h + M * 2);
  ctx.globalAlpha = 1;

  // Movers.
  for (const m of c.movers) {
    const pose = poseOf(m, sim.t);
    if (m.kind === "windmill" && pose.kind === "windmill") {
      const step = (Math.PI * 2) / m.arms;
      const hub = { x: m.hub.x, y: m.hub.y - m.height * OBL };
      for (let k = 0; k < m.arms; k++) {
        const a = pose.angle + k * step;
        // A sail: a lattice frame on one side of the spar, drawn in the wheel's own plane.
        const at = (r: number, side: number) => {
          const p = blade(m.hub, m.height, a, r);
          const q = blade(m.hub, m.height, a + Math.PI / 2, side);
          return { x: p.x + (q.x - m.hub.x), y: p.y + (q.y - (m.hub.y - m.height * OBL)) };
        };
        const sail = [at(m.L * 0.22, 0), at(m.L, 0), at(m.L, 0.62), at(m.L * 0.22, 0.62)];
        path(ctx, sail);
        ctx.fillStyle = "rgba(240,230,208,0.9)";
        ctx.fill();
        ctx.strokeStyle = "#7a5634";
        ctx.lineWidth = 0.05;
        for (let j = 1; j < 5; j++) {
          const u = 0.22 + (0.78 * j) / 5;
          const p0 = at(m.L * u, 0), p1 = at(m.L * u, 0.62);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        path(ctx, sail);
        ctx.stroke();
        const tip = blade(m.hub, m.height, a, m.L);
        ctx.strokeStyle = "#5a3c22";
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
      circ(ctx, m.hub.x, m.hub.y - m.height * OBL, 0.28);
      ctx.fillStyle = "#4a3220";
      ctx.fill();
    } else if (m.kind === "spinner" && pose.kind === "spinner") {
      for (let k = 0; k < m.arms; k++) {
        const a = pose.angle + (k * Math.PI * 2) / m.arms;
        ctx.strokeStyle = "#2a2d33";
        ctx.lineWidth = m.w;
        ctx.beginPath();
        ctx.moveTo(m.at.x, m.at.y);
        ctx.lineTo(m.at.x + Math.cos(a) * m.L, m.at.y + Math.sin(a) * m.L);
        ctx.stroke();
        ctx.strokeStyle = "#ffb02e";
        ctx.setLineDash([0.3, 0.3]);
        ctx.lineWidth = m.w * 0.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      circ(ctx, m.at.x, m.at.y, 0.45);
      ctx.fillStyle = "#5a5f68";
      ctx.fill();
    } else if (m.kind === "slider" && pose.kind === "slider") {
      const rect = sliderRect(pose.at, m.size);
      path(ctx, rect);
      ctx.fillStyle = "#86c2de";
      ctx.fill();
      path(ctx, scalePoly(rect, 0.8).map((p) => ({ x: p.x - 0.06, y: p.y - 0.06 })));
      ctx.fillStyle = "#d4eef9";
      ctx.fill();
    }
  }

  // The flag, pulled out as the ball gets close.
  const dCup = Math.hypot(sim.x - c.cup.x, sim.y - c.cup.y);
  const flagA = sim.mode === "sunk" ? 0 : Math.max(0, Math.min(1, (dCup - 1.4) / 1.6));
  if (flagA > 0) {
    ctx.globalAlpha = flagA;
    const top = { x: c.cup.x, y: c.cup.y - FLAG_H * OBL * 2.2 };
    ctx.strokeStyle = "#f4f4f4";
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(c.cup.x, c.cup.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      ctx.lineTo(top.x + u * 1.3, top.y + Math.sin(t * 5 - u * 4) * 0.1 * u + u * 0.1);
    }
    for (let k = 8; k >= 0; k--) {
      const u = k / 8;
      ctx.lineTo(top.x + u * 1.3, top.y + 0.75 - u * 0.55 + Math.sin(t * 5 - u * 4) * 0.1 * u);
    }
    ctx.closePath();
    ctx.fillStyle = pal.flag;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Light: the static layer, plus shadows of everything that moves.
  const L = f.lightCanvas;
  const lw = Math.ceil(W / 2), lh = Math.ceil(H / 2);
  if (L.width !== lw || L.height !== lh) {
    L.width = lw;
    L.height = lh;
  }
  const lc = L.getContext("2d")!;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.fillStyle = css(light.lit);
  lc.fillRect(0, 0, lw, lh);
  T(lc, 0.5);
  if (layers.light) lc.drawImage(layers.light, -M, -M, c.w + M * 2, c.h + M * 2);
  const shadeC = css(mixRGB(light.shade, light.lit, 0.22), 0.92);
  lc.fillStyle = shadeC;
  lc.strokeStyle = shadeC;
  lc.lineCap = "round";
  if (sinking < 1 && out < 1) {
    const s = sv(light, sim.z + 0.25);
    circ(lc, sim.x + s.x, sim.y + s.y, BALL_R * (1 - out));
    lc.fill();
  }
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const s = sv(light, 0.7);
    circ(lc, b.x + s.x, b.y + s.y, 0.42);
    lc.fill();
  });
  if (flagA > 0.3) {
    const s = sv(light, FLAG_H);
    lc.lineWidth = 0.1;
    lc.beginPath();
    lc.moveTo(c.cup.x, c.cup.y);
    lc.lineTo(c.cup.x + s.x, c.cup.y + s.y);
    lc.stroke();
    const f1 = sv(light, FLAG_H - 0.7);
    lc.beginPath();
    lc.moveTo(c.cup.x + s.x, c.cup.y + s.y);
    lc.lineTo(c.cup.x + f1.x + 1.1, c.cup.y + f1.y);
    lc.lineTo(c.cup.x + f1.x, c.cup.y + f1.y);
    lc.closePath();
    lc.fill();
  }
  for (const m of c.movers) {
    const pose = poseOf(m, sim.t);
    if (m.kind === "windmill" && pose.kind === "windmill") {
      lc.lineWidth = 0.4;
      for (let k = 0; k < m.arms; k++) {
        const a = pose.angle + (k * Math.PI * 2) / m.arms;
        const hub = sv(light, m.height), tipH = m.height + Math.cos(a) * m.L;
        const tip = sv(light, Math.max(0, tipH));
        lc.beginPath();
        lc.moveTo(m.hub.x + hub.x, m.hub.y + hub.y);
        lc.lineTo(m.hub.x + Math.sin(a) * m.L + tip.x, m.hub.y + tip.y);
        lc.stroke();
      }
    } else if (m.kind === "spinner" && pose.kind === "spinner") {
      const s = sv(light, 0.9);
      lc.lineWidth = m.w;
      for (let k = 0; k < m.arms; k++) {
        const a = pose.angle + (k * Math.PI * 2) / m.arms;
        lc.beginPath();
        lc.moveTo(m.at.x + s.x, m.at.y + s.y);
        lc.lineTo(m.at.x + Math.cos(a) * m.L + s.x, m.at.y + Math.sin(a) * m.L + s.y);
        lc.stroke();
      }
    } else if (m.kind === "slider" && pose.kind === "slider") {
      sweepPoly(lc, sliderRect(pose.at, m.size), sv(light, 1));
      lc.fillStyle = css(light.lit);
      path(lc, sliderRect(pose.at, m.size));
      lc.fill();
      lc.fillStyle = shadeC;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(L, 0, 0, W, H);

  // Glow.
  ctx.globalCompositeOperation = "lighter";
  T(ctx);
  const pulse = 0.9 + Math.sin(t * 1.3) * 0.1;
  if (layers.glowA) {
    ctx.globalAlpha = (0.35 + 0.65 * light.night) * pulse;
    ctx.drawImage(layers.glowA, -M, -M, c.w + M * 2, c.h + M * 2);
  }
  if (layers.glowL && light.night > 0.02) {
    ctx.globalAlpha = light.night;
    ctx.drawImage(layers.glowL, -M, -M, c.w + M * 2, c.h + M * 2);
  }
  ctx.globalAlpha = 1;
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const g = ctx.createRadialGradient(b.x, b.y - 0.35, 0, b.x, b.y - 0.35, 1.3);
    g.addColorStop(0, `rgba(255,200,240,${0.25 + 0.35 * light.night})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    circ(ctx, b.x, b.y - 0.35, 1.3);
    ctx.fill();
  });
  ctx.globalCompositeOperation = "source-over";
  // After dark the ball keeps a little of its own light, so it never gets lost.
  if (light.night > 0.05 && sinking < 1 && out < 1) {
    const R = BALL_R * (1 + sim.z * 0.14) * (1 - sinking * 0.45) * (1 - out);
    ctx.globalAlpha = light.night * 0.6;
    circ(ctx, sim.x, sim.y, R);
    ctx.fillStyle = "#f4f6ff";
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(sim.x, sim.y, R, sim.x, sim.y, R * 3);
    g.addColorStop(0, "rgba(220,230,255,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    circ(ctx, sim.x, sim.y, R * 3);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // Question marks on the boxes, crisp in screen space.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const bob = Math.sin(t * 2.2 + i) * 0.08;
    const sx = (b.x - cam.x) * cam.s + cam.ox, sy = (b.y - 0.35 + bob - cam.y) * cam.s + cam.oy;
    ctx.font = `800 ${Math.max(8, cam.s * 0.62)}px system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("?", sx, sy + cam.s * 0.03);
  });

  // The aim: a rubber band back to the finger and a dotted line out to the first bounce.
  if (f.aim && sim.mode === "aim") {
    const { power, line } = f.aim;
    const col = power < 0.5 ? mixRGB([120, 230, 120], [255, 210, 70], power * 2) : mixRGB([255, 210, 70], [255, 80, 70], (power - 0.5) * 2);
    T(ctx);
    ctx.strokeStyle = css(col, 0.95);
    ctx.fillStyle = css(col, 0.95);
    ctx.lineWidth = 0.13;
    ctx.setLineDash([0.08, 0.32]);
    ctx.lineDashOffset = -t * 1.5;
    path(ctx, line, false);
    ctx.stroke();
    ctx.setLineDash([]);
    // Power ring round the ball.
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.arc(sim.x, sim.y, BALL_R + 0.3, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(sim.x, sim.y, BALL_R + 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const OBL = 0.35; // how far up the screen height is drawn, for things drawn standing up
const FLAG_H = 2.4;
function blade(hub: Vec, height: number, a: number, L: number): Vec {
  return { x: hub.x + Math.sin(a) * L, y: hub.y - (height + Math.cos(a) * L) * OBL };
}

function koi(ctx: Ctx, poly: Vec[], t: number) {
  const m = centroid(poly);
  const bb = bbox(poly);
  const rx = (bb.x1 - bb.x0) / 2, ry = (bb.y1 - bb.y0) / 2;
  const fish = [
    [0.62, 0.55, 0.23, 0, "#ff7a2a"],
    [0.4, 0.45, -0.31, 2, "#ffffff"],
    [0.75, 0.7, 0.17, 4, "#ffb02e"],
    [0.55, 0.3, -0.2, 1, "#ff5a3a"],
    [0.3, 0.6, 0.27, 3, "#f2f2f2"],
  ] as const;
  for (const [kx, ky, w, ph, col] of fish) {
    const a = t * w + ph;
    const x = m.x + Math.cos(a) * rx * kx, y = m.y + Math.sin(a) * ry * ky;
    const head = Math.atan2(Math.cos(a) * ry * ky * w, -Math.sin(a) * rx * kx * w);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(head);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.42, 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    const wag = Math.sin(t * 6 + ph) * 0.12;
    ctx.beginPath();
    ctx.moveTo(-0.35, 0);
    ctx.lineTo(-0.62, -0.14 + wag);
    ctx.lineTo(-0.62, 0.14 + wag);
    ctx.closePath();
    ctx.fill();
    if (col === "#ffffff" || col === "#f2f2f2") {
      ctx.fillStyle = "#ff6a2a";
      ctx.beginPath();
      ctx.ellipse(0.12, 0, 0.13, 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFx(ctx: Ctx, fx: Fx[], t: number, pal: Pal) {
  for (const e of fx) {
    const age = t - e.t;
    const r = rng(e.seed);
    if (e.kind === "ring" || e.kind === "splash") {
      const life = e.kind === "splash" ? 1.1 : 0.5;
      if (age > life) continue;
      const k = age / life;
      for (let i = 0; i < (e.kind === "splash" ? 3 : 1); i++) {
        const kk = Math.max(0, k - i * 0.15);
        ctx.strokeStyle = e.color ?? "rgba(255,255,255,1)";
        ctx.globalAlpha = (1 - kk) * 0.8;
        ctx.lineWidth = 0.08;
        circ(ctx, e.x, e.y, 0.3 + kk * (e.kind === "splash" ? 1.6 : 1.1));
        ctx.stroke();
      }
      if (e.kind === "splash")
        for (let i = 0; i < 10; i++) {
          const a = r() * Math.PI * 2, sp = 1 + r() * 2;
          circ(ctx, e.x + Math.cos(a) * sp * k, e.y + Math.sin(a) * sp * k - Math.sin(k * Math.PI) * 0.8, 0.07);
          ctx.fillStyle = e.color ?? pal.water[0];
          ctx.fill();
        }
    } else if (e.kind === "puff") {
      if (age > 0.6) continue;
      const k = age / 0.6;
      for (let i = 0; i < 7; i++) {
        const a = r() * Math.PI * 2, sp = 0.4 + r() * 0.7;
        ctx.globalAlpha = (1 - k) * 0.6;
        circ(ctx, e.x + Math.cos(a) * sp * k, e.y + Math.sin(a) * sp * k, 0.12 + k * 0.2);
        ctx.fillStyle = e.color ?? "#e8d8a8";
        ctx.fill();
      }
    } else if (e.kind === "spark" || e.kind === "confetti") {
      const life = e.kind === "confetti" ? 1.8 : 0.7;
      if (age > life) continue;
      const k = age / life;
      const n = e.kind === "confetti" ? 36 : 14;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, sp = (e.kind === "confetti" ? 2 : 1.2) + r() * 2.5;
        const ease = 1 - (1 - k) ** 3;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = e.kind === "confetti" ? ["#ff5a5a", "#ffd84a", "#4ae07a", "#4ab8ff", "#c07aff"][i % 5] : (e.color ?? "#ffe9a8");
        const x = e.x + Math.cos(a) * sp * ease, y = e.y + Math.sin(a) * sp * ease + k * k * 1.5;
        ctx.fillRect(x - 0.08, y - 0.08, 0.16, e.kind === "confetti" ? 0.1 : 0.16);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// A whole hole in one picture, for the course list.
export function still(c: Course, width: number, light: Light): HTMLCanvasElement {
  const ppu = width / c.w;
  const layers = buildLayers(c, Math.max(6, ppu * 1.5));
  layers.light = buildLight(c, layers, light);
  Object.assign(layers, buildGlow(c, layers));
  const el = document.createElement("canvas");
  el.width = Math.round(width);
  el.height = Math.round(c.h * ppu);
  const ctx = el.getContext("2d")!;
  const sim = { ...newStill(c) };
  drawFrame(ctx, {
    c,
    sim,
    layers,
    light,
    cam: { x: c.w / 2, y: c.h / 2, s: ppu, ox: el.width / 2, oy: el.height / 2 },
    dpr: 1,
    t: 0,
    trail: [],
    fx: [],
    lightCanvas: document.createElement("canvas"),
    aim: null,
  });
  return el;
}

function newStill(c: Course): Sim {
  return {
    t: 0.4, x: c.tee.x, y: c.tee.y, vx: 0, vy: 0, z: 0, vz: 0, mode: "aim", modeT: 0, rollT: 0, strokes: 0, rest: c.tee, cupScale: 1,
    armed: null, shot: null, bag: [], boxes: c.boxes.map(() => false), portalLock: -1, onRamp: false, ramp: null, lipT: 0, outGround: null,
    history: [], events: [], seed: 1,
  };
}
