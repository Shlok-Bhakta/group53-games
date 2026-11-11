import type { Course, World } from "./engine";
import { datan2, hyp } from "./dmath";
import { distanceField, type Field } from "./distance";
import { advance, applyCmd, newWorld, pack, TPS, unpack, type Packed, type Rules, type WorldState } from "./world";

// A golfer that plays through the real world: before each shot it tries a fan of angles and powers, plays
// each one out, and takes the one that ends nearest the cup by walking distance (distance.ts). It's the
// caddie that shoots for someone whose time ran out (convex/golf.ts), and how the generator (gen.ts)
// proves a hole can be sunk and sets its par.

const MAX_ROLL_S = 12;

export type Try = { a: number; p: number; score: number; sunk: boolean };

// One shot by `id` from `from`: where it ends up, and whether it went in. Nobody else acts meanwhile.
export function tryShot(w: World, from: Packed, id: string, a: number, p: number) {
  const s = unpack(from);
  applyCmd(s, w.course, { tick: s.tick, by: id, seq: 1, kind: "shot", a, p });
  let sunk = false;
  const end = s.tick + MAX_ROLL_S * TPS;
  while (s.tick < end) {
    advance(s, w, Math.min(end, s.tick + TPS / 4), []);
    if (s.events.some((e) => e.ev.type === "sink" && e.id === id)) {
      sunk = true;
      break;
    }
    s.events.length = 0;
    const b = s.balls.find((x) => x.id === id);
    if (!b || (b.mode === "aim" && s.balls.every((o) => o.mode === "aim"))) break;
  }
  s.events.length = 0;
  return { s, sunk };
}

// The best of a fan of shots. `angles` round the full circle, plus a few straight at the cup.
export function bestShot(w: World, from: Packed, id: string, field: Field = distanceField(w.course, w), opts: { angles?: number; powers?: number[] } = {}): Try | null {
  const c = w.course;
  const me = from.balls.find((b) => b.id === id);
  if (!me) return null;
  const n = opts.angles ?? 32;
  const powers = opts.powers ?? [0.12, 0.2, 0.3, 0.42, 0.56, 0.72, 0.88, 1];
  const toCup = datan2(c.cup.y - me.y, c.cup.x - me.x);
  const angles = [...Array.from({ length: n }, (_, i) => -Math.PI + (i * 2 * Math.PI) / n), toCup - 0.06, toCup, toCup + 0.06];
  // Straight at the cup, at about the power that would get there on flat carpet.
  const d = hyp(c.cup.x - me.x, c.cup.y - me.y);
  const near = Math.min(1, Math.sqrt(d / 60) + 0.05);
  let best = null as Try | null;
  const consider = (a: number, p: number) => {
    const { s, sunk } = tryShot(w, from, id, a, p);
    const b = s.balls.find((x) => x.id === id);
    const penalty = b ? Math.max(0, b.strokes - me.strokes - 1) * 6 : 0;
    const score = sunk ? -1 : b ? field(b.x, b.y) + penalty : 1e9;
    if (!best || score < best.score) best = { a, p, score, sunk };
    return sunk;
  };
  for (const p of [near * 0.9, near, near * 1.12]) if (consider(toCup, Math.min(1, p))) return best;
  for (const a of angles) for (const p of powers) if (consider(a, p)) return best;
  return best;
}

// Plays a hole from the tee on its own, greedily, up to `limit` strokes: how many it took, or null if it
// never went in. `shaky` misses each shot by a little, the way people do.
export function playHole(c: Course, w: World, opts: { limit?: number; shaky?: (k: number) => number; angles?: number; powers?: number[] } = {}) {
  const limit = opts.limit ?? 8;
  const field = distanceField(c, w);
  const rules: Rules = { cap: 99, turns: false, knockFree: false, markR: 0 };
  let s: WorldState = newWorld(c, { rules });
  applyCmd(s, c, { tick: 0, by: "bot", seq: 0, kind: "join" });
  for (let stroke = 1; stroke <= limit; stroke++) {
    const from = pack(s);
    const shot = bestShot(w, from, "bot", field, opts);
    if (!shot) return null;
    const a = shot.a + (opts.shaky ? opts.shaky(0) * 0.08 : 0), p = Math.min(1, Math.max(0.05, shot.p * (1 + (opts.shaky ? opts.shaky(1) * 0.08 : 0))));
    const r = tryShot(w, from, "bot", a, p);
    if (r.sunk) return stroke;
    s = r.s;
    if (!s.balls.length) return null;
  }
  return null;
}
