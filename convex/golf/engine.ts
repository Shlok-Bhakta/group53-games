// Golf physics: a top-down ball on a 2D course, stepped at a fixed rate so a shot is fully determined by
// where it starts, its angle and power, and the time it's taken. That's what lets async play replay other
// players' shots exactly, and every phone in a multiplayer game run the same world (convex/golf/world.ts;
// the same idea as the real-time chess engine). Keep it free of browser imports, and use the math in
// dmath.ts, never Math.sin, cos, atan2, hypot or pow: those differ in the last bit between engines.
//
// Units: 1 is about a ball's width and a half (ball radius 0.32, cup radius 0.62). y points down, so
// north is up the screen.

import { datan2, dcos, dpow, dsin, hyp } from "./dmath";

export type Vec = { x: number; y: number };
export type Theme = "hills" | "desert" | "ice" | "volcano" | "arcade" | "orbit" | "server" | "zen";

// What the ball rolls on. Hazards end the shot: one stroke penalty and back to where it was hit from.
export type Ground = "green" | "fringe" | "rough" | "dune" | "sand" | "quicksand" | "snow" | "ice" | "bridge" | "stone" | "water" | "lava" | "void" | "coolant" | "oob";
// "oob" is everything outside the course's walls: only a ball in the air can get there.
export const HAZARDS: Ground[] = ["water", "lava", "void", "coolant", "oob"];
// Rolling resistance (units/s²). Green is a fast mini-golf carpet, ice barely slows anything.
export const DECEL: Record<Ground, number> = {
  green: 4.6,
  fringe: 6,
  bridge: 5,
  stone: 5.4,
  rough: 11,
  dune: 12,
  snow: 9.5,
  sand: 19,
  quicksand: 34,
  ice: 0.9,
  water: 0,
  lava: 0,
  void: 0,
  coolant: 0,
  oob: 0,
};

// Zones either set the ground (later zones win) or push the ball around on top of it.
export type Zone =
  | { kind: Ground; poly: Vec[] }
  | { kind: "slope"; poly: Vec[]; dir: Vec; strength: number } // dir points downhill
  | { kind: "mound"; poly: Vec[]; center: Vec; radius: number; strength: number } // > 0 a hill, < 0 a bowl
  | { kind: "boost"; poly: Vec[]; dir: Vec; strength: number }
  | { kind: "ramp"; poly: Vec[]; dir: Vec; lift: number }
  | { kind: "conveyor"; poly: Vec[]; dir: Vec; speed: number };

export type WallStyle = "rim" | "wood" | "stone" | "hedge" | "adobe" | "ice" | "obsidian" | "neon" | "metal" | "rack" | "timber" | "fence" | "rail";
export type Wall = { pts: Vec[]; w: number; h: number; style: WallStyle; bounce?: number; closed?: boolean };
export type BlockStyle = "mill" | "roof" | "mesa" | "rock" | "cabin" | "pillar" | "rack" | "crate" | "pagoda" | "ice";
export type Block = { poly: Vec[]; h: number; style: BlockStyle; roof?: boolean };
export type PropKind =
  | "tree" | "pine" | "palm" | "cactus" | "rock" | "bush" | "flowers" | "snowman" | "lamp" | "lantern" | "crystal"
  | "cherry" | "maple" | "asteroid" | "beacon" | "tuft" | "skull" | "vent" | "fern";
export type Prop = { kind: PropKind; at: Vec; r: number; h: number; solid?: boolean; seed?: number };
export type Bumper = { at: Vec; r: number; kick: number };
export type Mover =
  | { kind: "windmill"; hub: Vec; L: number; arms: number; omega: number; mouth: [Vec, Vec]; height: number }
  | { kind: "spinner"; at: Vec; L: number; arms: number; omega: number; w: number }
  | { kind: "slider"; a: Vec; b: Vec; size: Vec; period: number; phase?: number };
export type Portal = { a: Vec; b: Vec };
export type Well = { at: Vec; r: number; strength: number };

export type Course = {
  id: string;
  name: string;
  course: string; // the course this hole belongs to
  theme: Theme;
  par: number;
  open?: boolean; // an open-world map: one big hole, the camera follows the ball
  w: number;
  h: number;
  tee: Vec;
  cup: Vec;
  cups?: Vec[]; // more cups, on an open map with several flags
  tees?: Vec[]; // more places to start, on a map many players share
  off: Ground; // the ground outside every green
  greens: { poly: Vec[]; rim?: boolean }[];
  zones: Zone[];
  walls: Wall[];
  blocks: Block[];
  props: Prop[];
  bumpers: Bumper[];
  movers: Mover[];
  portals: Portal[];
  wells: Well[];
  lamps: Vec[];
  boxes: Vec[]; // mystery boxes: roll through one for a random power-up
  mines?: Vec[]; // landmines: roll over one and it throws the ball
};

export const BALL_R = 0.38;
export const CUP_R = 0.72;
export const MAX_SPEED = 32;
export const GRAVITY = 30;
export const DT = 1 / 240;
export const MAX_STROKES = 10;

// The first eight are ours; the rest are Super Battle Golf's items, made to work on a ball on a board.
// Air Horn, Flash Camera and Thunderstorm only make sense against other players, so they come with
// multiplayer.
export type Power =
  | "rocket" | "ghost" | "magnet" | "brake" | "mulligan" | "bigcup" | "jump" | "bouncy"
  | "spring" | "cart" | "jumbo" | "smoke" | "laser" | "mine" | "railgun";
export const POWERS: Power[] = ["rocket", "ghost", "magnet", "brake", "mulligan", "bigcup", "jump", "bouncy", "spring", "cart", "jumbo", "smoke", "laser", "mine", "railgun"];
export const BAG_SIZE = 3;
// Instant power-ups happen when tapped; targeted ones need a spot (or a direction) picked first; the
// rest are armed for the next shot.
export const INSTANT: Power[] = ["mulligan", "bigcup"];
export const TARGETED: Power[] = ["laser", "mine", "railgun"];
export const JUMBO = 2.2; // how much bigger a Jumbo Burger makes the ball

export type Ev =
  | { type: "hit" | "bounce" | "bump" | "splash" | "sink" | "launch" | "land" | "warp" | "lip" | "stop" | "clack" | "spawn"; x: number; y: number; power: number }
  | { type: "box"; x: number; y: number; power: number; item: Power }
  | { type: "boom" | "smash" | "mine"; x: number; y: number; power: number }
  | { type: "rail"; x: number; y: number; x2: number; y2: number; power: number };

type Seg = { a: Vec; b: Vec; r: number; h: number; bounce: number; rim: boolean };
export type World = { course: Course; segs: Seg[]; cells: Map<number, Seg[]> };

// Walls are bucketed into a coarse grid so a ball only checks the ones near it.
const CELL = 4;
const cellKey = (i: number, j: number) => i * 4096 + j;
export function nearSegs(world: World, x: number, y: number): Seg[] {
  return world.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? [];
}

type Snapshot = { x: number; y: number; strokes: number; bag: Power[]; boxes: boolean[]; cupScale: number };
export type Sim = {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  mode: "aim" | "roll" | "sunk" | "out";
  modeT: number;
  rollT: number;
  strokes: number;
  rest: Vec;
  cupScale: number;
  armed: Power | null; // waiting for the next shot
  shot: Power | null; // in effect for the shot rolling now
  bag: Power[];
  boxes: boolean[]; // taken
  portalLock: number;
  onRamp: boolean;
  ramp: number; // the ramp it's on (an index into the course's zones), or -1
  lipT: number;
  r: number; // the ball's radius: bigger after a Jumbo Burger
  cartT: number; // seconds left of a Golf Cart's full speed
  gone: boolean[]; // bumpers blown up
  mines: { x: number; y: number; live: boolean }[];
  strikes: { x: number; y: number; t: number }[]; // Orbital Lasers on their way
  outGround: Ground | null;
  history: Snapshot[];
  events: Ev[];
  seed: number;
};

// --- Geometry ---

export const v = (x: number, y: number): Vec => ({ x, y });
export const len = hyp;

export function inPoly(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function closest(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

export function edges(poly: Vec[], closed = true): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  for (let i = 0; i < poly.length - (closed ? 0 : 1); i++) out.push([poly[i], poly[(i + 1) % poly.length]]);
  return out;
}

// A seeded random number generator (mulberry32), so power-up draws replay the same everywhere.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- World ---

export function compile(course: Course): World {
  const segs: Seg[] = [];
  for (const g of course.greens) {
    if (g.rim === false) continue;
    for (const [a, b] of edges(g.poly)) segs.push({ a, b, r: 0.2, h: 0.6, bounce: 0.7, rim: true });
  }
  for (const w of course.walls)
    for (const [a, b] of edges(w.pts, !!w.closed)) segs.push({ a, b, r: w.w / 2, h: w.h, bounce: w.bounce ?? 0.72, rim: false });
  for (const bl of course.blocks) {
    if (bl.roof) continue;
    for (const [a, b] of edges(bl.poly)) segs.push({ a, b, r: 0.04, h: bl.h, bounce: 0.6, rim: false });
  }
  // The map's own edge, so nothing ever rolls off the world.
  const m = 0.2;
  const box = [v(m, m), v(course.w - m, m), v(course.w - m, course.h - m), v(m, course.h - m)];
  for (const [a, b] of edges(box)) segs.push({ a, b, r: 0.2, h: 99, bounce: 0.6, rim: true });
  // Each wall goes in every cell within reach of a ball touching it, including the cells next door.
  const cells = new Map<number, Seg[]>();
  for (const s of segs) {
    const pad = s.r + BALL_R + 0.5;
    const i0 = Math.floor((Math.min(s.a.x, s.b.x) - pad) / CELL) - 1, i1 = Math.floor((Math.max(s.a.x, s.b.x) + pad) / CELL) + 1;
    const j0 = Math.floor((Math.min(s.a.y, s.b.y) - pad) / CELL) - 1, j1 = Math.floor((Math.max(s.a.y, s.b.y) + pad) / CELL) + 1;
    for (let i = Math.max(-1, i0); i <= i1; i++)
      for (let j = Math.max(-1, j0); j <= j1; j++) {
        // Skip cells the segment's capsule doesn't come near.
        const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL;
        const q = closest({ x: cx, y: cy }, s.a, s.b);
        if (hyp(q.x - cx, q.y - cy) > CELL * 1.5 + pad) continue;
        const k = cellKey(i, j);
        const list = cells.get(k);
        if (list) list.push(s);
        else cells.set(k, [s]);
      }
  }
  return { course, segs, cells };
}

export function groundAt(world: World, p: Vec): Ground {
  const c = world.course;
  for (let i = c.zones.length - 1; i >= 0; i--) {
    const z = c.zones[i];
    if (z.kind in DECEL && inPoly(p, z.poly)) return z.kind as Ground;
  }
  // Greens are even-odd: a loop inside another is a hole in it (an island in the fairway).
  let inside = false;
  for (const g of c.greens) if (inPoly(p, g.poly)) inside = !inside;
  return inside ? "green" : c.off;
}

export type MoverPose =
  | { kind: "windmill"; angle: number; closed: boolean }
  | { kind: "spinner"; angle: number }
  | { kind: "slider"; at: Vec; vel: Vec };

export function poseOf(m: Mover, t: number): MoverPose {
  if (m.kind === "windmill") {
    const angle = m.omega * t;
    const step = (Math.PI * 2) / m.arms;
    let closed = false;
    for (let k = 0; k < m.arms; k++) {
      // Blade k points straight down when its angle is π.
      const a = (((angle + k * step - Math.PI) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      if (Math.abs(a) < 0.36) closed = true;
    }
    return { kind: "windmill", angle, closed };
  }
  if (m.kind === "spinner") return { kind: "spinner", angle: m.omega * t };
  const w = (Math.PI * 2) / m.period;
  const ph = (t / m.period + (m.phase ?? 0)) * Math.PI * 2;
  const k = (1 - dcos(ph)) / 2;
  const dk = (dsin(ph) * w) / 2;
  return {
    kind: "slider",
    at: { x: m.a.x + (m.b.x - m.a.x) * k, y: m.a.y + (m.b.y - m.a.y) * k },
    vel: { x: (m.b.x - m.a.x) * dk, y: (m.b.y - m.a.y) * dk },
  };
}

export function sliderRect(at: Vec, size: Vec): Vec[] {
  const hx = size.x / 2, hy = size.y / 2;
  return [v(at.x - hx, at.y - hy), v(at.x + hx, at.y - hy), v(at.x + hx, at.y + hy), v(at.x - hx, at.y + hy)];
}

// --- Simulation ---

export function newSim(course: Course, seed = 53): Sim {
  return {
    t: 0,
    x: course.tee.x,
    y: course.tee.y,
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    mode: "aim",
    modeT: 0,
    rollT: 0,
    strokes: 0,
    rest: { ...course.tee },
    cupScale: 1,
    armed: null,
    shot: null,
    bag: [],
    boxes: course.boxes.map(() => false),
    portalLock: -1,
    onRamp: false,
    ramp: -1,
    lipT: 0,
    r: BALL_R,
    cartT: 0,
    gone: course.bumpers.map(() => false),
    mines: (course.mines ?? []).map((m) => ({ ...m, live: true })),
    strikes: [],
    outGround: null,
    history: [],
    events: [],
    seed,
  };
}

export const maxSpeed = (sim: Sim) => MAX_SPEED * (sim.armed === "rocket" ? 1.8 : 1);

export function shoot(sim: Sim, angle: number, power: number) {
  if (sim.mode !== "aim" || sim.strokes >= MAX_STROKES) return;
  sim.history.push({ x: sim.x, y: sim.y, strokes: sim.strokes, bag: [...sim.bag], boxes: [...sim.boxes], cupScale: sim.cupScale });
  if (sim.history.length > 3) sim.history.shift();
  const speed = maxSpeed(sim) * Math.max(0, Math.min(1, power));
  sim.vx = dcos(angle) * speed;
  sim.vy = dsin(angle) * speed;
  sim.shot = sim.armed;
  sim.armed = null;
  // Spring Boots: up and over everything. Golf Cart: no slowing down for a moment. Jumbo: a big ball.
  if (sim.shot === "spring") {
    sim.vz = 6 + power * 8;
    sim.z = 0.02;
  }
  if (sim.shot === "cart") sim.cartT = 1.6;
  if (sim.shot === "jumbo") sim.r = BALL_R * JUMBO;
  sim.strokes++;
  sim.rest = { x: sim.x, y: sim.y };
  setMode(sim, "roll");
  sim.events.push({ type: "hit", x: sim.x, y: sim.y, power });
}

// Tap a power-up in the bag: instant ones happen now, the rest wait for the next shot.
export function activate(sim: Sim, i: number) {
  const p = sim.bag[i];
  if (!p) return;
  if (sim.mode !== "aim" || TARGETED.includes(p)) return;
  if (p === "mulligan") {
    const last = sim.history.pop();
    if (!last) return;
    sim.bag.splice(i, 1);
    // Back to before the last shot. Boxes it opened stay opened, so a rewind can't farm them.
    Object.assign(sim, { x: last.x, y: last.y, strokes: last.strokes, cupScale: last.cupScale, rest: { x: last.x, y: last.y } });
    return;
  }
  sim.bag.splice(i, 1);
  if (p === "bigcup") sim.cupScale = 1.8;
  else {
    if (sim.armed) sim.bag.push(sim.armed);
    sim.armed = p;
  }
}

export const LASER_R = 3;

// Thrown away from a point, up into the air: a mine going off, or a laser landing close.
export function blast(sim: Sim, x: number, y: number, speed: number) {
  const dx = sim.x - x, dy = sim.y - y, d = hyp(dx, dy) || 1;
  const a = d < 0.05 ? sim.seed : datan2(dy, dx);
  sim.vx = (d < 0.05 ? dcos(a) : dx / d) * speed;
  sim.vy = (d < 0.05 ? dsin(a) : dy / d) * speed;
  sim.vz = 8;
  sim.z = 0.02;
  if (sim.mode === "aim") setMode(sim, "roll");
}

// Targeted items: an Orbital Laser lands on a spot a moment later, a Landmine is dropped on one, and a
// Rail Gun fires a line from the ball that takes out every bumper and mine along it.
export function fireTargeted(sim: Sim, course: Course, i: number, at: Vec) {
  const p = sim.bag[i];
  if (!p || !TARGETED.includes(p) || sim.mode !== "aim") return;
  sim.bag.splice(i, 1);
  if (p === "laser") sim.strikes.push({ x: at.x, y: at.y, t: sim.t + 0.9 });
  else if (p === "mine") sim.mines.push({ x: at.x, y: at.y, live: true });
  else {
    const dx = at.x - sim.x, dy = at.y - sim.y, d = hyp(dx, dy) || 1;
    const end = { x: sim.x + (dx / d) * 80, y: sim.y + (dy / d) * 80 };
    course.bumpers.forEach((b, k) => {
      const q = closest(b.at, sim, end);
      if (hyp(q.x - b.at.x, q.y - b.at.y) < b.r + 0.4) sim.gone[k] = true;
    });
    for (const m of sim.mines) {
      const q = closest(m, sim, end);
      if (hyp(q.x - m.x, q.y - m.y) < 0.8) m.live = false;
    }
    sim.events.push({ type: "rail", x: sim.x, y: sim.y, x2: end.x, y2: end.y, power: 1 });
  }
}

// Jump: a hop mid-roll, high enough to clear walls, hedges and water. Once per shot it's armed for.
export function hop(sim: Sim) {
  if (sim.mode !== "roll" || sim.shot !== "jump" || sim.z > 0) return;
  sim.vz = 11;
  sim.z = 0.02;
  sim.shot = null;
  sim.events.push({ type: "launch", x: sim.x, y: sim.y, power: 0.6 });
}

// The brake: stops the ball dead, once, during a shot it was armed for.
export function brake(sim: Sim) {
  if (sim.mode !== "roll" || sim.shot !== "brake" || sim.z > 0) return;
  sim.vx = sim.vy = 0;
  sim.shot = null;
  sim.events.push({ type: "stop", x: sim.x, y: sim.y, power: 1 });
}

export function setMode(sim: Sim, mode: Sim["mode"]) {
  sim.mode = mode;
  sim.modeT = 0;
  if (mode === "roll") sim.rollT = 0;
}

function collide(sim: Sim, a: Vec, b: Vec, r: number, bounce: number, vs?: Vec): number {
  const q = closest(sim, a, b);
  let dx = sim.x - q.x, dy = sim.y - q.y;
  const d = hyp(dx, dy);
  const R = r + sim.r;
  if (d >= R) return 0;
  if (d < 1e-6) {
    // Dead on the line: push out along its normal.
    dx = -(b.y - a.y);
    dy = b.x - a.x;
  }
  const n = 1 / hyp(dx, dy);
  const nx = dx * n, ny = dy * n;
  sim.x = q.x + nx * R;
  sim.y = q.y + ny * R;
  const sx = vs?.x ?? 0, sy = vs?.y ?? 0;
  const rx = sim.vx - sx, ry = sim.vy - sy;
  const vn = rx * nx + ry * ny;
  if (vn >= 0) return 0;
  // Reflect the normal part, keep most of the tangential part.
  const tx = rx - vn * nx, ty = ry - vn * ny;
  sim.vx = sx + tx * 0.94 - vn * bounce * nx;
  sim.vy = sy + ty * 0.94 - vn * bounce * ny;
  return -vn;
}

function hazard(sim: Sim, g: Ground) {
  sim.outGround = g;
  sim.r = BALL_R;
  sim.cartT = 0;
  sim.strokes++;
  sim.vx = sim.vy = sim.vz = 0;
  setMode(sim, "out");
  sim.events.push({ type: "splash", x: sim.x, y: sim.y, power: 1 });
}

// One ball on its own (the single-player game): lasers land, then the ball moves.
export function step(sim: Sim, world: World, dt = DT) {
  landStrikes(world.course, sim.t + dt, [sim], sim.strikes, sim.gone, sim.mines, sim.events);
  stepBall(sim, world, dt);
}

// Orbital Lasers landing, whether anything's moving or not: they take out bumpers and mines nearby, and
// throw every ball close enough. `strikes` is changed in place, so balls sharing it all see it.
export function landStrikes(c: Course, t: number, balls: Sim[], strikes: Sim["strikes"], gone: boolean[], mines: Sim["mines"], events: Ev[]) {
  for (let k = 0; k < strikes.length; k++) {
    const st = strikes[k];
    if (t < st.t) continue;
    c.bumpers.forEach((b, i) => {
      if (hyp(b.at.x - st.x, b.at.y - st.y) < LASER_R + b.r) gone[i] = true;
    });
    for (const m of mines) if (hyp(m.x - st.x, m.y - st.y) < LASER_R) m.live = false;
    for (const b of balls) if ((b.mode === "aim" || b.mode === "roll") && hyp(b.x - st.x, b.y - st.y) < LASER_R + 1) blast(b, st.x, st.y, 24);
    events.push({ type: "boom", x: st.x, y: st.y, power: 1 });
    strikes.splice(k--, 1);
  }
}

// One ball's physics for one step. Things it shares with other balls (boxes, bumpers, mines) it reads
// and changes in place.
export function stepBall(sim: Sim, world: World, dt = DT) {
  const c = world.course;
  sim.t += dt;
  sim.modeT += dt;
  sim.lipT = Math.max(0, sim.lipT - dt);

  if (sim.mode === "sunk") return;
  if (sim.mode === "out") {
    if (sim.modeT > 1.1) {
      sim.x = sim.rest.x;
      sim.y = sim.rest.y;
      sim.z = 0;
      sim.shot = null;
      setMode(sim, "aim");
    }
    return;
  }

  const ghost = sim.shot === "ghost";
  // Moving obstacles push the ball even when it's sitting still.
  let shoved = 0;
  for (const m of c.movers) {
    const pose = poseOf(m, sim.t);
    if (pose.kind === "windmill" && m.kind === "windmill") {
      if (pose.closed && sim.z < 1) shoved += collide(sim, m.mouth[0], m.mouth[1], 0.22, 0.6);
    } else if (pose.kind === "spinner" && m.kind === "spinner") {
      if (sim.z > 1) continue;
      for (let k = 0; k < m.arms; k++) {
        const a = pose.angle + (k * Math.PI * 2) / m.arms;
        const tip = { x: m.at.x + dcos(a) * m.L, y: m.at.y + dsin(a) * m.L };
        const q = closest(sim, m.at, tip);
        const vs = { x: -m.omega * (q.y - m.at.y), y: m.omega * (q.x - m.at.x) };
        shoved += collide(sim, m.at, tip, m.w / 2, 0.75, vs);
      }
    } else if (pose.kind === "slider" && m.kind === "slider") {
      if (sim.z > 1.2) continue;
      for (const [a, b] of edges(sliderRect(pose.at, m.size))) shoved += collide(sim, a, b, 0.06, 0.6, pose.vel);
    }
  }
  if (sim.mode === "aim") {
    if (shoved > 0.2) setMode(sim, "roll");
    else {
      sim.vx = sim.vy = 0;
      return;
    }
  }

  sim.rollT += dt;
  const p = { x: sim.x, y: sim.y };
  const grounded = sim.z <= 0;
  let ax = 0, ay = 0; // forces that keep a ball rolling even when it's slow
  let svx = 0, svy = 0; // the ground's own velocity (conveyors)

  // Gravity wells bend whatever flies over them; balls on the ground are held by the deck.
  for (const w of grounded ? [] : c.wells) {
    const dx = w.at.x - p.x, dy = w.at.y - p.y;
    const d = hyp(dx, dy);
    if (d < w.r && d > 0.01) {
      const f = w.strength * dpow(1 - d / w.r, 0.6);
      ax += (dx / d) * f;
      ay += (dy / d) * f;
    }
  }

  if (grounded) {
    const g = groundAt(world, p);
    if (HAZARDS.includes(g)) return hazard(sim, g);
    let inRamp = false;
    for (let zi = 0; zi < c.zones.length; zi++) {
      const z = c.zones[zi];
      if (z.kind === "slope" || z.kind === "boost") {
        if (!inPoly(p, z.poly)) continue;
        ax += z.dir.x * z.strength;
        ay += z.dir.y * z.strength;
      } else if (z.kind === "mound") {
        const dx = p.x - z.center.x, dy = p.y - z.center.y;
        const d = hyp(dx, dy);
        if (d < z.radius && d > 0.05) {
          // Steepest halfway out, flat on top and at the foot.
          const f = z.strength * dsin((d / z.radius) * Math.PI);
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      } else if (z.kind === "conveyor") {
        if (!inPoly(p, z.poly)) continue;
        svx += z.dir.x * z.speed;
        svy += z.dir.y * z.speed;
      } else if (z.kind === "ramp") {
        if (!inPoly(p, z.poly)) continue;
        inRamp = true;
        sim.ramp = zi;
        // Climbing it costs a little speed.
        const along = sim.vx * z.dir.x + sim.vy * z.dir.y;
        if (along > 0) ax -= z.dir.x * 3, ay -= z.dir.y * 3;
      }
    }
    // Off the top of a ramp and into the air.
    const rz = sim.ramp >= 0 ? c.zones[sim.ramp] : null;
    if (sim.onRamp && !inRamp && rz?.kind === "ramp") {
      const along = sim.vx * rz.dir.x + sim.vy * rz.dir.y;
      if (along > 3) {
        sim.vz = Math.min(13, along * rz.lift);
        sim.z = 0.02;
        sim.events.push({ type: "launch", x: p.x, y: p.y, power: along / MAX_SPEED });
      }
      sim.ramp = -1;
    }
    sim.onRamp = inRamp;
    sim.vx += ax * dt;
    sim.vy += ay * dt;
    // Rolling resistance acts on the ball's speed relative to the ground under it.
    const decel = sim.cartT > 0 ? 0 : DECEL[g];
    sim.cartT = Math.max(0, sim.cartT - dt);
    const rx = sim.vx - svx, ry = sim.vy - svy;
    const rs = hyp(rx, ry);
    if (rs > 0) {
      const drop = Math.min(rs, (decel + rs * 0.12) * dt);
      sim.vx -= (rx / rs) * drop;
      sim.vy -= (ry / rs) * drop;
    }
    const push = hyp(ax, ay);
    if (rs < 0.12 && svx === 0 && svy === 0 && push < decel * 0.85 && sim.rollT > 0.05) {
      sim.vx = sim.vy = 0;
      sim.rest = { x: sim.x, y: sim.y };
      sim.shot = null;
      sim.r = BALL_R;
      setMode(sim, "aim");
      return;
    }
  } else {
    sim.vx += ax * dt;
    sim.vy += ay * dt;
    sim.vz -= GRAVITY * dt;
    sim.z += sim.vz * dt;
    sim.vx *= 1 - 0.05 * dt;
    sim.vy *= 1 - 0.05 * dt;
    if (sim.z <= 0) {
      const hard = -sim.vz;
      sim.z = 0;
      sim.vz = hard > 5 ? hard * 0.3 : 0;
      if (sim.vz > 0) sim.z = 0.001;
      sim.events.push({ type: "land", x: sim.x, y: sim.y, power: Math.min(1, hard / 15) });
    }
  }

  sim.x += sim.vx * dt;
  sim.y += sim.vy * dt;

  // Walls, then everything round.
  let hit = 0;
  for (const s of nearSegs(world, sim.x, sim.y)) {
    if (s.h <= sim.z) continue;
    if (ghost && !s.rim) continue;
    // Bouncy: walls fire the ball back harder than it came in.
    hit = Math.max(hit, collide(sim, s.a, s.b, s.r, sim.shot === "bouncy" && !s.rim ? 1.35 : sim.shot === "bouncy" ? 1.15 : s.bounce));
  }
  if (hit > 1) sim.events.push({ type: "bounce", x: sim.x, y: sim.y, power: Math.min(1, hit / MAX_SPEED) });
  c.bumpers.forEach((b, i) => {
    if (sim.z > 0.8 || sim.gone[i] || sim.shot === "smoke") return;
    const dx = sim.x - b.at.x, dy = sim.y - b.at.y;
    const d = hyp(dx, dy);
    const R = b.r + sim.r;
    if (d < R && d > 0 && sim.shot === "jumbo") {
      // Too big to bounce: it flattens the bumper and barely slows down.
      sim.gone[i] = true;
      sim.vx *= 0.85;
      sim.vy *= 0.85;
      sim.events.push({ type: "smash", x: b.at.x, y: b.at.y, power: 1 });
    } else if (d < R && d > 0) {
      const nx = dx / d, ny = dy / d;
      sim.x = b.at.x + nx * R;
      sim.y = b.at.y + ny * R;
      const vn = sim.vx * nx + sim.vy * ny;
      if (vn < 0) {
        sim.vx -= 2 * vn * nx;
        sim.vy -= 2 * vn * ny;
      }
      const kick = b.kick * (sim.shot === "bouncy" ? 6 : 1);
      sim.vx += nx * kick;
      sim.vy += ny * kick;
      sim.events.push({ type: "bump", x: b.at.x, y: b.at.y, power: 1 });
    }
  });

  // Landmines.
  for (const m of sim.mines) {
    if (!m.live || sim.z > 0.5 || sim.shot === "smoke" || hyp(sim.x - m.x, sim.y - m.y) > sim.r + 0.55) continue;
    m.live = false;
    blast(sim, m.x, m.y, 20);
    sim.events.push({ type: "mine", x: m.x, y: m.y, power: 1 });
  }

  for (const pr of c.props) {
    if (!pr.solid || pr.h <= sim.z || ghost) continue;
    const dx = sim.x - pr.at.x, dy = sim.y - pr.at.y;
    const d = hyp(dx, dy);
    const R = pr.r + sim.r;
    if (d < R && d > 0) {
      const nx = dx / d, ny = dy / d;
      sim.x = pr.at.x + nx * R;
      sim.y = pr.at.y + ny * R;
      const vn = sim.vx * nx + sim.vy * ny;
      if (vn < 0) {
        sim.vx -= 1.6 * vn * nx;
        sim.vy -= 1.6 * vn * ny;
        if (-vn > 1) sim.events.push({ type: "bounce", x: sim.x, y: sim.y, power: Math.min(1, -vn / MAX_SPEED) });
      }
    }
  }

  // Nothing gets faster than this, however many bouncy walls it meets.
  const sp = hyp(sim.vx, sim.vy), cap = MAX_SPEED * 2;
  if (sp > cap) {
    sim.vx *= cap / sp;
    sim.vy *= cap / sp;
  }

  // Mystery boxes.
  c.boxes.forEach((b, i) => {
    if (sim.boxes[i] || sim.z > 1.6 || len(sim.x - b.x, sim.y - b.y) > 1.1) return;
    if (sim.bag.length >= BAG_SIZE) return;
    sim.boxes[i] = true;
    const r = rng(sim.seed * 977 + i * 131 + sim.strokes * 7 + Math.round(sim.t * 240))();
    const item = POWERS[Math.floor(r * POWERS.length)];
    sim.bag.push(item);
    sim.events.push({ type: "box", x: b.x, y: b.y, power: 1, item });
  });

  // Portals, both ways. A ball that just came out of one can't go straight back in.
  if (sim.portalLock >= 0) {
    const pt = portalPoint(c, sim.portalLock);
    if (len(sim.x - pt.x, sim.y - pt.y) > 1.1) sim.portalLock = -1;
  }
  if (sim.z < 0.5)
    for (let i = 0; i < c.portals.length * 2; i++) {
      if (i === sim.portalLock) continue;
      const pt = portalPoint(c, i);
      if (len(sim.x - pt.x, sim.y - pt.y) < 0.6) {
        const out = i ^ 1;
        const to = portalPoint(c, out);
        sim.events.push({ type: "warp", x: pt.x, y: pt.y, power: 1 });
        sim.x = to.x;
        sim.y = to.y;
        sim.portalLock = out;
        sim.events.push({ type: "warp", x: to.x, y: to.y, power: 1 });
        break;
      }
    }

  // The cup: slow enough and it drops; too fast and it lips out. On a map with several, the nearest.
  const cupR = CUP_R * sim.cupScale;
  let cup = c.cup;
  for (const k of c.cups ?? []) if (hyp(k.x - sim.x, k.y - sim.y) < hyp(cup.x - sim.x, cup.y - sim.y)) cup = k;
  const dx = cup.x - sim.x, dy = cup.y - sim.y;
  const d = hyp(dx, dy);
  const speed = hyp(sim.vx, sim.vy);
  if (sim.shot === "magnet" && d < 4.5 && d > 0.01 && sim.z < 0.2) {
    const f = 16 * (1 - d / 4.5) + 3;
    sim.vx += (dx / d) * f * dt;
    sim.vy += (dy / d) * f * dt;
  }
  if (sim.z < 0.25 && d < cupR + 0.3 && d > 0.01) {
    sim.vx += (dx / d) * 6 * dt;
    sim.vy += (dy / d) * 6 * dt;
  }
  if (sim.z < 0.35 && d < cupR - sim.r * 0.45 && sim.r <= BALL_R) {
    const limit = sim.cupScale > 1 ? 16 : 11;
    if (speed < limit || (d < cupR * 0.45 && speed < limit * 1.35)) {
      sim.vx = sim.vy = sim.vz = 0;
      sim.z = 0;
      sim.shot = null;
      setMode(sim, "sunk");
      sim.events.push({ type: "sink", x: cup.x, y: cup.y, power: speed / limit });
      return;
    }
    if (sim.lipT === 0) {
      // Rattle round the rim: knocked sideways and slowed.
      const cross = Math.sign(dx * sim.vy - dy * sim.vx) || 1;
      const turn = cross * 0.35;
      const cs = dcos(turn), sn = dsin(turn);
      const nvx = (sim.vx * cs - sim.vy * sn) * 0.78, nvy = (sim.vx * sn + sim.vy * cs) * 0.78;
      sim.vx = nvx;
      sim.vy = nvy;
      sim.lipT = 0.25;
      sim.events.push({ type: "lip", x: sim.x, y: sim.y, power: 1 });
    }
  }

  if (sim.rollT > 30) {
    sim.vx = sim.vy = 0;
    sim.rest = { x: sim.x, y: sim.y };
    setMode(sim, "aim");
  }
}

export function portalPoint(c: Course, i: number): Vec {
  const p = c.portals[i >> 1];
  return i & 1 ? p.b : p.a;
}

// The aim line: straight out to the first wall, then a short bounce off it.
export function preview(world: World, from: Vec, angle: number, power: number, ghost = false): Vec[] {
  const pts: Vec[] = [{ ...from }];
  let dx = dcos(angle), dy = dsin(angle);
  let left = 2.5 + power * 9;
  let p = { ...from };
  let bounces = 0;
  const stepLen = 0.06;
  while (left > 0) {
    const nx = p.x + dx * stepLen, ny = p.y + dy * stepLen;
    let hitN: Vec | null = null;
    for (const s of nearSegs(world, nx, ny)) {
      if (ghost && !s.rim) continue;
      const q = closest({ x: nx, y: ny }, s.a, s.b);
      const ex = nx - q.x, ey = ny - q.y;
      const d = hyp(ex, ey);
      if (d < s.r + BALL_R) {
        hitN = d > 0 ? { x: ex / d, y: ey / d } : { x: -dy, y: dx };
        break;
      }
    }
    if (hitN) {
      pts.push({ ...p });
      if (++bounces > 1) break;
      const dot = dx * hitN.x + dy * hitN.y;
      dx -= 2 * dot * hitN.x;
      dy -= 2 * dot * hitN.y;
      left = Math.min(left, 2.2);
      continue;
    }
    p = { x: nx, y: ny };
    left -= stepLen;
  }
  pts.push(p);
  return pts;
}

export const SCORE_NAMES: Record<number, string> = { [-3]: "Albatross", [-2]: "Eagle", [-1]: "Birdie", 0: "Par", 1: "Bogey", 2: "Double bogey", 3: "Triple bogey" };
export function scoreName(strokes: number, par: number) {
  if (strokes === 1) return "Hole in one";
  return SCORE_NAMES[strokes - par] ?? `+${strokes - par}`;
}
