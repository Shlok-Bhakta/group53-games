import type { Power, Theme } from "./engine";
import type { Field } from "./distance";
import type { WorldState } from "./world";

export type HoleInfo = { name: string; par: number; theme: Theme; open: boolean };
export type GolfState = {
  total: number;
  holes: (HoleInfo | null)[];
  hole: number;
  worldId: string | null;
  scores: (number | null)[][];
  sunk: boolean[][];
  out: number[];
  bags: Power[][];
  turnTick: number;
  spots: Record<string, [number, number]>;
  idle: number[];
  order: number[];
  waiting: boolean;
  builtAt?: number;
  clockAt?: number;
  nextAt?: number;
  last?: string;
};

export const IDLE_OUT = 3;
export const capOf = (par: number) => par + 4;
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

export const activeSeats = (st: GolfState, seats: number) => Array.from({ length: seats }, (_, i) => i).filter((i) => !st.out.includes(i));

export function honors(st: GolfState, n: number, seats: number): number[] {
  const active = activeSeats(st, seats);
  if (n === 0) return active;
  const prev = st.scores[n - 1] ?? [];
  const before = st.order;
  return [...active].sort((a, b) => (prev[a] ?? 99) - (prev[b] ?? 99) || before.indexOf(a) - before.indexOf(b));
}

export function nextUp(s: WorldState, field: Field, seatOfId: (id: string) => number, order: number[]): string | null {
  const balls = s.balls.filter((b) => b.mode === "aim" || b.mode === "roll" || b.mode === "out");
  if (balls.length === 0) return null;
  const rank = (id: string) => order.indexOf(seatOfId(id));
  const fresh = balls.filter((b) => b.strokes === 0).sort((a, b) => rank(a.id) - rank(b.id));
  if (fresh.length) return fresh[0].id;
  const away = balls.map((b) => ({ id: b.id, d: field(b.x, b.y) })).sort((a, b) => b.d - a.d || rank(a.id) - rank(b.id));
  return away[0].id;
}

export const totals = (st: GolfState, seats: number) =>
  Array.from({ length: seats }, (_, i) => st.scores.reduce((a, h) => a + (h[i] ?? 0), 0));
export const parSoFar = (st: GolfState) => st.scores.reduce((a, _, n) => a + (st.holes[n]?.par ?? 0), 0);

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

export const vsPar = (strokes: number, par: number) => (strokes === par ? "E" : strokes > par ? `+${strokes - par}` : `${strokes - par}`);
