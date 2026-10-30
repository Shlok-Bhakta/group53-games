import {
  activate, BALL_R, blast, BLIND_S, brake, closest, compile, DT, fireTargeted, FREEZE_S, hop, landStrikes, MAX_STROKES, newSim, rng, setMode, shoot, stepBall, TARGETED,
  type Course, type Ev, type Patch, type Sim, type Vec, type World,
} from "./engine";
import { dcos, dsin, DTWO_PI, hyp } from "./dmath";

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
// Items that reach other players.
export const REACH = 12; // Air Horn and Flash Camera: everyone this close
export const MISSILE = { speed: 15, turn: 4, life: 6, hit: 20 }; // Rocket Launcher: homes in on the nearest player
export const PISTOL = { range: 22, hit: 18, stun: 3 }; // Dueling Pistol: the first ball on the line
export const ELEPHANT = { range: 16, hit: 30, stun: 2, recoil: 16 }; // Elephant Gun: both barrels, and a kick
export const STORM = { r: 5, life: 7, every: 0.8, bolt: 1.8, hit: 15, stun: 1.5 }; // Thunderstorm
export const FREEZE_R = 4.2;

export type CmdKind = "join" | "shot" | "use" | "fire" | "hop" | "brake" | "reset";
export type Cmd = { tick: number; by: string; seq: number; kind: CmdKind; a?: number; p?: number; i?: number; x?: number; y?: number };

export type Mine = { x: number; y: number; live: boolean; fixed: boolean; back: number };
export type Ball = Sim & { id: string; holes: number; color: number };
export type Missile = { x: number; y: number; vx: number; vy: number; target: string; by: string; until: number };
export type Storm = { x: number; y: number; r: number; until: number; next: number };
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
  patches: Patch[]; // ice and honey players put down
  missiles: Missile[];
  storms: Storm[];
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
    patches: [],
    missiles: [],
    storms: [],
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
  b.patches = s.patches;
  b.multi = true;
}
const T = (s: WorldState) => s.tick * DT;
const inPlay = (b: Ball) => b.mode === "aim" || b.mode === "roll";
const shielded = (b: Ball, t: number) => t < b.shieldUntil;
// Knocked away from a point and stunned for a moment, unless an Electromagnet's up.
function hit(b: Ball, from: Vec, speed: number, stun: number, t: number) {
  if (shielded(b, t)) return false;
  blast(b, from.x, from.y, speed);
  b.stunUntil = Math.max(b.stunUntil, t + stun);
  return true;
}
// The first other ball along a line from `from`, within `range`.
function firstOnLine(s: WorldState, me: Ball, from: Vec, dir: Vec, range: number) {
  let best: Ball | null = null, bestAlong = range;
  for (const o of s.balls) {
    if (o === me || !inPlay(o)) continue;
    const rx = o.x - from.x, ry = o.y - from.y;
    const along = rx * dir.x + ry * dir.y;
    if (along <= 0 || along >= bestAlong) continue;
    const off = Math.abs(rx * dir.y - ry * dir.x);
    if (off < o.r + 0.35) (best = o), (bestAlong = along);
  }
  return { ball: best, along: bestAlong };
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
    case "use": {
      const i = cmd.i ?? -1, item = b.bag[i];
      if (b.mode !== "aim") break;
      const t = T(s);
      if (item === "missile") {
        // Locks onto the nearest player in play; with nobody about it stays in the bag.
        let target: Ball | null = null;
        for (const o of s.balls) if (o !== b && inPlay(o) && (!target || hyp(o.x - b.x, o.y - b.y) < hyp(target.x - b.x, target.y - b.y))) target = o;
        if (!target) break;
        b.bag.splice(i, 1);
        const dx = target.x - b.x, dy = target.y - b.y, d = hyp(dx, dy) || 1;
        s.missiles.push({ x: b.x, y: b.y, vx: (dx / d) * MISSILE.speed, vy: (dy / d) * MISSILE.speed, target: target.id, by: b.id, until: t + MISSILE.life });
        s.events.push({ tick: s.tick, id: b.id, ev: { type: "missile", x: b.x, y: b.y, power: 1 } });
      } else if (item === "horn" || item === "flash") {
        // Everyone close by: an Air Horn rattles their next putt, a Flash Camera blinds them.
        b.bag.splice(i, 1);
        for (const o of s.balls) {
          if (o === b || !inPlay(o) || shielded(o, t) || hyp(o.x - b.x, o.y - b.y) > REACH) continue;
          if (item === "horn") o.rattled = true;
          else o.blindUntil = t + BLIND_S;
        }
        s.events.push({ tick: s.tick, id: b.id, ev: { type: item, x: b.x, y: b.y, power: 1 } });
      } else activate(b, i);
      break;
    }
    case "fire": {
      const i = cmd.i ?? -1, item = b.bag[i];
      if (!item || !TARGETED.includes(item) || !Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return;
      const at = { x: cmd.x!, y: cmd.y! };
      const from = { x: b.x, y: b.y };
      const before = b.bag.length;
      fireTargeted(b, c, i, at);
      if (b.bag.length === before) break; // not now (it's rolling)
      const t = T(s);
      const dx0 = at.x - from.x, dy0 = at.y - from.y, d0 = hyp(dx0, dy0) || 1;
      const dir = { x: dx0 / d0, y: dy0 / d0 };
      if (item === "freeze") {
        for (const o of s.balls) if (inPlay(o) && !shielded(o, t) && hyp(o.x - at.x, o.y - at.y) < FREEZE_R) o.frozenUntil = t + FREEZE_S;
      } else if (item === "storm") {
        s.storms.push({ x: at.x, y: at.y, r: STORM.r, until: t + STORM.life, next: t + 0.5 });
      } else if (item === "pistol" || item === "elephant") {
        const g = item === "pistol" ? PISTOL : ELEPHANT;
        const { ball: o, along } = firstOnLine(s, b, from, dir, g.range);
        const end = { x: from.x + dir.x * along, y: from.y + dir.y * along };
        s.events.push({ tick: s.tick, id: b.id, ev: { type: "tracer", x: from.x, y: from.y, x2: end.x, y2: end.y, power: item === "pistol" ? 0.5 : 1 } });
        if (o) {
          // Knocked straight along the shot.
          if (hit(o, { x: o.x - dir.x, y: o.y - dir.y }, g.hit, g.stun, t)) s.events.push({ tick: s.tick, id: o.id, ev: { type: "stun", x: o.x, y: o.y, power: 1 } });
          else s.events.push({ tick: s.tick, id: o.id, ev: { type: "fizzle", x: o.x, y: o.y, power: 1 } });
        }
        if (item === "elephant") {
          // Both barrels: it kicks you backwards too. A way to get somewhere.
          b.vx = -dir.x * ELEPHANT.recoil;
          b.vy = -dir.y * ELEPHANT.recoil;
          b.rest = { x: b.x, y: b.y };
          setMode(b, "roll");
        }
      }
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
      // Not out of an ice cube or a stun, though.
      if ((b.mode === "aim" || b.mode === "roll") && b.t >= b.frozenUntil && b.t >= b.stunUntil) place(b, freeTee(s, c, b.color));
      break;
  }
  drain(s, b);
}

function drain(s: WorldState, b: Ball) {
  for (const ev of b.events) s.events.push({ tick: s.tick, id: b.id, ev });
  b.events.length = 0;
}

const moving = (b: Ball) => b.mode === "roll";
// Whether a moving obstacle could reach a ball sitting at `b`: if not, it can't push it.
function inReach(c: Course, b: Ball) {
  for (const m of c.movers) {
    if (m.kind === "spinner" && hyp(b.x - m.at.x, b.y - m.at.y) < m.L + m.w + b.r + 0.3) return true;
    if (m.kind === "windmill") {
      const q = closest(b, m.mouth[0], m.mouth[1]);
      if (hyp(b.x - q.x, b.y - q.y) < b.r + 0.6) return true;
    }
    if (m.kind === "slider") {
      const q = closest(b, m.a, m.b);
      if (hyp(b.x - q.x, b.y - q.y) < Math.max(m.size.x, m.size.y) + b.r + 0.3) return true;
    }
  }
  return false;
}
const quiet = (s: WorldState, c: Course) =>
  s.strikes.length === 0 && s.missiles.length === 0 && s.storms.length === 0 && s.balls.every((b) => b.mode === "aim" && b.lipT === 0 && !inReach(c, b));


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
  // Ice and honey that have worn off. (Everything that reads them checks the time anyway.)
  for (let i = 0; i < s.patches.length; i++) if (s.patches[i].until <= T(s)) s.patches.splice(i--, 1);
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
  stepStorms(s);
  stepMissiles(s);
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

// Thunderstorms: a bolt somewhere under the cloud every so often, throwing and stunning anyone it lands
// near. Where is the world's own draw, so it's the same everywhere.
function stepStorms(s: WorldState) {
  const t = (s.tick + 1) * DT;
  for (let k = 0; k < s.storms.length; k++) {
    const st = s.storms[k];
    while (t >= st.next && st.next < st.until) {
      const r = rng(s.seed * 7919 + Math.round(st.next * 240) * 31 + Math.round(st.x * 13));
      const a = r() * DTWO_PI, d = Math.sqrt(r()) * st.r;
      const bolt = { x: st.x + dcos(a) * d, y: st.y + dsin(a) * d };
      s.events.push({ tick: s.tick, id: "", ev: { type: "bolt", x: bolt.x, y: bolt.y, power: 1 } });
      for (const o of s.balls) if (inPlay(o) && o.z < 1 && hyp(o.x - bolt.x, o.y - bolt.y) < STORM.bolt) hit(o, bolt, STORM.hit, STORM.stun, t);
      st.next += STORM.every;
    }
    if (t >= st.until) s.storms.splice(k--, 1);
  }
}

// Rocket Launcher missiles: they turn toward their target as they fly (over everything) and throw it
// when they reach it. An Electromagnet pops them; after a while they run out and fizzle.
function stepMissiles(s: WorldState) {
  const t = (s.tick + 1) * DT;
  for (let k = 0; k < s.missiles.length; k++) {
    const m = s.missiles[k];
    const target = s.balls.find((b) => b.id === m.target);
    if (!target || !inPlay(target) || t >= m.until) {
      s.events.push({ tick: s.tick, id: "", ev: { type: "fizzle", x: m.x, y: m.y, power: 1 } });
      s.missiles.splice(k--, 1);
      continue;
    }
    const dx = target.x - m.x, dy = target.y - m.y, d = hyp(dx, dy) || 1;
    const turn = Math.min(1, MISSILE.turn * DT);
    m.vx += ((dx / d) * MISSILE.speed - m.vx) * turn;
    m.vy += ((dy / d) * MISSILE.speed - m.vy) * turn;
    const sp = hyp(m.vx, m.vy) || 1;
    m.vx = (m.vx / sp) * MISSILE.speed;
    m.vy = (m.vy / sp) * MISSILE.speed;
    m.x += m.vx * DT;
    m.y += m.vy * DT;
    if (hyp(target.x - m.x, target.y - m.y) < target.r + 0.5) {
      const ok = hit(target, { x: target.x - m.vx / MISSILE.speed, y: target.y - m.vy / MISSILE.speed }, MISSILE.hit, 1, t);
      s.events.push({ tick: s.tick, id: target.id, ev: { type: ok ? "mine" : "fizzle", x: m.x, y: m.y, power: 1 } });
      s.missiles.splice(k--, 1);
    }
  }
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
export type Packed = Omit<WorldState, "balls" | "events"> & { balls: Omit<Ball, "boxes" | "gone" | "mines" | "strikes" | "patches" | "events">[] };
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
    patches: s.patches.map((m) => ({ ...m })),
    missiles: s.missiles.map((m) => ({ ...m })),
    storms: s.storms.map((m) => ({ ...m })),
    balls: s.balls.map(({ boxes: _b, gone: _g, mines: _m, strikes: _s, patches: _p, events: _e, ...rest }) => structuredClone(rest)),
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
    // Snapshots from before these existed don't have them.
    patches: (p.patches ?? []).map((m) => ({ ...m })),
    missiles: (p.missiles ?? []).map((m) => ({ ...m })),
    storms: (p.storms ?? []).map((m) => ({ ...m })),
    balls: [],
    events: [],
  };
  for (const raw of p.balls) {
    const b = structuredClone(raw) as Ball;
    b.events = [];
    b.shieldUntil ??= 0;
    b.frozenUntil ??= 0;
    b.stunUntil ??= 0;
    b.blindUntil ??= 0;
    b.coffeeUntil ??= 0;
    b.rattled ??= false;
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
  for (const b of s.balls) for (const n of [b.x, b.y, b.vx, b.vy, b.z, b.vz, b.strokes, b.holes, b.r, b.bag.length, b.frozenUntil, b.stunUntil, b.shieldUntil, b.rattled ? 1 : 0]) mix(n);
  for (const m of s.missiles) for (const n of [m.x, m.y]) mix(n);
  for (const m of s.storms) mix(m.next);
  for (const m of s.patches) mix(m.until);
  for (const x of s.boxes) mix(x ? 1 : 0);
  for (const x of s.gone) mix(x ? 1 : 0);
  for (const m of s.mines) mix(m.live ? m.x : -m.x);
  return h >>> 0;
}

export const compileWorld = compile;
export const aimVec = (a: number) => ({ x: dcos(a), y: dsin(a) });
