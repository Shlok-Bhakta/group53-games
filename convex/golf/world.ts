import { activate, BALL_R, blast, brake, closest, compile, DT, fireTargeted, hop, landStrikes, MAX_STROKES, newSim, setMode, shoot, stepBall, TARGETED, type Course, type Ev, type Sim, type Vec, type World } from "./engine";
import { dcos, dsin, hyp } from "./dmath";

// Multiplayer golf: every player's ball on one course, sharing its boxes, bumpers, mines and lasers,
// and (if the game has it on) knocking into each other.
//
// Everything that happens is a command at a tick: a player joins, shoots, uses an item. Every phone
// and the server run the same commands through `advance` and get the same world, bit for bit (the
// engine's math is portable, see dmath.ts), so the only traffic is the commands themselves. The
// server keeps a settled snapshot (convex/golf.ts); phones replay from it.
//
// A world where every ball is sitting still is "quiet": nothing can change until a command or a timer
// (a box coming back), so `advance` jumps straight there. An idle world costs nothing to catch up on.

export const TPS = 240; // ticks per second: one engine step each
export const BOX_BACK = 20 * TPS; // an opened box comes back
export const BUMPER_BACK = 25 * TPS; // a blown-up bumper is rebuilt
export const MINE_BACK = 15 * TPS; // one of the map's own mines re-arms
export const SINK_RESPAWN = 1.6; // seconds in the cup before the ball's back on a tee

export type CmdKind = "join" | "shot" | "use" | "fire" | "hop" | "brake" | "reset";
export type Cmd = { tick: number; by: string; seq: number; kind: CmdKind; a?: number; p?: number; i?: number; x?: number; y?: number };

export type Mine = { x: number; y: number; live: boolean; fixed: boolean; back: number };
export type Ball = Sim & { id: string; holes: number; color: number };
export type WorldState = {
  tick: number;
  seed: number;
  collide: boolean; // balls knock into each other
  balls: Ball[]; // in the order they joined
  boxes: boolean[]; // taken
  boxBack: number[]; // the tick a taken box comes back, or -1
  gone: boolean[]; // bumpers blown up
  goneBack: number[];
  mines: Mine[];
  strikes: { x: number; y: number; t: number }[];
  // What happened this run, for sounds and effects. Never stored.
  events: WorldEvent[];
};
export type WorldEvent = { tick: number; id: string; ev: Ev };

export function newWorld(course: Course, opts: { seed?: number; collide?: boolean } = {}): WorldState {
  return {
    tick: 0,
    seed: opts.seed ?? 53,
    collide: opts.collide ?? true,
    balls: [],
    boxes: course.boxes.map(() => false),
    boxBack: course.boxes.map(() => -1),
    gone: course.bumpers.map(() => false),
    goneBack: course.bumpers.map(() => -1),
    mines: (course.mines ?? []).map((m) => ({ x: m.x, y: m.y, live: true, fixed: true, back: -1 })),
    strikes: [],
    events: [],
  };
}

// Commands in the one order every phone agrees on.
export const cmdOrder = (a: Cmd, b: Cmd) => a.tick - b.tick || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0) || a.seq - b.seq;

// A player's id as a number, for their ball's random draws.
function idSeed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const tees = (c: Course) => [c.tee, ...(c.tees ?? [])];
// The first tee nobody's standing on, so balls never start on top of each other.
function freeTee(s: WorldState, c: Course, from = 0): Vec {
  const all = tees(c);
  for (let k = 0; k < all.length; k++) {
    const t = all[(from + k) % all.length];
    if (s.balls.every((b) => b.mode === "sunk" || hyp(b.x - t.x, b.y - t.y) > 1.4)) return t;
  }
  return all[from % all.length];
}

// Balls share the world's boxes, bumpers, mines and lasers: the same arrays, changed in place.
function link(s: WorldState, b: Ball) {
  b.boxes = s.boxes;
  b.gone = s.gone;
  b.mines = s.mines;
  b.strikes = s.strikes;
}

function place(b: Ball, at: Vec) {
  b.x = at.x;
  b.y = at.y;
  b.vx = b.vy = b.vz = b.z = 0;
  b.rest = { x: at.x, y: at.y };
  b.r = BALL_R;
  b.cartT = 0;
  b.shot = null;
  b.portalLock = -1;
  b.onRamp = false;
  b.ramp = -1;
  b.lipT = 0;
  b.cupScale = 1;
  setMode(b, "aim");
  b.modeT = 0;
}

export function applyCmd(s: WorldState, c: Course, cmd: Cmd) {
  let b = s.balls.find((x) => x.id === cmd.by);
  if (cmd.kind === "join") {
    if (b) return;
    const sim = newSim(c, idSeed(cmd.by) % 100000) as Ball;
    b = Object.assign(sim, { id: cmd.by, holes: 0, color: s.balls.length });
    link(s, b);
    place(b, freeTee(s, c, s.balls.length));
    b.t = s.tick * DT;
    s.balls.push(b);
    return;
  }
  if (!b) return;
  b.t = s.tick * DT;
  switch (cmd.kind) {
    case "shot": {
      if (!Number.isFinite(cmd.a) || !Number.isFinite(cmd.p)) return;
      // An open world has no stroke limit.
      if (b.strokes >= MAX_STROKES - 1) b.strokes = 0;
      shoot(b, cmd.a!, cmd.p!);
      break;
    }
    case "use":
      activate(b, cmd.i ?? -1);
      break;
    case "fire": {
      const i = cmd.i ?? -1, item = b.bag[i];
      if (!item || !TARGETED.includes(item) || !Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return;
      const at = { x: cmd.x!, y: cmd.y! };
      const from = { x: b.x, y: b.y };
      fireTargeted(b, c, i, at);
      if (item === "mine") {
        // fireTargeted pushed a plain mine; make it a world one that's gone once it goes off.
        const m = s.mines[s.mines.length - 1] as Partial<Mine>;
        m.fixed = false;
        m.back = -1;
      }
      if (item === "railgun") {
        // The rail hits balls too: anyone near the line is thrown off it.
        const dx = at.x - from.x, dy = at.y - from.y, d = hyp(dx, dy) || 1;
        const end = { x: from.x + (dx / d) * 80, y: from.y + (dy / d) * 80 };
        for (const o of s.balls) {
          if (o === b || (o.mode !== "aim" && o.mode !== "roll")) continue;
          const q = closest(o, from, end);
          if (hyp(o.x - q.x, o.y - q.y) < 0.9) blast(o, q.x - (dx / d) * 0.5, q.y - (dy / d) * 0.5, 22);
        }
      }
      break;
    }
    case "hop":
      hop(b);
      break;
    case "brake":
      brake(b);
      break;
    case "reset":
      if (b.mode === "aim" || b.mode === "roll") place(b, freeTee(s, c, b.color));
      break;
  }
  drain(s, b);
}

function drain(s: WorldState, b: Ball) {
  for (const ev of b.events) s.events.push({ tick: s.tick, id: b.id, ev });
  b.events.length = 0;
}

const moving = (b: Ball) => b.mode === "roll";
const quiet = (s: WorldState, c: Course) => s.strikes.length === 0 && c.movers.length === 0 && s.balls.every((b) => b.mode === "aim" && b.lipT === 0);

// The next tick a timer goes off, after `tick`.
function nextTimer(s: WorldState) {
  let n = Number.MAX_SAFE_INTEGER;
  for (const t of s.boxBack) if (t > s.tick && t < n) n = t;
  for (const t of s.goneBack) if (t > s.tick && t < n) n = t;
  for (const m of s.mines) if (m.back > s.tick && m.back < n) n = m.back;
  return n;
}

function timers(s: WorldState) {
  for (let i = 0; i < s.boxes.length; i++) {
    if (s.boxes[i] && s.boxBack[i] < 0) s.boxBack[i] = s.tick + BOX_BACK;
    else if (s.boxes[i] && s.tick >= s.boxBack[i]) (s.boxes[i] = false), (s.boxBack[i] = -1);
  }
  for (let i = 0; i < s.gone.length; i++) {
    if (s.gone[i] && s.goneBack[i] < 0) s.goneBack[i] = s.tick + BUMPER_BACK;
    else if (s.gone[i] && s.tick >= s.goneBack[i]) (s.gone[i] = false), (s.goneBack[i] = -1);
  }
  for (let i = 0; i < s.mines.length; i++) {
    const m = s.mines[i];
    if (m.live) continue;
    if (!m.fixed) s.mines.splice(i--, 1);
    else if (m.back < 0) m.back = s.tick + MINE_BACK;
    else if (s.tick >= m.back) (m.live = true), (m.back = -1);
  }
}

// Two balls meeting: they push apart and trade speed along the line between them, heavier (bigger)
// balls giving less. A ball sitting still gets knocked into a roll.
function collideBalls(s: WorldState) {
  const bs = s.balls;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (a.mode !== "aim" && a.mode !== "roll") continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (b.mode !== "aim" && b.mode !== "roll") continue;
      if (!moving(a) && !moving(b)) continue;
      if (Math.abs(a.z - b.z) > 0.6) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = hyp(dx, dy);
      const R = a.r + b.r;
      if (d >= R) continue;
      // Dead on top of each other: apart along x.
      const nx = d < 1e-9 ? 1 : dx / d, ny = d < 1e-9 ? 0 : dy / d;
      const ma = a.r * a.r, mb = b.r * b.r, m = ma + mb;
      const over = R - d;
      a.x -= nx * over * (mb / m);
      a.y -= ny * over * (mb / m);
      b.x += nx * over * (ma / m);
      b.y += ny * over * (ma / m);
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn >= 0) continue;
      const imp = (-(1 + 0.9) * vn) / (1 / ma + 1 / mb);
      a.vx -= (imp / ma) * nx;
      a.vy -= (imp / ma) * ny;
      b.vx += (imp / mb) * nx;
      b.vy += (imp / mb) * ny;
      for (const o of [a, b]) {
        if (o.mode === "aim") {
          o.rest = { x: o.x, y: o.y };
          setMode(o, "roll");
        }
      }
      s.events.push({ tick: s.tick, id: a.id, ev: { type: "clack", x: a.x + nx * a.r, y: a.y + ny * a.r, power: Math.min(1, -vn / 32) } });
    }
  }
}

export function stepWorld(s: WorldState, w: World) {
  const c = w.course;
  const booms: Ev[] = [];
  landStrikes(c, (s.tick + 1) * DT, s.balls, s.strikes, s.gone, s.mines, booms);
  for (const ev of booms) s.events.push({ tick: s.tick, id: "", ev });
  for (const b of s.balls) {
    b.t = s.tick * DT;
    stepBall(b, w, DT);
    if (b.mode === "aim") b.modeT = 0;
  }
  if (s.collide) collideBalls(s);
  s.tick++;
  for (const b of s.balls) {
    drain(s, b);
    if (b.mode === "sunk" && b.modeT > SINK_RESPAWN) {
      b.holes++;
      b.strokes = 0;
      place(b, freeTee(s, c, b.color));
      s.events.push({ tick: s.tick, id: b.id, ev: { type: "spawn", x: b.x, y: b.y, power: 1 } });
    }
  }
  timers(s);
}

// Runs the world up to `to`, applying the commands at their ticks. Commands from before the world's
// tick are already in it (or too late to count) and are skipped.
export function advance(s: WorldState, w: World, to: number, cmds: readonly Cmd[]) {
  const c = w.course;
  let ci = 0;
  while (ci < cmds.length && cmds[ci].tick < s.tick) ci++;
  while (s.tick < to) {
    while (ci < cmds.length && cmds[ci].tick === s.tick) applyCmd(s, c, cmds[ci++]);
    if (quiet(s, c)) {
      const next = Math.min(to, ci < cmds.length ? cmds[ci].tick : to, nextTimer(s));
      if (next > s.tick) {
        s.tick = next;
        timers(s);
        continue;
      }
    }
    stepWorld(s, w);
  }
}

// A world as stored or sent: the shared arrays once, not on every ball, and no events.
export type Packed = Omit<WorldState, "balls" | "events"> & { balls: Omit<Ball, "boxes" | "gone" | "mines" | "strikes" | "events">[] };
export function pack(s: WorldState): Packed {
  return {
    tick: s.tick,
    seed: s.seed,
    collide: s.collide,
    boxes: [...s.boxes],
    boxBack: [...s.boxBack],
    gone: [...s.gone],
    goneBack: [...s.goneBack],
    mines: s.mines.map((m) => ({ ...m })),
    strikes: s.strikes.map((m) => ({ ...m })),
    balls: s.balls.map(({ boxes: _b, gone: _g, mines: _m, strikes: _s, events: _e, ...rest }) => structuredClone(rest)),
  };
}
export function unpack(p: Packed): WorldState {
  const s: WorldState = {
    tick: p.tick,
    seed: p.seed,
    collide: p.collide,
    boxes: [...p.boxes],
    boxBack: [...p.boxBack],
    gone: [...p.gone],
    goneBack: [...p.goneBack],
    mines: p.mines.map((m) => ({ ...m })),
    strikes: p.strikes.map((m) => ({ ...m })),
    balls: [],
    events: [],
  };
  for (const raw of p.balls) {
    const b = structuredClone(raw) as Ball;
    b.events = [];
    link(s, b);
    s.balls.push(b);
  }
  return s;
}

// Everything the world is, as one number: what the tests and the phones compare.
export function fingerprint(s: WorldState) {
  let h = 2166136261;
  const mix = (n: number) => {
    // Every bit of the number, so even the last one counts.
    const f = new Float64Array([n]);
    const u = new Uint32Array(f.buffer);
    h = Math.imul(h ^ u[0], 16777619);
    h = Math.imul(h ^ u[1], 16777619);
  };
  mix(s.tick);
  for (const b of s.balls) for (const n of [b.x, b.y, b.vx, b.vy, b.z, b.vz, b.strokes, b.holes, b.r, b.bag.length]) mix(n);
  for (const x of s.boxes) mix(x ? 1 : 0);
  for (const x of s.gone) mix(x ? 1 : 0);
  for (const m of s.mines) mix(m.live ? m.x : -m.x);
  return h >>> 0;
}

export const compileWorld = compile;
export const aimVec = (a: number) => ({ x: dcos(a), y: dsin(a) });
