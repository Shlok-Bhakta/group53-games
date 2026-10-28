import { BALL_R, CUP_R, LASER_R, newSim, rng, type Course, type Sim, type Vec } from "./engine";

// The look: flat and straight down, like GamePigeon's mini golf. The course is drawn in fixed, natural
// golf colors on a dot grid in the app theme's own background. No depth, no shadows.

type Ctx = CanvasRenderingContext2D;

// The course is the same in every theme; only the void around it follows the app's theme. It comes in
// three looks: smooth (natural golf colors, drawn sharp at full resolution) and two pixel-art ones,
// drawn at about five pixels to a ball's width, snapped to a fixed 16-color palette, and scaled up
// with hard edges: PICO-8's, and Sweetie 16 (GrafxKid's, from Lospec).
type Look = {
  carpet: string;
  mow: string; // the other way of the mowing stripes
  putting: string; // the green round the cup
  wall: string;
  outline: string | null; // a dark line round walls, in pixel art
  bumper: string;
  bumperRing: string;
  cup: string;
  flag: string;
  box: string;
  boxInk: string;
  boost: string;
  ramp: string;
  sand: string;
  mine: string;
  ball: string;
  ui: string;
  confetti: string[];
  palette: string[] | null; // pixel art snaps to these
};
const SMOOTH: Look = {
  carpet: "#5c9a4b", // Dunn-Edwards' "Golf Course" green, nudged warmer
  mow: "#67a455",
  putting: "#4f8f40",
  wall: "#ece4d0",
  outline: null,
  bumper: "#b5533f",
  bumperRing: "#ece4d0",
  cup: "#1d2a1a",
  flag: "#c4473a",
  box: "#d4aa44",
  boxInk: "#5a4212",
  boost: "#c9853f",
  ramp: "#5f819c",
  sand: "#d8c9a8",
  mine: "#3a3934",
  ball: "#fbf9f3",
  ui: "#fbf9f3",
  confetti: ["#c4473a", "#d4aa44", "#8cbf6a", "#5f819c", "#ece4d0"],
  palette: null,
};
const PICO8 = ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"];
const SWEETIE16 = ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57"];
const LOOKS = {
  smooth: SMOOTH,
  pico: {
    carpet: "#008751", mow: "#00e436", putting: "#008751", wall: "#fff1e8", outline: "#1d2b53", bumper: "#ff004d", bumperRing: "#fff1e8",
    cup: "#000000", flag: "#ff004d", box: "#ffec27", boxInk: "#ab5236", boost: "#ffa300", ramp: "#29adff", sand: "#ffccaa", mine: "#5f574f",
    ball: "#fff1e8", ui: "#fff1e8", confetti: ["#ff004d", "#ffec27", "#00e436", "#29adff", "#ff77a8"], palette: PICO8,
  },
  sweetie: {
    carpet: "#38b764", mow: "#a7f070", putting: "#38b764", wall: "#f4f4f4", outline: "#1a1c2c", bumper: "#b13e53", bumperRing: "#ffcd75",
    cup: "#1a1c2c", flag: "#b13e53", box: "#ffcd75", boxInk: "#b13e53", boost: "#ef7d57", ramp: "#41a6f6", sand: "#ffcd75", mine: "#333c57",
    ball: "#f4f4f4", ui: "#f4f4f4", confetti: ["#b13e53", "#ffcd75", "#a7f070", "#41a6f6", "#ef7d57"], palette: SWEETIE16,
  },
} satisfies Record<string, Look>;
export type Style = keyof typeof LOOKS;
export const STYLES: { id: Style; name: string }[] = [
  { id: "smooth", name: "Smooth" },
  { id: "pico", name: "PICO-8" },
  { id: "sweetie", name: "Sweetie 16" },
];
let style: Style = "smooth";
let C: Look = SMOOTH;
export function setStyle(s: Style) {
  style = s;
  C = LOOKS[s];
  palette = null;
}

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

export type Camera = { x: number; y: number; s: number; ox: number; oy: number }; // screen = (world - xy) * s + o
export type Fx =
  | { kind: "ring" | "splash" | "puff" | "spark" | "confetti" | "boom"; x: number; y: number; t: number; color?: string; seed: number }
  | { kind: "rail"; x: number; y: number; x2: number; y2: number; t: number; color?: string; seed: number };
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
  target?: { kind: "laser" | "mine" | "railgun"; at: Vec | null } | null; // picking where an item goes
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

function drawScene(ctx: Ctx, f: Frame, pixel: boolean) {
  const { c, sim, cam, dpr, t } = f;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const T = () => ctx.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, (cam.ox - cam.x * cam.s) * dpr, (cam.oy - cam.y * cam.s) * dpr);
  const vx0 = cam.x - cam.ox / cam.s, vy0 = cam.y - cam.oy / cam.s;
  const vx1 = vx0 + W / dpr / cam.s, vy1 = vy0 + H / dpr / cam.s;

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
  for (let x = Math.floor(vx0 / gap) * gap; x < vx1; x += gap)
    for (let y = Math.floor(vy0 / gap) * gap; y < vy1; y += gap) {
      const d = pixel ? 1 / cam.s : 0.12; // one pixel, in pixel art
      ctx.fillRect(x - d / 2, y - d / 2, d, d);
    }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const boards = c.greens.map((g) => g.poly);
  for (const b of boards) {
    path(ctx, b);
    ctx.fillStyle = C.carpet;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Mowing stripes, on the diagonal like a real green.
    ctx.fillStyle = C.mow;
    ctx.strokeStyle = C.mow;
    const band = 2.4;
    const span = vx1 - vx0 + vy1 - vy0;
    for (let k = Math.floor((vx0 + vy0) / (band * 2)) * band * 2; k < vx0 + vy0 + span + band * 2; k += band * 2) {
      ctx.beginPath();
      ctx.moveTo(k - vy1, vy1);
      ctx.lineTo(k + band - vy1, vy1);
      ctx.lineTo(k + band - vy0, vy0);
      ctx.lineTo(k - vy0, vy0);
      ctx.closePath();
      if (!pixel) ctx.fill();
      else {
        // In pixel art the lighter stripe is hatched, one pixel in four, like dithering.
        ctx.save();
        ctx.clip();
        ctx.lineWidth = 1 / cam.s;
        for (let d = -band; d < band * 2; d += 4 / cam.s) {
          ctx.beginPath();
          ctx.moveTo(k - vy1 + d, vy1);
          ctx.lineTo(k - vy0 + d, vy0);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    circ(ctx, c.cup.x, c.cup.y, 3.2);
    ctx.fillStyle = C.putting;
    ctx.fill();
    ctx.restore();
  }

  // Speed pads and jump ramps: flat plates with arrows.
  for (const z of c.zones) {
    if (z.kind !== "boost" && z.kind !== "ramp" && z.kind !== "sand") continue;
    path(ctx, z.poly);
    ctx.fillStyle = z.kind === "boost" ? C.boost : z.kind === "ramp" ? C.ramp : C.sand;
    ctx.fill();
    if (z.kind !== "boost" && z.kind !== "ramp") continue;
    const m = z.poly.reduce((a, p) => ({ x: a.x + p.x / z.poly.length, y: a.y + p.y / z.poly.length }), { x: 0, y: 0 });
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(Math.atan2(z.dir.y, z.dir.x));
    ctx.strokeStyle = C.wall;
    ctx.lineWidth = 0.22;
    const n = z.kind === "boost" ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const o = (k - (n - 1) / 2) * 0.7 + (z.kind === "boost" ? ((t * 2) % 1) * 0.3 - 0.15 : 0);
      ctx.beginPath();
      ctx.moveTo(o - 0.35, -0.5);
      ctx.lineTo(o + 0.2, 0);
      ctx.lineTo(o - 0.35, 0.5);
      ctx.stroke();
    }
    if (z.kind === "ramp") {
      ctx.lineWidth = 0.12;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.moveTo(0.9, -0.9);
      ctx.lineTo(0.9, 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Landmines: dark discs with a blinking red light.
  for (const m of sim.mines) {
    if (!m.live) continue;
    circ(ctx, m.x, m.y, 0.55);
    ctx.fillStyle = C.mine;
    ctx.fill();
    circ(ctx, m.x, m.y, 0.18);
    ctx.fillStyle = Math.sin(t * 6 + m.x) > 0 ? "#ff3b30" : "#7a1a14";
    ctx.fill();
  }

  // Tee mat.
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.beginPath();
  ctx.roundRect(c.tee.x - 1.1, c.tee.y - 1.1, 2.2, 2.2, 0.35);
  ctx.fill();

  // The cup.
  const cupR = CUP_R * sim.cupScale;
  circ(ctx, c.cup.x, c.cup.y, cupR + 0.12);
  ctx.fillStyle = C.wall;
  ctx.fill();
  circ(ctx, c.cup.x, c.cup.y, cupR);
  ctx.fillStyle = C.cup;
  ctx.fill();

  drawFx(ctx, f.fx, t, true);

  // Walls: the board's edge and any baffles, one flat line each (with a dark outline in pixel art).
  if (C.outline) {
    ctx.strokeStyle = C.outline;
    for (const b of boards) {
      ctx.lineWidth = 0.6 + 2 / cam.s;
      path(ctx, b);
      ctx.stroke();
    }
    for (const w of c.walls) {
      ctx.lineWidth = Math.max(0.5, w.w) + 2 / cam.s;
      path(ctx, w.pts, 0, 0, !!w.closed);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = C.wall;
  for (const b of boards) {
    ctx.lineWidth = 0.6;
    path(ctx, b);
    ctx.stroke();
  }
  for (const w of c.walls) {
    ctx.lineWidth = Math.max(0.5, w.w);
    path(ctx, w.pts, 0, 0, !!w.closed);
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
    // In pixel art the ball is never smaller than about six pixels across, so it always reads.
    const R = Math.max(sim.r, pixel ? 3 / cam.s : 0) * (1 + sim.z * 0.18) * (1 - sinking * 0.5) * (1 - out);
    circ(ctx, bx, by, R);
    ctx.fillStyle = C.ball;
    ctx.fill();
  }

  // Bumpers: flat red discs with a white ring. Hit, they swell and flash.
  c.bumpers.forEach((b, i) => {
    if (sim.gone[i]) return;
    const age = t - (f.hits.get(i) ?? -9);
    const pop = age < 0.25 ? Math.sin((age / 0.25) * Math.PI) : 0;
    const r = b.r * (1 + pop * 0.2);
    circ(ctx, b.at.x, b.at.y, r);
    ctx.fillStyle = pop > 0.5 ? C.wall : C.bumper;
    ctx.fill();
    ctx.lineWidth = r * 0.2;
    ctx.strokeStyle = C.bumperRing;
    circ(ctx, b.at.x, b.at.y, r * 0.6);
    ctx.stroke();
  });

  // Mystery boxes: flat yellow squares.
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const sz = 1.1;
    ctx.fillStyle = C.box;
    ctx.beginPath();
    ctx.roundRect(b.x - sz / 2, b.y - sz / 2, sz, sz, 0.15);
    ctx.fill();
  });

  // The flag: a pole and a pennant, gone once the ball's close.
  const near = Math.hypot(sim.x - c.cup.x, sim.y - c.cup.y);
  const flagA = sim.mode === "sunk" ? 0 : Math.max(0, Math.min(1, (near - 1.5) / 1.5));
  if (flagA > 0) {
    ctx.globalAlpha = flagA;
    ctx.strokeStyle = C.wall;
    ctx.lineWidth = 0.13;
    ctx.beginPath();
    ctx.moveTo(c.cup.x, c.cup.y);
    ctx.lineTo(c.cup.x, c.cup.y - 2.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.cup.x, c.cup.y - 2.6);
    ctx.lineTo(c.cup.x + 1.4, c.cup.y - 2.15);
    ctx.lineTo(c.cup.x, c.cup.y - 1.7);
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
  ctx.fillStyle = C.boxInk;
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i]) return;
    const sx = (b.x - cam.x) * cam.s + cam.ox, sy = (b.y - cam.y) * cam.s + cam.oy;
    if (pixel) {
      // Too small for a "?" in pixel art: a little mark instead.
      ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 2, 2, 2);
      ctx.fillRect(Math.round(sx) - 1, Math.round(sy) + 1, 2, 1);
    } else {
      ctx.font = `800 ${Math.max(8, cam.s * 0.75)}px system-ui, sans-serif`;
      ctx.fillText("?", sx, sy + 1);
    }
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
  // Lasers on their way: a target ring closing in.
  T();
  for (const st of sim.strikes) {
    const k = Math.max(0, Math.min(1, (st.t - sim.t) / 0.9));
    ctx.strokeStyle = "#ff3b30";
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
    ctx.strokeStyle = "#ffffff";
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
}

// Pixel art: the scene drawn small, every pixel snapped to the palette (and the theme's two colors),
// then scaled up with no smoothing.
const PIXELS_PER_UNIT = 5.5;
let low: HTMLCanvasElement | null = null;
let palette: { rgb: [number, number, number][]; key: string } | null = null;
const snapCache = new Map<number, number>();
function paletteRGB(): [number, number, number][] {
  const th = themeColors();
  const key = `${style}|${th.bg}|${th.dot}`;
  if (palette?.key === key) return palette.rgb;
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const pc = probe.getContext("2d", { willReadFrequently: true })!;
  const read = (fill: string, over?: string): [number, number, number] => {
    pc.clearRect(0, 0, 1, 1);
    if (over) {
      pc.fillStyle = over;
      pc.fillRect(0, 0, 1, 1);
    }
    pc.fillStyle = fill;
    pc.fillRect(0, 0, 1, 1);
    const d = pc.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const rgb = [...(C.palette ?? []).map((h) => read(h)), read(th.bg), read(th.dot, th.bg)];
  palette = { rgb, key };
  snapCache.clear();
  return rgb;
}
function snap(lc: Ctx) {
  const rgb = paletteRGB();
  const img = lc.getImageData(0, 0, lc.canvas.width, lc.canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let k = snapCache.get(key);
    if (k === undefined) {
      let best = 1e9;
      k = 0;
      for (let j = 0; j < rgb.length; j++) {
        const dr = d[i] - rgb[j][0], dg = d[i + 1] - rgb[j][1], db = d[i + 2] - rgb[j][2];
        const e = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (e < best) {
          best = e;
          k = j;
        }
      }
      snapCache.set(key, k);
    }
    d[i] = rgb[k][0];
    d[i + 1] = rgb[k][1];
    d[i + 2] = rgb[k][2];
    d[i + 3] = 255;
  }
  lc.putImageData(img, 0, 0);
}

export function drawFrame(ctx: Ctx, f: Frame) {
  if (!C.palette) {
    drawScene(ctx, f, false);
  } else {
    const k = Math.max(2, Math.round(f.cam.s / PIXELS_PER_UNIT)); // screen points per pixel
    const cssW = ctx.canvas.width / f.dpr, cssH = ctx.canvas.height / f.dpr;
    low ??= document.createElement("canvas");
    const w = Math.ceil(cssW / k), h = Math.ceil(cssH / k);
    if (low.width !== w || low.height !== h) {
      low.width = w;
      low.height = h;
    }
    const lc = low.getContext("2d", { willReadFrequently: true })!;
    const sc = (p?: Vec) => p && { x: p.x / k, y: p.y / k };
    drawScene(
      lc,
      {
        ...f,
        cam: { x: f.cam.x, y: f.cam.y, s: f.cam.s / k, ox: f.cam.ox / k, oy: f.cam.oy / k },
        dpr: 1,
        aim: f.aim && { ...f.aim, from: sc(f.aim.from), to: sc(f.aim.to) },
      },
      true,
    );
    snap(lc);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, w * k * f.dpr, h * k * f.dpr);
    ctx.imageSmoothingEnabled = true;
  }
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
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
  ctx.fillStyle = C.bumper;
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
    if (e.kind === "boom") {
      // A flash and a ring of debris.
      const life = 0.6;
      if (age > life || !ground) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - k;
      circ(ctx, e.x, e.y, (e.color === "big" ? LASER_R : 1.4) * (0.5 + k));
      ctx.fillStyle = k < 0.25 ? "#fff2c4" : "#ff8a3d";
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (e.kind === "rail") {
      const life = 0.5;
      if (age > life || ground) continue;
      const k = age / life;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "#7df9ff";
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
        ctx.fillStyle = e.kind === "confetti" ? C.confetti[i % 5] : (e.color ?? C.box);
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
    sim: newSim(c),
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
