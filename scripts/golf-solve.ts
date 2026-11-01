// Finds a way round every golf hole, to prove each can be sunk and see how hard it is. Run with bun:
//   bun scripts/golf-solve.ts [hole id ...]
// It plays through the real world (convex/golf/world.ts): a beam search over angle and power, scored by
// the walking distance to the cup, then a sloppy player with shaky hands to see what a human might
// shoot. Prints a line per hole, and writes the lines it found to convex/golf/solutions.ts for the test.
import fs from "node:fs";
import { closest, groundAt, HAZARDS, type Course } from "../convex/golf/engine";
import { HOLES, worldOf } from "../convex/golf/holes";
import { rng } from "../convex/golf/engine";
import { start, takeShot as shot } from "../convex/golf/scenarios";
import { pack, type Packed } from "../convex/golf/world";

const ANGLES = 40;
const POWERS = [0.1, 0.16, 0.24, 0.34, 0.46, 0.6, 0.78, 1];
const BEAM = 5;

// Walking distance to the cup over a grid, round rails and water. A cell nothing connects to (an
// island over a gap) falls back to the straight line, plus a toll.
function distanceField(c: Course) {
  const w = worldOf(c);
  const S = 1;
  const W = Math.ceil(c.w / S), H = Math.ceil(c.h / S);
  const d = new Float64Array(W * H).fill(Infinity);
  const ok = (x: number, y: number) => !HAZARDS.includes(groundAt(w, { x, y }));
  const blocked = (ax: number, ay: number, bx: number, by: number) => {
    const m = { x: (ax + bx) / 2, y: (ay + by) / 2 };
    return w.segs.some((s) => {
      if (s.h > 50) return false;
      const q = closest(m, s.a, s.b);
      return Math.hypot(q.x - m.x, q.y - m.y) < s.r + 0.3;
    });
  };
  const start = Math.floor(c.cup.y / S) * W + Math.floor(c.cup.x / S);
  d[start] = 0;
  const queue = [start];
  while (queue.length) {
    const i = queue.shift()!;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (d[j] !== Infinity || !ok(nx + 0.5, ny + 0.5) || blocked(x + 0.5, y + 0.5, nx + 0.5, ny + 0.5)) continue;
      d[j] = d[i] + 1;
      queue.push(j);
    }
  }
  return (x: number, y: number) => {
    const v = d[Math.floor(y / S) * W + Math.floor(x / S)];
    return v === undefined || v === Infinity ? Math.hypot(x - c.cup.x, y - c.cup.y) + 40 : v;
  };
}

type Node = { packed: Packed; shots: [number, number][]; score: number };

function solve(c: Course, depth = 8) {
  const field = distanceField(c);
  let beam: Node[] = [{ packed: start(c), shots: [], score: 1e9 }];
  for (let k = 0; k < depth; k++) {
    const next: Node[] = [];
    for (const n of beam)
      for (let i = 0; i < ANGLES; i++) {
        const a = -Math.PI + (i * 2 * Math.PI) / ANGLES;
        for (const p of POWERS) {
          const { s, sunk } = shot(c, n.packed, a, p);
          if (sunk) return n.shots.concat([[a, p]]);
          const b = s.balls[0];
          next.push({ packed: pack(s), shots: n.shots.concat([[a, p]]), score: field(b.x, b.y) });
        }
      }
    next.sort((x, y) => x.score - y.score);
    // Keep the best few, but not several from the same spot.
    const kept: Node[] = [];
    for (const n of next) {
      const b = n.packed.balls[0];
      if (kept.some((o) => Math.hypot(o.packed.balls[0].x - b.x, o.packed.balls[0].y - b.y) < 2)) continue;
      kept.push(n);
      if (kept.length >= BEAM) break;
    }
    beam = kept;
  }
  return null;
}

// A human-ish player: picks the shot that looks best, then hits it with shaky hands.
function sloppy(c: Course, seed: number, limit = 14) {
  const field = distanceField(c);
  const r = rng(seed);
  let packed = start(c);
  for (let stroke = 1; stroke <= limit; stroke++) {
    let best = { score: Infinity, a: 0, p: 0.5 };
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI + (i * 2 * Math.PI) / 24;
      for (const p of POWERS) {
        const { s, sunk } = shot(c, packed, a, p);
        const score = sunk ? -1 : field(s.balls[0].x, s.balls[0].y);
        if (score < best.score) best = { score, a, p };
      }
    }
    const a = best.a + (r() - 0.5) * 0.12, p = Math.min(1, best.p * (0.9 + r() * 0.2));
    const { s, sunk } = shot(c, packed, a, p);
    if (sunk) return s.balls[0].strokes;
    packed = pack(s);
  }
  return limit + 1;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const noSloppy = process.argv.includes("--fast");
const out: Record<string, [number, number][]> = {};
const path = "convex/golf/solutions.ts";
if (fs.existsSync(path)) {
  const m = fs.readFileSync(path, "utf8").match(/= (\{[\s\S]*\});/);
  if (m) Object.assign(out, JSON.parse(m[1]));
}
for (const c of HOLES) {
  if (only.length && !only.includes(c.id)) continue;
  const t0 = performance.now();
  const line = solve(c);
  const human = noSloppy || !line ? [] : [1, 2, 3, 4].map((seed) => sloppy(c, seed));
  const avg = human.length ? (human.reduce((a, b) => a + b, 0) / human.length).toFixed(1) : "-";
  console.log(`${c.id.padEnd(10)} ${c.name.padEnd(16)} par ${c.par}  solved in ${line ? line.length : "NEVER"}  sloppy ${human.join(",") || "-"} (avg ${avg})  ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  if (line) out[c.id] = line;
  fs.writeFileSync(path, `// A way round every hole, found by scripts/golf-solve.ts and replayed by convex/golf/holes.test.ts, so a\n// hole that can't be sunk any more fails the tests. [angle, power] per shot.\nexport const SOLUTIONS: Record<string, [number, number][]> = ${JSON.stringify(out)};\n`);
}
