import { BALL_R, CUP_R, LASER_R, newSim, poseOf, rng, sliderRect, type Course, type Mover, type Patch, type Sim, type Vec } from "./engine";
import type { Missile, Storm } from "../../../convex/golf/world";

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
  water: "#6aa3b1", // a lake, not a swimming pool
  waterLight: "#86b7c2",
  foam: "#dfe9e3",
  wood: "#b48a5a",
  woodLine: "#977145",
  portal: "#8c80b4",
  ice: "#dcebf0",
  iceLine: "#b9d5df",
  honey: "#d99a2b",
  honeyLight: "#efc56a",
  cloud: "#474d55",
  shield: "#8cc4e3",
  stun: "#f3d35b",
  steam: "#efe6d6",
} as const;
const C = PALETTE;
const v0: Vec = { x: 0, y: 0 };
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
// Text is drawn once, large, into its own little canvas, then scaled like any other shape. Drawing
// it straight at a changing size makes the glyphs snap between hinted sizes, so a "?" that breathes
// or a label that pops would wobble a pixel at a time.
const GLYPH_PX = 96;
const glyphs = new Map<string, { img: HTMLCanvasElement; w: number; h: number; cx: number; cy: number }>();
function glyph(text: string, fill: string, stroke?: string) {
  const key = `${text}|${fill}|${stroke ?? ""}`;
  let g = glyphs.get(key);
  if (g) return g;
  const img = document.createElement("canvas");
  const g2 = img.getContext("2d")!;
  const font = `800 ${GLYPH_PX}px system-ui, sans-serif`;
  g2.font = font;
  const m = g2.measureText(text);
  const pad = stroke ? GLYPH_PX * 0.16 : 2;
  const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight + pad * 2);
  const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + pad * 2);
  img.width = w;
  img.height = h;
  const ox = pad + m.actualBoundingBoxLeft, oy = pad + m.actualBoundingBoxAscent;
  g2.font = font;
  g2.textBaseline = "alphabetic";
  if (stroke) {
    g2.lineJoin = "round";
    g2.lineWidth = GLYPH_PX * 0.22;
    g2.strokeStyle = stroke;
    g2.strokeText(text, ox, oy);
  }
  g2.fillStyle = fill;
  g2.fillText(text, ox, oy);
  // Centred on the glyphs' own ink, not the font's idea of the middle (which sits low on a "?").
  g = { img, w, h, cx: w / 2, cy: h / 2 };
  glyphs.set(key, g);
  return g;
}

// Text in world units: `size` is the height of a capital, roughly, at scale 1.
function worldText(ctx: Ctx, text: string, x: number, y: number, size: number, fill: string, stroke?: string, scale = 1) {
  if (typeof document === "undefined" || scale <= 0) return;
  const g = glyph(text, fill, stroke);
  const k = (size * scale) / GLYPH_PX;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(g.img, x - g.cx * k, y - g.cy * k, g.w * k, g.h * k);
  ctx.restore();
}

// A quick overshoot, for things popping in: 0 to 1, a little past 1, settling at 1.
export const popIn = (k: number) => (k >= 1 ? 1 : k <= 0 ? 0 : 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2);
const ease = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;

// --- The parts ---

export function drawBoard(ctx: Ctx, boards: Vec[][], cup: Vec | Vec[] | null, view: { x0: number; y0: number; x1: number; y1: number }) {
  const cups = cup === null ? [] : Array.isArray(cup) ? cup : [cup];
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
    for (const k of cups) {
      circ(ctx, k.x, k.y, 3.2);
      ctx.fillStyle = C.putting;
      ctx.fill();
    }
    ctx.restore();
  }
}

// Water: flat, with little wavelets drifting across it. `edge` draws surf round its rim.
export function drawWater(ctx: Ctx, poly: Vec[], t: number, view: { x0: number; y0: number; x1: number; y1: number }, edge = true) {
  path(ctx, poly);
  ctx.fillStyle = C.water;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = C.waterLight;
  ctx.lineWidth = 0.16;
  ctx.lineCap = "round";
  const gap = 3.2;
  for (let gx = Math.floor(view.x0 / gap) - 1; gx * gap < view.x1 + gap; gx++)
    for (let gy = Math.floor(view.y0 / gap) - 1; gy * gap < view.y1 + gap; gy++) {
      const r = rng(gx * 7919 + gy * 104729);
      const px = gx * gap + r() * gap, py = gy * gap + r() * gap, ph = r() * 6.28;
      // Each wavelet drifts a little and breathes in and out.
      const k = 0.5 + 0.5 * Math.sin(t * 0.9 + ph);
      const x = px + Math.sin(t * 0.35 + ph) * 0.5;
      ctx.globalAlpha = 0.35 + 0.45 * k;
      ctx.beginPath();
      ctx.arc(x, py + 0.5, 0.55 + 0.15 * k, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
    }
  ctx.restore();
  if (edge) {
    path(ctx, poly);
    ctx.strokeStyle = C.foam;
    ctx.lineWidth = 0.22;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Surf along a coast with no rail: a soft line of foam just off the grass, lapping in and out.
export function drawShore(ctx: Ctx, poly: Vec[], t: number) {
  const base = ctx.globalAlpha;
  path(ctx, poly);
  ctx.lineJoin = "round";
  ctx.strokeStyle = C.foam;
  ctx.globalAlpha = base * (0.35 + 0.15 * Math.sin(t * 1.2));
  ctx.lineWidth = 1.3 + 0.25 * Math.sin(t * 1.2);
  ctx.stroke();
  ctx.globalAlpha = base * 0.9;
  ctx.lineWidth = 0.45;
  ctx.stroke();
  ctx.globalAlpha = base;
}

// A wooden bridge: planks across the way you cross it.
export function drawBridge(ctx: Ctx, poly: Vec[]) {
  path(ctx, poly);
  ctx.fillStyle = C.wood;
  ctx.fill();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) (x0 = Math.min(x0, p.x)), (y0 = Math.min(y0, p.y)), (x1 = Math.max(x1, p.x)), (y1 = Math.max(y1, p.y));
  ctx.save();
  path(ctx, poly);
  ctx.clip();
  ctx.strokeStyle = C.woodLine;
  ctx.lineWidth = 0.08;
  const across = x1 - x0 > y1 - y0;
  ctx.beginPath();
  for (let k = across ? x0 : y0; k < (across ? x1 : y1); k += 0.7) {
    if (across) ctx.moveTo(k, y0), ctx.lineTo(k, y1);
    else ctx.moveTo(x0, k), ctx.lineTo(x1, k);
  }
  ctx.stroke();
  ctx.restore();
}

// Ice: a pale rink with skate scratches on it.
export function drawIce(ctx: Ctx, poly: Vec[], seed = 1) {
  path(ctx, poly);
  ctx.fillStyle = C.ice;
  ctx.fill();
  ctx.save();
  ctx.clip();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) (x0 = Math.min(x0, p.x)), (y0 = Math.min(y0, p.y)), (x1 = Math.max(x1, p.x)), (y1 = Math.max(y1, p.y));
  const r = rng(seed);
  ctx.strokeStyle = C.iceLine;
  ctx.lineWidth = 0.07;
  ctx.lineCap = "round";
  const n = Math.max(3, Math.round(((x1 - x0) * (y1 - y0)) / 9));
  for (let k = 0; k < n; k++) {
    const cx = x0 + r() * (x1 - x0), cy = y0 + r() * (y1 - y0), rad = 1 + r() * 2.5, a = r() * 6.28;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, a, a + 0.6 + r() * 0.8);
    ctx.stroke();
  }
  ctx.restore();
  path(ctx, poly);
  ctx.strokeStyle = C.iceLine;
  ctx.lineWidth = 0.18;
  ctx.stroke();
}

// Wind: faint streaks drifting the way it blows, gusting stronger and weaker.
export function drawWind(ctx: Ctx, poly: Vec[], dir: Vec, t: number) {
  const m = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
  const R = Math.max(...poly.map((p) => Math.hypot(p.x - m.x, p.y - m.y)));
  ctx.save();
  path(ctx, poly);
  ctx.clip();
  ctx.translate(m.x, m.y);
  ctx.rotate(Math.atan2(dir.y, dir.x));
  ctx.strokeStyle = C.ink;
  ctx.lineCap = "round";
  ctx.lineWidth = 0.09;
  const gust = 0.65 + 0.35 * Math.sin(t * 1.4 + dir.x * 3 + dir.y);
  const base = ctx.globalAlpha;
  const span = 6;
  for (let row = -R; row <= R; row += 1.7) {
    const r = rng(Math.round(row * 10) + 977);
    const off = r() * span, speed = 5 + r() * 3;
    for (let x = -R - span; x <= R; x += span) {
      const px = x + ((off + t * speed * gust) % span);
      const k = Math.max(0, 1 - Math.abs(px) / R);
      ctx.globalAlpha = base * 0.42 * k * gust;
      ctx.beginPath();
      ctx.moveTo(px, row + Math.sin(px * 0.6 + t) * 0.15);
      ctx.lineTo(px + 1.8, row + Math.sin((px + 1.8) * 0.6 + t) * 0.15);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = base;
  ctx.restore();
}

// A moving obstacle, where it is at time `t`: a spinning bar (painted like a rail) or a sliding crate.
export function drawMover(ctx: Ctx, m: Mover, t: number) {
  const pose = poseOf(m, t);
  if (pose.kind === "spinner" && m.kind === "spinner") {
    ctx.lineCap = "round";
    for (let k = 0; k < m.arms; k++) {
      const a = pose.angle + (k * Math.PI * 2) / m.arms;
      const tip = { x: m.at.x + Math.cos(a) * m.L, y: m.at.y + Math.sin(a) * m.L };
      drawRail(ctx, [m.at, tip], false, m.w);
    }
    circ(ctx, m.at.x, m.at.y, m.w * 0.9);
    ctx.fillStyle = C.wood;
    ctx.fill();
  } else if (pose.kind === "slider" && m.kind === "slider") {
    const r = sliderRect(pose.at, m.size);
    path(ctx, r);
    ctx.fillStyle = C.wood;
    ctx.fill();
    ctx.strokeStyle = C.woodLine;
    ctx.lineWidth = 0.14;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r[0].x, r[0].y);
    ctx.lineTo(r[2].x, r[2].y);
    ctx.moveTo(r[1].x, r[1].y);
    ctx.lineTo(r[3].x, r[3].y);
    ctx.stroke();
  }
}

// Ice a Freeze Bomb left, or a puddle of Honey, fading as it wears off.
export function drawPatch(ctx: Ctx, p: Patch, now: number) {
  const left = p.until - now;
  if (left <= 0) return;
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * Math.min(1, left / 2);
  if (p.kind === "ice") {
    const pts = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * Math.PI * 2;
      const w = 1 + Math.sin(a * 5 + p.x) * 0.06;
      return { x: p.x + Math.cos(a) * p.r * w, y: p.y + Math.sin(a) * p.r * w };
    });
    ctx.globalAlpha *= 0.92;
    drawIce(ctx, pts, Math.round(p.x * 7 + p.y));
  } else {
    const r = rng(Math.round(p.x * 13 + p.y * 7));
    ctx.fillStyle = C.honey;
    for (let k = 0; k < 4; k++) {
      const a = r() * 6.28, d = k === 0 ? 0 : p.r * 0.45;
      circ(ctx, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, p.r * (k === 0 ? 0.8 : 0.55));
      ctx.fill();
    }
    ctx.fillStyle = C.honeyLight;
    circ(ctx, p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.22);
    ctx.fill();
  }
  ctx.globalAlpha = base;
}

// A Rocket Launcher's missile, nose first, with a short smoke trail.
export function drawMissile(ctx: Ctx, m: { x: number; y: number; vx: number; vy: number }) {
  const a = Math.atan2(m.vy, m.vx);
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(a);
  const g = ctx.createLinearGradient(-3, 0, 0, 0);
  g.addColorStop(0, "rgba(239,230,214,0)");
  g.addColorStop(1, "rgba(239,230,214,0.6)");
  ctx.strokeStyle = g;
  ctx.lineWidth = 0.3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-3, 0);
  ctx.lineTo(-0.4, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-0.45, -0.17, 0.9, 0.34, 0.17);
  ctx.fillStyle = C.ball;
  ctx.fill();
  circ(ctx, 0.36, 0, 0.17);
  ctx.fillStyle = C.flag;
  ctx.fill();
  ctx.restore();
}

// A Thunderstorm's cloud over its patch, with rain, fading in and out.
export function drawStorm(ctx: Ctx, st: { x: number; y: number; r: number; until: number }, now: number, t: number) {
  const left = st.until - now;
  if (left <= 0) return;
  const base = ctx.globalAlpha;
  const k = Math.min(1, left / 0.8) * Math.min(1, (7 - left) / 0.5 + 0.2);
  ctx.globalAlpha = base * 0.3 * k;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 0.06;
  const r = rng(Math.round(st.x * 31 + st.y));
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * st.r, ph = r();
    const fall = ((t * 1.6 + ph) % 1) * 1.4;
    const x = st.x + Math.cos(a) * d, y = st.y + Math.sin(a) * d - 0.7 + fall;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.12, y + 0.5);
    ctx.stroke();
  }
  ctx.fillStyle = C.cloud;
  ctx.globalAlpha = base * 0.5 * k;
  const r2 = rng(Math.round(st.x * 7 + st.y * 3));
  for (let i = 0; i < 7; i++) {
    const a = r2() * 6.28, d = r2() * st.r * 0.6;
    circ(ctx, st.x + Math.cos(a) * d + Math.sin(t * 0.7 + i) * 0.2, st.y - 1 + Math.sin(a) * d, st.r * (0.35 + r2() * 0.2));
    ctx.fill();
  }
  ctx.globalAlpha = base;
}

// What's happening to a ball: frozen in an ice cube, stunned (stars round it), shielded (a bubble),
// on Coffee (steam), or rattled by an Air Horn (sound waves).
export function drawStatus(ctx: Ctx, b: Sim, at: Vec, t: number) {
  const now = b.t, r = b.r;
  if (now < b.frozenUntil) {
    ctx.beginPath();
    ctx.roundRect(at.x - r * 1.7, at.y - r * 1.7, r * 3.4, r * 3.4, r * 0.5);
    ctx.fillStyle = "rgba(214,236,244,0.55)";
    ctx.fill();
    ctx.strokeStyle = "#bfe3f0";
    ctx.lineWidth = 0.08;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(at.x - r * 1.1, at.y - r * 0.6);
    ctx.lineTo(at.x - r * 0.6, at.y - r * 1.1);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.stroke();
  }
  if (now < b.stunUntil) {
    ctx.fillStyle = C.stun;
    for (let k = 0; k < 3; k++) {
      const a = t * 5 + (k * Math.PI * 2) / 3;
      const x = at.x + Math.cos(a) * r * 1.9, y = at.y - r * 1.4 + Math.sin(a) * r * 0.7;
      ctx.beginPath();
      for (let j = 0; j < 8; j++) {
        const rr = j % 2 ? 0.07 : 0.17, aa = (j * Math.PI) / 4 + t * 3;
        ctx.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  if (now < b.shieldUntil) {
    const left = b.shieldUntil - now;
    // It flickers in its last moments.
    const on = left > 1.2 || Math.sin(t * 30) > 0;
    if (on) {
      const base = ctx.globalAlpha;
      ctx.globalAlpha = base * (0.55 + 0.2 * Math.sin(t * 5));
      circ(ctx, at.x, at.y, r * 2.1);
      ctx.fillStyle = "rgba(140,196,227,0.18)";
      ctx.fill();
      ctx.strokeStyle = C.shield;
      ctx.lineWidth = 0.1;
      ctx.stroke();
      ctx.globalAlpha = base;
    }
  }
  if (now < b.coffeeUntil) {
    const base = ctx.globalAlpha;
    ctx.strokeStyle = C.steam;
    ctx.lineWidth = 0.07;
    ctx.lineCap = "round";
    for (let k = 0; k < 2; k++) {
      const ph = (t * 0.9 + k * 0.5) % 1;
      ctx.globalAlpha = base * 0.7 * Math.sin(ph * Math.PI);
      const x = at.x + (k ? 0.18 : -0.18), y = at.y - r - 0.15 - ph * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y + 0.4);
      ctx.quadraticCurveTo(x + 0.2, y + 0.2, x, y);
      ctx.quadraticCurveTo(x - 0.2, y - 0.2, x, y - 0.35);
      ctx.stroke();
    }
    ctx.globalAlpha = base;
  }
  if (b.rattled) {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.07;
    ctx.lineCap = "round";
    const w = Math.sin(t * 14) * 0.05;
    for (const side of [-1, 1])
      for (let k = 1; k <= 2; k++) {
        ctx.beginPath();
        ctx.arc(at.x + side * w, at.y, r + 0.18 * k, side > 0 ? -0.6 : Math.PI - 0.6, side > 0 ? 0.6 : Math.PI + 0.6);
        ctx.stroke();
      }
  }
}

// A portal: a ring with a slow swirl inside it.
export function drawPortal(ctx: Ctx, at: Vec, t: number) {
  circ(ctx, at.x, at.y, 0.95);
  ctx.fillStyle = "rgba(20,16,40,0.35)";
  ctx.fill();
  ctx.strokeStyle = C.portal;
  ctx.lineWidth = 0.22;
  circ(ctx, at.x, at.y, 0.95);
  ctx.stroke();
  ctx.lineWidth = 0.12;
  ctx.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    const a = t * 2.2 + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 0.55, a, a + 1.4);
    ctx.stroke();
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
  // A rubbery wobble: out fast, a little under, settling to nothing by the end.
  const swell = pop < 1 ? (1 - pop) ** 2 * Math.sin(Math.min(1, pop) * Math.PI * 3) : 0;
  const R = r * (1 + swell * 0.24);
  circ(ctx, at.x, at.y, R);
  ctx.fillStyle = C.bumper;
  ctx.fill();
  // A flash that rises and falls with the swell.
  const flash = pop < 1 ? Math.max(0, 1 - pop * 3) ** 2 : 0;
  if (flash > 0) {
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * flash * 0.85;
    ctx.fillStyle = C.rail;
    ctx.fill();
    ctx.globalAlpha = base;
  }
  ctx.lineWidth = R * 0.2;
  ctx.strokeStyle = C.bumperRing;
  circ(ctx, at.x, at.y, R * 0.6);
  ctx.stroke();
  // A ring thrown off by the hit.
  if (pop < 1) {
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * (1 - pop) ** 2;
    ctx.strokeStyle = C.bumper;
    ctx.lineWidth = 0.14 * (1 - pop);
    circ(ctx, at.x, at.y, r + ease(pop) * 1.4);
    ctx.stroke();
    ctx.globalAlpha = base;
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
  const base0 = ctx.globalAlpha;
  ctx.globalAlpha = base0 * alpha * (1 - out);
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
  ctx.globalAlpha = base0;
}

// The ball. `stretch` runs along its direction of travel (above 1 when it's fast), `squash` flattens
// it against whatever it just hit (normal `n`), `scale` is for popping in and dropping out.
export function drawBall(ctx: Ctx, x: number, y: number, r: number, o: { dir?: number; stretch?: number; squash?: number; n?: number; scale?: number; alpha?: number; ring?: string } = {}) {
  const s = o.scale ?? 1;
  if (s <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.translate(x, y);
  // Stretched along the way it's going, squashed along the way it was knocked. Each in its own frame,
  // so the shape never snaps when one fades out; squash can go negative for a jelly wobble back.
  const sq = Math.max(-0.5, Math.min(1, o.squash ?? 0));
  const st = Math.max(1, o.stretch ?? 1);
  const dir = o.dir ?? 0, n = o.n ?? dir;
  ctx.scale(s, s);
  ctx.rotate(dir);
  ctx.scale(st, 1 / Math.sqrt(st));
  ctx.rotate(n - dir);
  ctx.scale(1 - sq * 0.3, 1 + sq * 0.22);
  ctx.rotate(-n);
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
  // In multiplayer, a ring in the player's color.
  if (o.ring) {
    circ(ctx, 0, 0, r * 0.84);
    ctx.strokeStyle = o.ring;
    ctx.lineWidth = r * 0.32;
    ctx.stroke();
  }
  ctx.restore();
}

// Someone else's ball: the same ball in their color, with their name over it.
function drawOther(ctx: Ctx, c: Course, o: Other, t: number) {
  const b = o.sim;
  let x = o.at.x, y = o.at.y, scale = 1, alpha = 1;
  if (b.mode === "sunk") {
    const cup = nearestCup(c, b);
    const k = Math.min(1, b.modeT / 0.45);
    const a = Math.atan2(b.y - cup.y, b.x - cup.x) + ease(k) * Math.PI * 1.5;
    const rr = Math.hypot(b.x - cup.x, b.y - cup.y) * (1 - ease(k));
    x = cup.x + Math.cos(a) * rr;
    y = cup.y + Math.sin(a) * rr;
    scale = 1 - ease(k) * 0.55;
    alpha = 1 - Math.max(0, k - 0.6) / 0.4;
  } else if (b.mode === "out") {
    const k = Math.min(1, b.modeT / 0.5);
    scale = 1 - ease(k);
    alpha = 1 - k;
  }
  if (alpha <= 0 || scale <= 0.01) return;
  const lift = b.z * 0.5;
  if (b.z > 0) {
    circ(ctx, x + 0.12 + b.z * 0.3, y + 0.22 + b.z * 0.5, b.r);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fill();
  }
  const speed = Math.hypot(b.vx, b.vy);
  drawBall(ctx, x, y - lift, b.r * (1 + b.z * 0.18), { dir: Math.atan2(b.vy, b.vx), stretch: b.mode === "roll" ? 1 + Math.min(0.35, speed / 70) : 1, scale, alpha, ring: o.color });
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * alpha;
  if (b.mode === "aim" || b.mode === "roll") drawStatus(ctx, b, { x, y: y - lift }, t);
  worldText(ctx, o.name, x, y - lift - b.r - 0.75, 0.62, o.color, C.cup);
  ctx.globalAlpha = base;
}

// A mystery box: it breathes a little until you roll through it.
export function drawBox(ctx: Ctx, at: Vec, t: number, i = 0, inkLabel = true) {
  const sz = 1.15 * (1 + Math.sin(t * 3 + i * 1.7) * 0.04);
  ctx.fillStyle = C.box;
  ctx.beginPath();
  ctx.roundRect(at.x - sz / 2, at.y - sz / 2, sz, sz, 0.18);
  ctx.fill();
  if (inkLabel) worldText(ctx, "?", at.x, at.y, sz * 0.72, C.boxInk);
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
  if (kind === "boost") {
    // Chevrons on a belt: evenly spaced, always moving, fading in at the back and out at the front,
    // so nothing ever jumps.
    const gap = 0.75, half = 1.05, speed = 1.4;
    const shift = (t * speed) % gap;
    const base = ctx.globalAlpha;
    for (let o = -half - gap + shift; o <= half + gap; o += gap) {
      const edge = Math.max(0, 1 - Math.abs(o) / half);
      if (edge <= 0) continue;
      ctx.globalAlpha = base * Math.min(1, edge * 1.8);
      ctx.beginPath();
      ctx.moveTo(o - 0.28, -0.48);
      ctx.lineTo(o + 0.2, 0);
      ctx.lineTo(o - 0.28, 0.48);
      ctx.stroke();
    }
    ctx.globalAlpha = base;
  } else {
    ctx.beginPath();
    ctx.moveTo(-0.35, -0.5);
    ctx.lineTo(0.2, 0);
    ctx.lineTo(-0.35, 0.5);
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
  ctx.fillStyle = "#6e2a20";
  ctx.fill();
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * (0.5 + 0.5 * Math.sin(t * 5 + at.x));
  ctx.fillStyle = C.mineLight;
  ctx.fill();
  ctx.globalAlpha = base;
}

// --- Frames ---

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx =
  | { kind: "ring" | "splash" | "puff" | "spark" | "confetti" | "boom"; x: number; y: number; t: number; color?: string; seed: number; big?: number }
  | { kind: "rail" | "tracer" | "bolt"; x: number; y: number; x2: number; y2: number; t: number; color?: string; seed: number; big?: number }
  | { kind: "horn" | "flash" | "frost"; x: number; y: number; t: number; color?: string; seed: number; big?: number }
  | { kind: "label"; x: number; y: number; t: number; text: string; color?: string; seed: number }
  | { kind: "boxpop"; x: number; y: number; t: number; color?: string; seed: number };
// Moments the renderer animates from, all in the frame's time.
export type Juice = {
  start: number; // the hole came up
  spawn: number; // the ball last appeared (on the tee, or back from off the edge)
  impact: { t: number; n: number; power: number } | null; // the ball last hit something, and which way it was pushed
  outV?: Vec; // how fast it was going when it went off the edge, so it drifts on as it drops
  flag?: { a: number; t: number }; // the flag's fade, eased so a ball zipping past doesn't flicker it
  flags?: { a: number; t: number }[]; // the same, for every flag on a map with several
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
  ball?: Vec; // where to draw the ball: between the last two physics steps, so it glides
  trailAlpha?: number; // the trail fades out after the ball stops
  aim: { angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec } | null;
  // Picking where an item goes: a line out from the ball (`range` long) or a patch (`r` across).
  target?: { kind: "line" | "area"; at: Vec | null; range?: number; r?: number } | null;
  inset?: { top: number; bottom: number };
  // Multiplayer: everyone else's ball (`at` is where to draw it), the color of mine, and when each
  // flag was last pulled by someone sinking.
  others?: Other[];
  myColor?: string;
  // Things in the air over the course: Rocket Launcher missiles and Thunderstorm clouds.
  air?: { missiles: readonly Missile[]; storms: readonly Storm[] };
  flagOut?: Map<number, number>;
};
export type Other = { sim: Sim; at: Vec; color: string; name: string };
export const allCups = (c: Course) => [c.cup, ...(c.cups ?? [])];
const nearestCup = (c: Course, p: Vec) => allCups(c).reduce((a, k) => (Math.hypot(k.x - p.x, k.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? k : a));

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
  // A map in the sea: the sea right out to the edges of the screen, then surf round every coast
  // without a rail.
  if (c.off === "water") {
    const { x0, y0, x1, y1 } = view;
    drawWater(ctx, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], t, view, false);
    for (const g of c.greens) if (g.rim === false) drawShore(ctx, g.poly, t);
    ctx.globalAlpha = intro;
  }
  drawBoard(ctx, c.greens.map((g) => g.poly), allCups(c), view);
  for (const z of c.zones) {
    if (z.kind === "sand") {
      path(ctx, z.poly);
      ctx.fillStyle = C.sand;
      ctx.fill();
    } else if (z.kind === "water") {
      drawWater(ctx, z.poly, t, view);
      ctx.globalAlpha = intro;
    } else if (z.kind === "bridge") drawBridge(ctx, z.poly);
    else if (z.kind === "ice") drawIce(ctx, z.poly, Math.round(z.poly[0].x * 7));
    else if (z.kind === "boost" || z.kind === "ramp") drawPad(ctx, z.poly, z.dir, z.kind, t);
  }
  for (const p of c.portals) {
    drawPortal(ctx, p.a, t);
    drawPortal(ctx, p.b, t);
  }
  for (const p of sim.patches ?? []) drawPatch(ctx, p, sim.t);
  for (const m of sim.mines) if (m.live) drawMine(ctx, m, t);
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  for (const tee of [c.tee, ...(c.tees ?? [])]) {
    ctx.beginPath();
    ctx.roundRect(tee.x - 1.1, tee.y - 1.1, 2.2, 2.2, 0.35);
    ctx.fill();
  }
  for (const k of allCups(c)) drawCup(ctx, k, CUP_R * (k === nearestCup(c, sim) ? sim.cupScale : 1));
  drawFx(ctx, f.fx, t, true);
  for (const g of c.greens) if (g.rim !== false) drawRail(ctx, g.poly, true, 0.6);
  for (const w of c.walls) drawRail(ctx, w.pts, !!w.closed, Math.max(0.5, w.w));
  for (const m of c.movers) drawMover(ctx, m, sim.t);
  for (const z of c.zones) if (z.kind === "wind") drawWind(ctx, z.poly, z.dir, t);
  ctx.globalAlpha = 1;

  const bx = f.ball?.x ?? sim.x, by = f.ball?.y ?? sim.y;
  // The ball's trail: a streak that thins out behind it, and fades away once the ball stops.
  const ta = f.trailAlpha ?? (sim.mode === "roll" ? 1 : 0);
  if (f.trail.length > 1 && ta > 0)
    for (let i = 1; i < f.trail.length; i++) {
      const k = i / f.trail.length;
      ctx.strokeStyle = `rgba(251,249,243,${0.4 * k * ta})`;
      ctx.lineWidth = BALL_R * 1.5 * k;
      ctx.lineCap = "butt"; // round caps overlap at every joint and bead the streak
      ctx.beginPath();
      ctx.moveTo(f.trail[i - 1].x, f.trail[i - 1].y);
      ctx.lineTo(i === f.trail.length - 1 && sim.mode === "roll" ? bx : f.trail[i].x, i === f.trail.length - 1 && sim.mode === "roll" ? by : f.trail[i].y);
      ctx.stroke();
    }

  // The ball, with its moments: popping onto the tee, squashing against walls, stretching at speed,
  // spiralling into the cup, dropping off the edge.
  const speed = Math.hypot(sim.vx, sim.vy);
  // Everyone else first, so mine is always on top.
  for (const o of f.others ?? []) drawOther(ctx, c, o, t);
  if (sim.mode === "sunk") {
    // From wherever it dropped in, round the rim and down.
    const cup = nearestCup(c, sim);
    const k = Math.min(1, sim.modeT / 0.45);
    const ox = sim.x - cup.x, oy = sim.y - cup.y;
    const a = Math.atan2(oy, ox) + ease(k) * Math.PI * 1.5;
    const rr = Math.hypot(ox, oy) * (1 - ease(k));
    drawBall(ctx, cup.x + Math.cos(a) * rr, cup.y + Math.sin(a) * rr, sim.r, { scale: 1 - ease(k) * 0.55, alpha: 1 - Math.max(0, k - 0.6) / 0.4, ring: f.myColor });
  } else if (sim.mode === "out") {
    // Off the edge: it keeps drifting, shrinks and fades.
    const k = Math.min(1, sim.modeT / 0.5);
    const d = J.outV ? ease(k) * 0.12 : 0;
    drawBall(ctx, bx + (J.outV?.x ?? 0) * d, by + (J.outV?.y ?? 0) * d, sim.r, { scale: 1 - ease(k), alpha: 1 - k, ring: f.myColor });
  } else {
    const since = t - (J.impact?.t ?? -9);
    // Flattened by the knock, then a jelly wobble back to round.
    const squash = J.impact && since < 0.3 ? Math.exp(-since * 16) * Math.cos(since * 48) * Math.min(1, J.impact.power * 3) : 0;
    const lift = sim.z * 0.5;
    if (sim.z > 0) {
      circ(ctx, bx + 0.12 + sim.z * 0.3, by + 0.22 + sim.z * 0.5, sim.r);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fill();
    }
    drawBall(ctx, bx, by - lift, sim.r * (1 + sim.z * 0.18), {
      dir: Math.atan2(sim.vy, sim.vx),
      stretch: 1 + Math.min(0.35, speed / 70),
      squash,
      n: J.impact?.n,
      scale: popIn((t - J.spawn) / 0.35),
      ring: f.myColor,
    });
    drawStatus(ctx, sim, { x: bx, y: by - lift }, t);
  }

  // Bumpers and boxes pop up one after another as the hole comes in.
  const grow = (i: number) => popIn((t - J.start - 0.2 - i * 0.05) / 0.35);
  c.bumpers.forEach((b, i) => {
    if (sim.gone[i]) return;
    const g = grow(i);
    if (g <= 0) return;
    drawBumper(ctx, b.at, b.r * g, Math.min(1, (t - (f.hits.get(i) ?? -9)) / 0.45));
  });
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const g = grow(c.bumpers.length + i);
    if (g <= 0) return;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(g, g);
    drawBox(ctx, v0, t, i);
    ctx.restore();
  });

  // Each flag stands until a ball's close, and flies off when one drops. Its fade is eased, so a ball
  // zipping past doesn't flicker it; once the ball drops it comes back and lifts away. In
  // multiplayer, anyone's ball counts, and the flag pops back up a moment after.
  const balls = [sim, ...(f.others ?? []).map((o) => o.sim)];
  allCups(c).forEach((cup, i) => {
    const near = Math.min(...balls.filter((b) => b.mode !== "sunk").map((b) => Math.hypot(b.x - cup.x, b.y - cup.y)), 99);
    const mine = sim.mode === "sunk" && nearestCup(c, sim) === cup;
    const pulled = f.flagOut?.get(i);
    const sunk = mine || (pulled !== undefined && t - pulled < 0.6);
    const want = sunk ? 1 : Math.max(0, Math.min(1, (near - 1.5) / 1.5));
    let fa = want;
    if (f.juice) {
      const list = (f.juice.flags ??= []);
      const fl = i === 0 ? (f.juice.flag ??= { a: want, t }) : (list[i] ??= { a: want, t });
      fl.a += (want - fl.a) * (1 - Math.exp(-Math.max(0, t - fl.t) * (sunk ? 14 : 8)));
      fl.t = t;
      fa = fl.a;
    }
    let out = mine ? Math.min(1, sim.modeT / 0.6) : 0;
    let back = 1;
    if (!mine && pulled !== undefined) {
      const age = t - pulled;
      if (age < 0.6) out = age / 0.6;
      else if (age < 2) out = 1;
      else back = popIn((age - 2) / 0.4);
    }
    if (back < 1) {
      ctx.save();
      ctx.translate(cup.x, cup.y);
      ctx.scale(back, back);
      ctx.translate(-cup.x, -cup.y);
      drawFlag(ctx, cup, t, fa * intro, 0);
      ctx.restore();
    } else drawFlag(ctx, cup, t, fa * intro, out);
  });

  for (const m of f.air?.missiles ?? []) drawMissile(ctx, m);
  drawFx(ctx, f.fx, t, false);
  for (const st of f.air?.storms ?? []) drawStorm(ctx, st, sim.t, t);

  // The aim: where the finger went down and how far it's pulled, then a dotted line out to the first
  // bounce and a ring round the ball filling with power.
  // (Only ever set when a putt would go: still, or rolling on Coffee.)
  if (f.aim) {
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
    if (kind === "line") {
      const dx = at.x - sim.x, dy = at.y - sim.y, d = Math.hypot(dx, dy) || 1;
      const L = f.target.range ?? 80;
      ctx.beginPath();
      ctx.moveTo(sim.x, sim.y);
      ctx.lineTo(sim.x + (dx / d) * L, sim.y + (dy / d) * L);
      ctx.stroke();
    } else {
      circ(ctx, at.x, at.y, f.target.r ?? 0.6);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (f.inset) holeArrow(ctx, f);
}

// When the cup is off screen, an arrow at the edge points to it (the nearest, on a map with several).
function holeArrow(ctx: Ctx, f: Frame) {
  const { c, sim, cam, dpr } = f;
  if (sim.mode === "sunk") return;
  const sw = ctx.canvas.width / dpr, sh = ctx.canvas.height / dpr;
  const pad = 30;
  const box = { x0: pad, y0: f.inset!.top + pad, x1: sw - pad, y1: sh - f.inset!.bottom - pad };
  const cup = nearestCup(c, sim);
  const sx = (cup.x - cam.x) * cam.s + cam.ox, sy = (cup.y - cam.y) * cam.s + cam.oy;
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
  const base = ctx.globalAlpha;
  for (const e of fx) {
    const age = t - e.t;
    if (age < 0) continue; // scheduled a moment ahead (the second ring, the confetti)
    const r = rng(e.seed);
    if (e.kind === "label") {
      // An item's name floating up off the box it came from.
      const life = 1.2;
      if (age > life || ground) continue;
      const k = age / life;
      ctx.globalAlpha = base * (1 - Math.max(0, k - 0.6) / 0.4);
      worldText(ctx, e.text, e.x, e.y - 1 - ease(k) * 1.5, 0.9, e.color ?? C.box, C.cup, popIn(Math.min(1, age / 0.25)));
      ctx.globalAlpha = base;
      continue;
    }
    if (e.kind === "boxpop") {
      // The box swells and fades as it opens.
      const life = 0.28;
      if (age > life || ground) continue;
      const k = age / life;
      ctx.globalAlpha = base * (1 - k);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(1 + ease(k) * 0.7, 1 + ease(k) * 0.7);
      drawBox(ctx, v0, 0, 0, false);
      ctx.restore();
      ctx.globalAlpha = base;
      continue;
    }
    if (e.kind === "boom") {
      const life = 0.6;
      if (age > life || !ground) continue;
      const k = age / life;
      // A hot flash that cools to the blast's color as it spreads and fades.
      const R = (e.color === "big" ? LASER_R : 1.4) * (0.45 + ease(k) * 0.65);
      ctx.globalAlpha = base * (1 - k) ** 1.5;
      circ(ctx, e.x, e.y, R);
      ctx.fillStyle = C.pad;
      ctx.fill();
      ctx.globalAlpha = base * Math.max(0, 1 - k * 2.5) ** 2;
      ctx.fillStyle = "#fff2c4";
      ctx.fill();
      ctx.globalAlpha = base;
      continue;
    }
    if (e.kind === "tracer") {
      // A gunshot: a hot line that's gone almost at once.
      const life = 0.25;
      if (age > life || ground) continue;
      const k = age / life;
      ctx.globalAlpha = base * (1 - k) ** 2;
      ctx.strokeStyle = "#fff2c4";
      ctx.lineWidth = (e.big ?? 1) * 0.22 * (1 - k * 0.5);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(e.x + (e.x2 - e.x) * ease(k) * 0.6, e.y + (e.y2 - e.y) * ease(k) * 0.6);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.globalAlpha = base;
      continue;
    }
    if (e.kind === "bolt") {
      // Lightning: a jagged white line out of the cloud, flickering twice.
      const life = 0.35;
      if (age > life || ground) continue;
      const k = age / life;
      const on = k < 0.25 || (k > 0.45 && k < 0.6);
      if (!on) continue;
      ctx.globalAlpha = base * (1 - k);
      ctx.strokeStyle = "#fbf6d8";
      ctx.lineWidth = 0.22;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(e.x2, e.y2);
      for (let i = 1; i <= 6; i++) {
        const u = i / 6;
        const jx = i === 6 ? 0 : (r() - 0.5) * 1.2;
        ctx.lineTo(e.x2 + (e.x - e.x2) * u + jx, e.y2 + (e.y - e.y2) * u);
      }
      ctx.stroke();
      circ(ctx, e.x, e.y, 0.9 * (1 - k));
      ctx.fillStyle = "#fbf6d8";
      ctx.fill();
      ctx.globalAlpha = base;
      continue;
    }
    if (e.kind === "horn" || e.kind === "flash" || e.kind === "frost") {
      // An Air Horn's sound waves, a camera's flash, a Freeze Bomb's cold snap: all spreading out.
      const life = e.kind === "flash" ? 0.5 : 0.8;
      if (age > life || ground) continue;
      const k = age / life;
      const R = (e.big ?? 1) * (0.6 + ease(k));
      if (e.kind === "flash") {
        circ(ctx, e.x, e.y, R);
        ctx.globalAlpha = base * (1 - k) ** 2 * 0.7;
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      } else {
        ctx.strokeStyle = e.kind === "horn" ? C.ink : "#cfeaf4";
        ctx.lineWidth = 0.16 * (1 - k * 0.6);
        for (let w = 0; w < (e.kind === "horn" ? 3 : 1); w++) {
          const kk = Math.max(0, k - w * 0.12);
          ctx.globalAlpha = base * (1 - kk) ** 2;
          circ(ctx, e.x, e.y, (e.big ?? 1) * (0.6 + ease(kk)));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = base;
      continue;
    }
    if (e.kind === "rail") {
      const life = 0.5;
      if (age > life || ground) continue;
      const k = age / life;
      ctx.globalAlpha = base * (1 - k) ** 2;
      ctx.strokeStyle = "#cfe9f2";
      ctx.lineWidth = 0.5 * (1 - k) + 0.1;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.globalAlpha = base;
      continue;
    }
    const onGround = e.kind === "ring" || e.kind === "splash" || e.kind === "puff";
    if (onGround !== ground) continue;
    if (e.kind === "ring" || e.kind === "splash") {
      const life = 0.45;
      if (age > life) continue;
      const k = age / life;
      ctx.strokeStyle = e.color ?? C.rail;
      ctx.globalAlpha = base * (1 - k) ** 2 * 0.9;
      const big = e.big ?? 1;
      ctx.lineWidth = 0.14 * Math.sqrt(big) * (1 - k * 0.5);
      circ(ctx, e.x, e.y, (0.5 + ease(k) * 1.6) * big);
      ctx.stroke();
    } else if (e.kind === "puff") {
      const life = 0.45;
      if (age > life) continue;
      const k = age / life;
      ctx.globalAlpha = base * (1 - k) * 0.8;
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
      const conf = e.kind === "confetti";
      // Confetti stays bright, then fades; sparks fade as they fly.
      ctx.globalAlpha = base * (conf ? 1 - Math.max(0, k - 0.55) / 0.45 : (1 - k) ** 1.5);
      const n = conf ? 34 : 12;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, sp = 1.5 + r() * 2.5;
        const spin = (r() - 0.5) * 16, ph = r() * 6;
        const flutter = conf ? Math.sin(age * 7 + ph) * 0.25 * k : 0;
        ctx.save();
        ctx.translate(e.x + Math.cos(a) * sp * ease(k) + flutter, e.y + Math.sin(a) * sp * ease(k) + (conf ? k * k * 2.5 : 0));
        ctx.rotate(spin * age);
        // A tumbling flake: its width swings as it turns over.
        if (conf) ctx.scale(Math.cos(age * 9 + ph), 1);
        ctx.fillStyle = e.kind === "confetti" ? CONFETTI[i % CONFETTI.length] : (e.color ?? C.box);
        ctx.fillRect(-0.1, -0.06, 0.2, e.kind === "confetti" ? 0.12 : 0.2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = base;
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
