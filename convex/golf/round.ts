import type { Power, Theme } from "./engine";
import type { Field } from "./distance";
import type { WorldState } from "./world";

// A round of golf in a game (convex/golf.ts): its holes, who's done what on each, and whose turn it is.
// Everything here is plain data and rules; the server applies it.

export type HoleInfo = { name: string; par: number; theme: Theme; open: boolean };
export type GolfState = {
  total: number; // holes in the round
  holes: (HoleInfo | null)[]; // built so far, by number
  hole: number; // the hole being played (0-based), -1 before the first is ready
  worldId: string | null; // its world
  // Strokes on each hole, by seat, once it's done (null for someone who'd resigned by then).
  scores: (number | null)[][];
  // Whether each seat's ball went in on each hole (false: picked up).
  sunk: boolean[][];
  out: number[]; // seats that resigned, in the order they did
  // What each seat carries on to the next hole.
  bags: Power[][];
  // Turn-based: the world tick the turn started on, and where every ball sat then (to tell who got knocked).
  turnTick: number;
  spots: Record<string, [number, number]>;
  // Turns in a row the caddie's had to take for each seat. Three and the caddie takes them all.
  idle: number[];
  order: number[]; // who tees off first on this hole, by seat
  waiting: boolean; // a hole's finished and the next isn't built yet
  // Live: when the hole clock runs out, and when the next hole starts (a moment to see the scores).
  clockAt?: number;
  nextAt?: number;
  // The last thing worth saying, for lists and link previews: "Chris sank it, 3".
  last?: string;
};

export const IDLE_OUT = 3;
// Strokes before a ball's picked up: par plus four.
export const capOf = (par: number) => par + 4;
// How close to the cup a ball sitting still is marked (other balls roll through it).
export const MARK_R = 3.2;

export function newRound(total: number, seats: number): GolfState {
  return {
    total,
    holes: Array.from({ length: total }, () => null),
    hole: -1,
    worldId: null,
    scores: [],
    sunk: [],
    out: [],
    bags: Array.from({ length: seats }, () => []),
    turnTick: 0,
    spots: {},
    idle: Array.from({ length: seats }, () => 0),
    order: Array.from({ length: seats }, (_, i) => i),
    waiting: false,
  };
}

// Who's still playing, by seat.
export const activeSeats = (st: GolfState, seats: number) => Array.from({ length: seats }, (_, i) => i).filter((i) => !st.out.includes(i));

// Honors: who tees off first on hole `n`. The best score on the hole before goes first, ties keeping the
// order they teed off in last time. The first hole goes in seat order (seats are shuffled at the start).
export function honors(st: GolfState, n: number, seats: number): number[] {
  const active = activeSeats(st, seats);
  if (n === 0) return active;
  const prev = st.scores[n - 1] ?? [];
  const before = st.order;
  return [...active].sort((a, b) => (prev[a] ?? 99) - (prev[b] ?? 99) || before.indexOf(a) - before.indexOf(b));
}

// Who goes next on a turn-based hole: anyone who hasn't teed off yet, in honors order, then whoever's
// farthest from the cup by walking distance (real golf's "away" rule). Ties go in honors order.
export function nextUp(s: WorldState, field: Field, seatOfId: (id: string) => number, order: number[]): string | null {
  const balls = s.balls.filter((b) => b.mode === "aim" || b.mode === "roll" || b.mode === "out");
  if (balls.length === 0) return null;
  const rank = (id: string) => order.indexOf(seatOfId(id));
  const fresh = balls.filter((b) => b.strokes === 0).sort((a, b) => rank(a.id) - rank(b.id));
  if (fresh.length) return fresh[0].id;
  const away = balls
    .map((b) => ({ id: b.id, d: field(b.x, b.y) }))
    .sort((a, b) => b.d - a.d || rank(a.id) - rank(b.id));
  return away[0].id;
}

// Everyone's total, by seat.
export const totals = (st: GolfState, seats: number) => Array.from({ length: seats }, (_, i) => st.scores.reduce((a, h) => a + (h[i] ?? 0), 0));
// Par for the holes played so far.
export const parSoFar = (st: GolfState) => st.scores.reduce((a, _, n) => a + (st.holes[n]?.par ?? 0), 0);

// Final places, best first, as groups of seats: fewest strokes wins and ties share a place; anyone who
// resigned comes after everyone who didn't, the first to go last.
export function standings(st: GolfState, seats: number): number[][] {
  const t = totals(st, seats);
  const playing = activeSeats(st, seats).sort((a, b) => t[a] - t[b]);
  const groups: number[][] = [];
  for (const s of playing) {
    const g = groups.at(-1);
    if (g && t[g[0]] === t[s]) g.push(s);
    else groups.push([s]);
  }
  for (const s of [...st.out].reverse()) groups.push([s]);
  return groups;
}

// "+3", "-1", "E": a score against par.
export const vsPar = (strokes: number, par: number) => (strokes === par ? "E" : strokes > par ? `+${strokes - par}` : `${strokes - par}`);
