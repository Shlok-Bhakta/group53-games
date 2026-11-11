import { closest, groundAt, HAZARDS, nearSegs, type Course, type World } from "./engine";
import { hyp } from "./dmath";

// How far it is to the cup on the ground from anywhere on a hole: round rails, walls and water, the
// way a ball would have to go. It's what "farthest from the cup" means in a turn-based game (convex/golf.ts),
// and how the bots (bot.ts) judge a shot. A spot nothing on the ground connects to (an island over a gap
// in the void, reached off a ramp) falls back to the straight line plus a toll, so it still sorts sensibly.
// Server and scripts only: nothing about it needs to match between phones.

const S = 1; // grid step, in course units
const TOLL = 40;

export type Field = (x: number, y: number) => number;
const cache = new Map<string, Field>();

export function distanceField(c: Course, w: World): Field {
  const hit = cache.get(c.id);
  if (hit) return hit;
  const W = Math.ceil(c.w / S) + 1, H = Math.ceil(c.h / S) + 1;
  const d = new Float64Array(W * H).fill(Infinity);
  const ok = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) ok[j * W + i] = HAZARDS.includes(groundAt(w, { x: (i + 0.5) * S, y: (j + 0.5) * S })) ? 0 : 1;
  // A step's blocked if a wall a ball can't roll over crosses it.
  const blocked = (ax: number, ay: number, bx: number, by: number) => {
    const m = { x: (ax + bx) / 2, y: (ay + by) / 2 };
    for (const s of nearSegs(w, m.x, m.y)) {
      if (s.h > 50) continue;
      const q = closest(m, s.a, s.b);
      if (hyp(q.x - m.x, q.y - m.y) < s.r + 0.3) return true;
    }
    return false;
  };
  const start = Math.floor(c.cup.y / S) * W + Math.floor(c.cup.x / S);
  // Dijkstra on eight neighbours, with a plain binary heap.
  const heap: [number, number][] = [];
  const push = (k: number, i: number) => {
    heap.push([k, i]);
    let n = heap.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (heap[p][0] <= heap[n][0]) break;
      [heap[p], heap[n]] = [heap[n], heap[p]];
      n = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1, r = l + 1;
        let m = n;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === n) break;
        [heap[m], heap[n]] = [heap[n], heap[m]];
        n = m;
      }
    }
    return top;
  };
  if (start >= 0 && start < d.length) {
    d[start] = 0;
    push(0, start);
  }
  const steps: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [k, i] = pop();
    if (k > d[i]) continue;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy, cost] of steps) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!ok[j]) continue;
      // Diagonals only where both sides are open, so it never squeezes between two corners.
      if (dx && dy && (!ok[y * W + nx] || !ok[ny * W + x])) continue;
      const nd = k + cost * S;
      if (nd >= d[j]) continue;
      if (blocked((x + 0.5) * S, (y + 0.5) * S, (nx + 0.5) * S, (ny + 0.5) * S)) continue;
      d[j] = nd;
      push(nd, j);
    }
  }
  const field: Field = (x, y) => {
    const i = Math.floor(x / S), j = Math.floor(y / S);
    const v = i >= 0 && j >= 0 && i < W && j < H ? d[j * W + i] : Infinity;
    return v === Infinity ? hyp(x - c.cup.x, y - c.cup.y) + TOLL : v + hyp(x - (i + 0.5) * S, y - (j + 0.5) * S);
  };
  if (cache.size > 100) cache.clear();
  cache.set(c.id, field);
  return field;
}

// Whether the cup can be reached from `p` on the ground at all.
export const reachable = (f: Field, c: Course, x: number, y: number) => f(x, y) < hyp(x - c.cup.x, y - c.cup.y) + TOLL - 1e-6 || hyp(x - c.cup.x, y - c.cup.y) < 1.5;
