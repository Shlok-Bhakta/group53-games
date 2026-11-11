import { closest, compile, edges, groundAt, HAZARDS, inPoly, rng, v, type Bumper, type Course, type Ground, type Mover, type Portal, type Theme, type Vec, type Wall, type WallStyle, type Zone } from "./engine";
import { datan2, dcos, dsin, hyp } from "./dmath";
import { blob, circle, rect } from "./shapes";
import { withTees } from "./holes";
import { distanceField, reachable } from "./distance";
import { playHole } from "./bot";

// Holes from a seed, in the spirit of the ones made by hand (plains.ts, coldstart.ts), not blobs: a board
// is a few straight pieces with square or gently rounded corners, a curving ribbon, a round green on a stem,
// islands in the void; or, for a fairway hole, a stretch of land in a lake with the fairway mown down the
// middle, rough either side, bunkers, rivers and a bridge. Then a handful of things in the way, each placed
// with room round it: bumpers on the line, baffles from alternate sides, speed pads, water with a way
// round, sand by the cup, ice and snow, a spinning bar, a crate sliding across.
//
// Every hole is checked (nothing in the water that shouldn't be, no sand in a pond, bridges that land on
// both sides, no gap a ball can get wedged in) and then played by the bot (bot.ts) with shaky hands: if it
// can't sink it, or sinks it in one every time, the hole's made again from the next seed. How the bot does
// sets par. Only the server runs this (convex/golf/build.ts), and a game stores what it made, so nothing
// here has to match between phones; it still sticks to the portable math, to keep a seed's holes the same
// wherever it's built.

export type GenOpts = { seed: number; n: number; terrain: number; style: number; hazards: number };
type Rand = { r: () => number; R: (a: number, b: number) => number; pick: <T>(xs: readonly T[]) => T; chance: (p: number) => boolean };
const randOf = (seed: number): Rand => {
  const r = rng(seed);
  return { r, R: (a, b) => a + r() * (b - a), pick: (xs) => xs[Math.floor(r() * xs.length)], chance: (p) => r() < p };
};
const mix = (...n: number[]) => {
  let h = 2166136261;
  for (const x of n) h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0;
  return h >>> 0;
};

// --- Shapes, drawn into a signed field (positive inside) and traced round ---

const G = 0.25; // field resolution
type Sdf = (x: number, y: number) => number;
class Field {
  readonly a: Float32Array;
  constructor(readonly x0: number, readonly y0: number, readonly nx: number, readonly ny: number) {
    this.a = new Float32Array(nx * ny).fill(-99);
  }
  // Union (max) or cut (min with the negation) a shape over its bounding box.
  apply(bb: [number, number, number, number], f: Sdf, cut = false) {
    const i0 = Math.max(0, Math.floor((bb[0] - 1 - this.x0) / G)), i1 = Math.min(this.nx - 1, Math.ceil((bb[2] + 1 - this.x0) / G));
    const j0 = Math.max(0, Math.floor((bb[1] - 1 - this.y0) / G)), j1 = Math.min(this.ny - 1, Math.ceil((bb[3] + 1 - this.y0) / G));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i, d = f(this.x0 + i * G, this.y0 + j * G);
        this.a[k] = cut ? Math.min(this.a[k], -d) : Math.max(this.a[k], d);
      }
  }
}

// A box along a→b, `hw` either side, running on past each end by `ea` and `eb`, corners rounded by `round`.
function box(a: Vec, b: Vec, hw: number, ea: number, eb: number, round = 0): { bb: [number, number, number, number]; f: Sdf } {
  const dx = b.x - a.x, dy = b.y - a.y, L = hyp(dx, dy) || 1e-9;
  const ux = dx / L, uy = dy / L;
  const half = (L + ea + eb) / 2, mid = (eb - ea) / 2 + L / 2;
  const f: Sdf = (x, y) => {
    const px = x - a.x, py = y - a.y;
    const qx = Math.abs(px * ux + py * uy - mid) - (half - round), qy = Math.abs(-px * uy + py * ux) - (hw - round);
    return -(hyp(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - round);
  };
  const r = Math.max(hw, ea, eb) + 1;
  return { bb: [Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r], f };
}
const disk = (c: Vec, rad: number): { bb: [number, number, number, number]; f: Sdf } => ({ bb: [c.x - rad, c.y - rad, c.x + rad, c.y + rad], f: (x, y) => rad - hyp(x - c.x, y - c.y) });
const capsule = (a: Vec, b: Vec, ra: number, rb: number): { bb: [number, number, number, number]; f: Sdf } => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-9, m = Math.max(ra, rb);
  return {
    bb: [Math.min(a.x, b.x) - m, Math.min(a.y, b.y) - m, Math.max(a.x, b.x) + m, Math.max(a.y, b.y) + m],
    f: (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      return ra + (rb - ra) * t - hyp(x - a.x - dx * t, y - a.y - dy * t);
    },
  };
};

// The outline of the field's inside as closed loops (marching squares), tidied.
function trace(F: Field): Vec[][] {
  const { nx, ny, a } = F;
  const val = (i: number, j: number) => a[j * nx + i];
  const H = (i: number, j: number) => j * nx + i, V = (i: number, j: number) => nx * ny + j * nx + i;
  const pts = new Map<number, Vec>();
  const links = new Map<number, number[]>();
  const point = (e: number) => {
    let p = pts.get(e);
    if (p) return p;
    const vert = e >= nx * ny, k = vert ? e - nx * ny : e, i = k % nx, j = Math.floor(k / nx);
    const v0 = val(i, j), v1 = vert ? val(i, j + 1) : val(i + 1, j);
    const t = Math.max(0, Math.min(1, -v0 / (v1 - v0 || 1e-9)));
    p = vert ? v(F.x0 + i * G, F.y0 + (j + t) * G) : v(F.x0 + (i + t) * G, F.y0 + j * G);
    pts.set(e, p);
    return p;
  };
  const link = (e1: number, e2: number) => {
    for (const [x, y] of [[e1, e2], [e2, e1]]) {
      const l = links.get(x);
      if (l) l.push(y);
      else links.set(x, [y]);
    }
  };
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const tl = val(i, j) > 0, tr = val(i + 1, j) > 0, br = val(i + 1, j + 1) > 0, bl = val(i, j + 1) > 0;
      const c = (+tl << 3) | (+tr << 2) | (+br << 1) | +bl;
      if (c === 0 || c === 15) continue;
      const T = H(i, j), B = H(i, j + 1), L = V(i, j), R = V(i + 1, j);
      const mid = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > 0;
      switch (c) {
        case 1: case 14: link(L, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(L, R); break;
        case 4: case 11: link(T, R); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(T, L); break;
        case 5: if (mid) (link(T, L), link(B, R)); else (link(T, R), link(L, B)); break;
        case 10: if (mid) (link(T, R), link(L, B)); else (link(T, L), link(B, R)); break;
      }
    }
  const loops: Vec[][] = [];
  const seen = new Set<number>();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec[] = [];
    let prev = -1, cur = start;
    for (let guard = 0; guard < 200000; guard++) {
      seen.add(cur);
      loop.push(point(cur));
      const nexts = links.get(cur) ?? [];
      const nxt = nexts.find((x) => x !== prev && !seen.has(x)) ?? nexts.find((x) => x !== prev);
      if (nxt === undefined || nxt === start) break;
      prev = cur;
      cur = nxt;
    }
    if (loop.length >= 6) loops.push(simplify(loop, 0.04));
  }
  // Specks too small to stand on aren't worth a rail.
  return loops.filter((l) => Math.abs(area(l)) > 4);
}
function area(p: Vec[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
// Ramer-Douglas-Peucker on a closed loop: straight runs become two points, curves keep their shape.
function simplify(loop: Vec[], eps: number): Vec[] {
  const rdp = (pts: Vec[]): Vec[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    let best = -1, bi = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const q = closest(pts[i], a, b), d = hyp(pts[i].x - q.x, pts[i].y - q.y);
      if (d > best) (best = d), (bi = i);
    }
    if (best <= eps) return [a, b];
    return [...rdp(pts.slice(0, bi + 1)).slice(0, -1), ...rdp(pts.slice(bi))];
  };
  // Split at the point farthest from the first, so both halves are open runs.
  let far = 0, fd = -1;
  for (let i = 0; i < loop.length; i++) {
    const d = hyp(loop[i].x - loop[0].x, loop[i].y - loop[0].y);
    if (d > fd) (fd = d), (far = i);
  }
  const one = rdp(loop.slice(0, far + 1)), two = rdp([...loop.slice(far), loop[0]]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

// --- The way through ---

// The centreline from tee to cup, one point a unit, each with its half width and heading.
type Sample = Vec & { hw: number; dx: number; dy: number };
function along(pts: (Vec & { hw: number })[]): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = hyp(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(L));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hw: a.hw + (b.hw - a.hw) * t, dx: (b.x - a.x) / (L || 1), dy: (b.y - a.y) / (L || 1) });
    }
  }
  const last = pts[pts.length - 1], prev = out[out.length - 1];
  out.push({ ...last, dx: prev?.dx ?? 0, dy: prev?.dy ?? -1 });
  return out;
}
// A smooth curve through control points (Catmull-Rom), for ribbons.
function curve(ctl: (Vec & { hw: number })[], per = 6): (Vec & { hw: number })[] {
  const at = (i: number) => ctl[Math.max(0, Math.min(ctl.length - 1, i))];
  const out: (Vec & { hw: number })[] = [];
  for (let i = 0; i < ctl.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), hw: p1.hw + (p2.hw - p1.hw) * t });
    }
  }
  out.push(ctl[ctl.length - 1]);
  return out;
}

// What a shape lays out: the board, the way through it, and where there's room for things.
type Leg = { a: Vec; b: Vec; hw: number };
type Layout = {
  kind: string; // for the name
  path: Sample[];
  legs: Leg[]; // straight runs, for baffles and crates
  rooms: { c: Vec; r: number }[]; // open spaces, for bumpers, spinners and ponds
  draw: (F: Field) => void;
  walls?: Wall[];
  bumpers?: Bumper[];
  zones?: Zone[];
  ramps?: boolean; // islands joined by ramps: the ground doesn't connect
  noObstacles?: boolean; // the shape's already the obstacle (a crown of bumpers)
};

// The shapes. Up the screen is -y. Sizes are like the hand-made holes': a lane's 6 to 10 wide.
const L = {
  // Straight up, maybe wider in the middle.
  straight: ({ R, chance }: Rand, len: number): Layout => {
    const w = R(3.5, 5), Lh = 18 + len * 16;
    const bulge = chance(0.5) ? R(1.5, 4) : 0;
    const legs = [{ a: v(0, 0), b: v(0, -Lh), hw: w }];
    return {
      kind: "straight",
      path: along([{ x: 0, y: 0, hw: w }, { x: 0, y: -Lh, hw: w }]),
      legs,
      rooms: bulge ? [{ c: v(0, -Lh / 2), r: w + bulge - 1.5 }] : [],
      draw: (F) => {
        const b = box(v(0, 0), v(0, -Lh), w, 2.8, 2.8, R(0.5, 1.5));
        F.apply(b.bb, b.f);
        if (bulge) {
          const d = chance(0.5) ? disk(v(0, -Lh / 2), w + bulge) : box(v(0, -Lh / 2 + 4), v(0, -Lh / 2 - 4), w + bulge, 0, 0, 1.5);
          F.apply(d.bb, d.f);
        }
      },
    };
  },
  // Up, then a square turn to one side.
  dogleg: ({ R, pick }: Rand, len: number): Layout => {
    const w1 = R(3.5, 4.8), w2 = R(3.5, 4.8), side = pick([-1, 1]);
    const L1 = 14 + len * 12, L2 = 10 + len * 8;
    const j = v(0, -L1), end = v(side * L2, -L1);
    const round = R(0.3, 1.2);
    return {
      kind: "dogleg",
      path: along([{ x: 0, y: 0, hw: w1 }, { ...j, hw: w1 }, { ...end, hw: w2 }]),
      legs: [{ a: v(0, 0), b: j, hw: w1 }, { a: j, b: end, hw: w2 }],
      rooms: [{ c: j, r: Math.min(w1, w2) }],
      draw: (F) => {
        for (const b of [box(v(0, 0), j, w1, 2.8, w2, round), box(j, end, w2, w1, 2.8, round)]) F.apply(b.bb, b.f);
      },
    };
  },
  // Up, across, up again: a Z.
  zbend: ({ R, pick }: Rand, len: number): Layout => {
    const w = R(3.4, 4.5), side = pick([-1, 1]);
    const L1 = 9 + len * 6, L2 = 9 + len * 6, L3 = 9 + len * 6;
    const a = v(0, 0), b = v(0, -L1), c = v(side * L2, -L1), d = v(side * L2, -L1 - L3);
    const round = R(0.3, 1);
    return {
      kind: "zbend",
      path: along([{ ...a, hw: w }, { ...b, hw: w }, { ...c, hw: w }, { ...d, hw: w }]),
      legs: [{ a, b, hw: w }, { a: b, b: c, hw: w }, { a: c, b: d, hw: w }],
      rooms: [],
      draw: (F) => {
        for (const x of [box(a, b, w, 2.8, w, round), box(b, c, w, w, w, round), box(c, d, w, w, 2.8, round)]) F.apply(x.bb, x.f);
      },
    };
  },
  // Up one lane, over the top and back down the other, past a gap in the void.
  hairpin: ({ R, pick }: Rand, len: number): Layout => {
    const w = R(3.2, 4.2), gap = R(1.5, 4), side = pick([-1, 1]);
    const Lh = 16 + len * 12, D = (2 * w + gap) * side, top = -Lh;
    const a = v(0, 0), b = v(0, top), c = v(D, top), d = v(D, -2);
    return {
      kind: "hairpin",
      path: along([{ ...a, hw: w }, { ...b, hw: w }, { ...c, hw: w }, { ...d, hw: w }]),
      legs: [{ a, b, hw: w }, { a: c, b: d, hw: w }],
      rooms: [{ c: v(D / 2, top), r: w }],
      draw: (F) => {
        const r = R(0.5, 2.5);
        for (const x of [box(a, b, w, 2.8, w, r), box(b, c, w, w, w, r), box(c, d, w, w, 2.8, r)]) F.apply(x.bb, x.f);
      },
    };
  },
  // A ribbon that curves one way and back.
  snake: ({ R, pick }: Rand, len: number): Layout => {
    const w = R(3.2, 4.2), side = pick([-1, 1]), Lh = 22 + len * 14, sway = R(4, 8);
    const ctl = [{ x: 0, y: 0, hw: w }, { x: side * sway, y: -Lh * 0.33, hw: w }, { x: -side * sway, y: -Lh * 0.66, hw: w }, { x: side * R(0, 3), y: -Lh, hw: w + R(0, 1.5) }];
    const pts = curve(ctl);
    return {
      kind: "snake",
      path: along(pts),
      legs: [],
      rooms: [],
      draw: (F) => {
        for (let i = 1; i < pts.length; i++) {
          const x = capsule(pts[i - 1], pts[i], pts[i - 1].hw, pts[i].hw);
          F.apply(x.bb, x.f);
        }
        const t = box(v(0, 2.5), v(0, -2), w, 0.5, 0.5, 1);
        F.apply(t.bb, t.f);
      },
    };
  },
  // A stem up to a round green, with a ring of bumpers round the cup whose gap faces away from you.
  crown: ({ R, r }: Rand, len: number): Layout => {
    const stem = R(2.8, 3.5), Lh = 12 + len * 10, rad = R(7.5, 9.5), c = v(0, -Lh - rad + 1.5);
    const ring = rad * R(0.42, 0.5), n = 8, gapAt = Math.PI / 2 + (r() - 0.5) * 1.2; // the gap: round the back
    const bumpers: Bumper[] = [];
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / n;
      const da = Math.abs(((a - (-gapAt) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < 0.5) continue;
      bumpers.push({ at: v(c.x + dcos(a) * ring, c.y + dsin(a) * ring), r: 0.8, kick: 5 });
    }
    return {
      kind: "crown",
      path: along([{ x: 0, y: 0, hw: stem }, { x: 0, y: -Lh, hw: stem }, { ...c, hw: 3 }]),
      legs: [{ a: v(0, 0), b: v(0, -Lh + 2), hw: stem }],
      rooms: [],
      bumpers,
      noObstacles: true,
      draw: (F) => {
        const s = box(v(0, 0), v(0, -Lh), stem, 2.8, 2, 0.8);
        F.apply(s.bb, s.f);
        const d = disk(c, rad);
        F.apply(d.bb, d.f);
      },
    };
  },
  // A wide table: room for a pinball field of bumpers.
  table: ({ R }: Rand, len: number): Layout => {
    const hw = R(6.5, 9), Lh = 20 + len * 10;
    return {
      kind: "table",
      path: along([{ x: 0, y: 0, hw: 3.5 }, { x: 0, y: -Lh, hw: 3.5 }]),
      legs: [],
      rooms: [{ c: v(0, -Lh * 0.5), r: hw - 2 }, { c: v(0, -Lh * 0.25), r: hw - 2.5 }, { c: v(0, -Lh * 0.75), r: hw - 2.5 }],
      draw: (F) => {
        const b = box(v(0, 0), v(0, -Lh), hw, 3, 3, R(2, 4));
        F.apply(b.bb, b.f);
      },
    };
  },
  // Islands in the void, each with a speed pad and a ramp pointing at the next.
  islands: ({ R, pick }: Rand, len: number): Layout => {
    const n = len > 0.5 ? 3 : 2;
    const pts: (Vec & { hw: number })[] = [];
    const isl: { a: Vec; b: Vec; hw: number }[] = [];
    let y = 0, x = 0;
    const zones: Zone[] = [];
    for (let k = 0; k < n; k++) {
      const hw = R(3.8, 5), Lk = k === n - 1 ? R(9, 12) : R(10, 13);
      const a = v(x, y), b = v(x, y - Lk);
      isl.push({ a, b, hw });
      pts.push({ ...a, hw }, { ...b, hw });
      if (k < n - 1) {
        zones.push({ kind: "boost", poly: rect(x - 1.3, b.y + 4.2, 2.6, 2.6), dir: v(0, -1), strength: 45 }, { kind: "ramp", poly: rect(x - 1.5, b.y - 1.2, 3, 3), dir: v(0, -1), lift: 0.6 });
        y = b.y - R(4, 6) - 2.8 * 2;
        x += pick([-1, 0, 1]) * R(0, 2.5);
      }
    }
    return {
      kind: "islands",
      path: along(pts),
      legs: [],
      rooms: [],
      zones,
      ramps: true,
      draw: (F) => {
        for (const s of isl) {
          const b = box(s.a, s.b, s.hw, 2.8, 2.8, R(0.5, 2));
          F.apply(b.bb, b.f);
        }
      },
    };
  },
  // A diagonal zigzag: legs at 45 degrees, rounded where they meet.
  zigzag: ({ R, pick }: Rand, len: number): Layout => {
    const w = R(3.3, 4.2), side = pick([-1, 1]), step = 8 + len * 5, legs = len > 0.5 ? 3 : 2;
    const pts: (Vec & { hw: number })[] = [{ x: 0, y: 0, hw: w }, { x: 0, y: -4, hw: w }];
    let x = 0, y = -4;
    for (let k = 0; k < legs; k++) {
      x += (k % 2 ? -side : side) * step;
      y -= step;
      pts.push({ x, y, hw: w });
    }
    pts.push({ x, y: y - 4, hw: w });
    return {
      kind: "zigzag",
      path: along(pts),
      legs: pts.slice(1, -1).map((p, i) => ({ a: p, b: pts[i + 2], hw: w })).slice(0, legs),
      rooms: [],
      draw: (F) => {
        for (let i = 1; i < pts.length; i++) {
          const b = box(pts[i - 1], pts[i], w, i === 1 ? 2.8 : 0, i === pts.length - 1 ? 2.8 : 0, 0);
          F.apply(b.bb, b.f);
        }
        for (const p of pts.slice(1, -1)) {
          const d = disk(p, w);
          F.apply(d.bb, d.f);
        }
      },
    };
  },
};
const MINI = ["straight", "dogleg", "zbend", "hairpin", "snake", "crown", "table", "islands", "zigzag"] as const;

// --- Things in the way ---

type Build = {
  rand: Rand;
  ice: boolean;
  open: boolean; // a fairway hole: no rails
  hazards: number; // 0 few, 1 some, 2 lots
  lay: Layout;
  inside: (p: Vec, margin?: number) => boolean; // on the board, with room
  bumpers: Bumper[];
  walls: Wall[];
  zones: Zone[];
  movers: Mover[];
  mines: Vec[];
  portals: Portal[];
  boxes: Vec[];
  taken: { c: Vec; r: number }[]; // what's already there, to keep clear of
};
const free = (b: Build, p: Vec, r: number) => b.taken.every((t) => hyp(t.c.x - p.x, t.c.y - p.y) > t.r + r) && b.inside(p, r);
const take = (b: Build, p: Vec, r: number) => b.taken.push({ c: p, r });
// A point on the path a fraction of the way along, nudged across it by `off` (in half widths).
function onPath(b: Build, t: number, off = 0) {
  const P = b.lay.path, s = P[Math.max(0, Math.min(P.length - 1, Math.round(t * (P.length - 1))))];
  return { p: v(s.x - s.dy * off * s.hw, s.y + s.dx * off * s.hw), s };
}

const OBSTACLES: Record<string, (b: Build) => boolean> = {
  // A bumper right on the line, a little to one side, so there's a way past on the other.
  bumper: (b) => {
    const { p } = onPath(b, b.rand.R(0.3, 0.75), b.rand.R(-0.35, 0.35));
    const r = b.rand.R(0.75, 1.1);
    if (!free(b, p, r + 1.6)) return false;
    b.bumpers.push({ at: p, r, kick: 5 });
    take(b, p, r + 0.4);
    return true;
  },
  // A little cluster in an open space: a triangle, or a pair.
  cluster: (b) => {
    const room = b.lay.rooms.length ? b.rand.pick(b.lay.rooms) : null;
    if (!room || room.r < 3) return false;
    const n = b.rand.pick([2, 3, 3, 4]), rad = Math.min(room.r - 1.2, b.rand.R(2.2, 3.5)), a0 = b.rand.R(0, Math.PI * 2);
    const pts = Array.from({ length: n }, (_, k) => v(room.c.x + dcos(a0 + (k * Math.PI * 2) / n) * rad, room.c.y + dsin(a0 + (k * Math.PI * 2) / n) * rad));
    if (!pts.every((p) => free(b, p, 2.1))) return false;
    for (const p of pts) {
      b.bumpers.push({ at: p, r: 0.8, kick: 5 });
      take(b, p, 1.2);
    }
    return true;
  },
  // A baffle across a straight leg from one side, leaving a gap at the other. Two make a chicane.
  baffle: (b) => {
    const legs = b.lay.legs.filter((l) => hyp(l.b.x - l.a.x, l.b.y - l.a.y) > 12);
    if (!legs.length || b.open) return false;
    const leg = b.rand.pick(legs), n = b.rand.chance(0.5) ? 2 : 1;
    const dx = leg.b.x - leg.a.x, dy = leg.b.y - leg.a.y, Lg = hyp(dx, dy), ux = dx / Lg, uy = dy / Lg;
    let side = b.rand.pick([-1, 1]);
    const made: Wall[] = [];
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? b.rand.R(0.4, 0.6) : k === 0 ? 0.35 : 0.68;
      const c = v(leg.a.x + dx * t, leg.a.y + dy * t);
      const cover = leg.hw * 2 * b.rand.R(0.55, 0.68);
      // From the wall on `side` inwards.
      // From the rail itself (a touch inside it, so it joins), never out past it.
      const edge = v(c.x - uy * side * (leg.hw - 0.1), c.y + ux * side * (leg.hw - 0.1));
      const tip = v(edge.x + uy * side * cover, edge.y - ux * side * cover);
      if (!free(b, c, 1)) return false;
      made.push({ pts: [edge, tip], w: 0.5, h: 0.6, style: b.ice ? "ice" : "wood" });
      side = -side;
    }
    b.walls.push(...made);
    for (const w of made) take(b, w.pts[1], 1.4);
    return true;
  },
  // A speed pad along the way: quick, if you're lined up.
  pad: (b) => {
    const { p, s } = onPath(b, b.rand.R(0.15, 0.55), b.rand.R(-0.3, 0.3));
    if (!free(b, p, 1.9)) return false;
    b.zones.push({ kind: "boost", poly: rect(p.x - 1.3, p.y - 1.3, 2.6, 2.6), dir: v(Math.round(s.dx * 1e6) / 1e6, Math.round(s.dy * 1e6) / 1e6), strength: 45 });
    take(b, p, 1.9);
    return true;
  },
  // Sand by the cup (snow on ice): a brake in the wrong place.
  sand: (b) => {
    const { p } = onPath(b, b.rand.R(0.78, 0.9), b.rand.pick([-0.6, 0.6]));
    const rx = b.rand.R(1.4, 2.4), ry = b.rand.R(1.2, 2);
    if (!free(b, p, Math.max(rx, ry) + 0.4)) return false;
    b.zones.push({ kind: b.ice ? "snow" : "sand", poly: blob(p.x, p.y, rx, ry, Math.floor(b.rand.R(1, 99)), 0.12, 20) });
    take(b, p, Math.max(rx, ry));
    return true;
  },
  // A pond on one side of the way, with the other side open.
  pond: (b) => {
    const { p, s } = onPath(b, b.rand.R(0.3, 0.7), 0);
    if (s.hw < 3.4) return false;
    const side = b.rand.pick([-1, 1]), cover = s.hw * b.rand.R(0.8, 1.1);
    const c = v(p.x - s.dy * side * (s.hw - cover / 2 + 0.6), p.y + s.dx * side * (s.hw - cover / 2 + 0.6));
    const len = b.rand.R(3, 6);
    if (!free(b, c, cover / 2 + 0.6)) return false;
    const ang = datan2(s.dy, s.dx);
    const poly = blob(0, 0, len / 2, cover / 2, Math.floor(b.rand.R(1, 99)), 0.1, 24).map((q) => v(c.x + q.x * dcos(ang) - q.y * dsin(ang), c.y + q.x * dsin(ang) + q.y * dcos(ang)));
    b.zones.push({ kind: "water", poly });
    take(b, c, Math.max(len, cover) / 2 + 0.6);
    return true;
  },
  // A sheet of ice across the way (on grass it's a shock).
  ice: (b) => {
    const { p, s } = onPath(b, b.rand.R(0.3, 0.7), 0);
    const len = b.rand.R(4, 9);
    if (!b.taken.every((t) => hyp(t.c.x - p.x, t.c.y - p.y) > t.r + 1)) return false;
    const ang = datan2(s.dy, s.dx), hw = s.hw + 1;
    const poly = [v(-len / 2, -hw), v(len / 2, -hw), v(len / 2, hw), v(-len / 2, hw)].map((q) => v(p.x + q.x * dcos(ang) - q.y * dsin(ang), p.y + q.x * dsin(ang) + q.y * dcos(ang)));
    b.zones.push({ kind: "ice", poly });
    return true;
  },
  // A bar spinning in an open space.
  spinner: (b) => {
    const room = b.lay.rooms.find((r) => r.r >= 3.6);
    if (!room || b.movers.length) return false;
    const L = Math.min(room.r - 0.9, b.rand.R(2.6, 3.6));
    if (!free(b, room.c, L + 0.6)) return false;
    b.movers.push({ kind: "spinner", at: room.c, L, arms: b.rand.pick([2, 3]), omega: b.rand.pick([-1, 1]) * b.rand.R(1.2, 2), w: 0.4 });
    take(b, room.c, L + 0.6);
    return true;
  },
  // A crate sliding across a straight leg.
  crate: (b) => {
    const legs = b.lay.legs.filter((l) => hyp(l.b.x - l.a.x, l.b.y - l.a.y) > 10);
    if (!legs.length || b.movers.length || b.open) return false;
    const leg = b.rand.pick(legs), t = b.rand.R(0.4, 0.65);
    const dx = leg.b.x - leg.a.x, dy = leg.b.y - leg.a.y, Lg = hyp(dx, dy), ux = dx / Lg, uy = dy / Lg;
    const c = v(leg.a.x + dx * t, leg.a.y + dy * t);
    if (!free(b, c, 2.2)) return false;
    const reach = leg.hw - 1.1;
    b.movers.push({ kind: "slider", a: v(c.x - uy * reach, c.y + ux * reach), b: v(c.x + uy * reach, c.y - ux * reach), size: v(Math.abs(ux) > 0.5 ? 1.6 : 1.4, Math.abs(ux) > 0.5 ? 1.4 : 1.6), period: b.rand.R(2.6, 4), phase: b.rand.r() });
    take(b, c, 2);
    return true;
  },
  // A slope pushing sideways across the way.
  slope: (b) => {
    const { p, s } = onPath(b, b.rand.R(0.3, 0.7), 0);
    if (!b.taken.every((t) => hyp(t.c.x - p.x, t.c.y - p.y) > t.r + 1)) return false;
    const side = b.rand.pick([-1, 1]), len = b.rand.R(5, 9), hw = s.hw + 1, ang = datan2(s.dy, s.dx);
    const poly = [v(-len / 2, -hw), v(len / 2, -hw), v(len / 2, hw), v(-len / 2, hw)].map((q) => v(p.x + q.x * dcos(ang) - q.y * dsin(ang), p.y + q.x * dsin(ang) + q.y * dcos(ang)));
    b.zones.push({ kind: "slope", poly, dir: v(-s.dy * side, s.dx * side), strength: b.rand.R(4, 7) });
    return true;
  },
  // A hill on the way to the cup, or a bowl round it.
  mound: (b) => {
    const bowl = b.rand.chance(0.5);
    const { p } = bowl ? { p: b.lay.path[b.lay.path.length - 1] } : onPath(b, b.rand.R(0.4, 0.7), b.rand.R(-0.3, 0.3));
    const radius = b.rand.R(2.5, 4);
    if (!bowl && !free(b, p, 1)) return false;
    b.zones.push({ kind: "mound", poly: circle(p.x, p.y, radius, 20), center: p, radius, strength: bowl ? -b.rand.R(3, 5) : b.rand.R(5, 9) });
    return true;
  },
  // Mines, a few, off the middle of the way.
  mines: (b) => {
    let n = 0;
    for (let k = 0; k < 12 && n < 3; k++) {
      const { p } = onPath(b, b.rand.R(0.25, 0.8), b.rand.R(-0.8, 0.8));
      if (!free(b, p, 1.6)) continue;
      b.mines.push(p);
      take(b, p, 1.3);
      n++;
    }
    return n > 0;
  },
};
// What each kind of hole can have, roughly in order of how often.
const MENU_MINI = ["bumper", "bumper", "baffle", "pad", "sand", "pond", "cluster", "slope", "mound", "spinner", "crate", "ice", "mines"];
const MENU_ICE = ["bumper", "ice", "ice", "baffle", "sand", "pond", "slope", "cluster", "pad", "mound", "crate", "spinner"];

// --- Fairway holes ---

// A stretch of land with the fairway down the middle: rough either side, the green round the cup, bunkers,
// maybe a river with a bridge and a pond. In a lake, or floating in the void with no rail.
function fairway(rand: Rand, len: number, ice: boolean, hazards: number) {
  const { R, pick, chance } = rand;
  // A full putt rolls about 70 on the fairway: two or three of those makes a par 4 or 5.
  const Lh = 75 + len * 85, hw = R(3.6, 5);
  const bends = chance(0.3) ? 0 : chance(0.6) ? 1 : 2;
  const ctl: (Vec & { hw: number })[] = [{ x: 0, y: 0, hw }];
  let side = pick([-1, 1]);
  for (let k = 1; k <= bends + 1; k++) {
    const y = (-Lh * k) / (bends + 1);
    const x = k === bends + 1 ? ctl[ctl.length - 1].x + side * R(0, 6) : side * R(6, 14);
    ctl.push({ x, y, hw: k === bends + 1 ? hw + 0.5 : hw });
    side = -side;
  }
  const pts = curve(ctl, 8);
  const path = along(pts);
  const cup = path[path.length - 1];
  const tee = path[0];
  const rough = R(3.5, 6.5);
  const zones: Zone[] = [];
  // The fairway itself.
  const fw = (F: Field, extra: number, cut = false) => {
    for (let i = 1; i < pts.length; i++) {
      const c = capsule(pts[i - 1], pts[i], pts[i - 1].hw + extra, pts[i].hw + extra);
      F.apply(c.bb, c.f, cut);
    }
  };
  return { path, pts, rough, zones, tee, cup, fw, Lh, hazards, bends };
}

// --- Names ---

const GRASS_A = ["Maple", "Heron", "Willow", "Clover", "Foxglove", "Bramble", "Thistle", "Juniper", "Meadow", "Badger", "Kestrel", "Fern", "Mossy", "Oak", "Wren", "Lark", "Hazel", "Sorrel", "Pebble", "Duck"];
const GRASS_B = ["Bend", "Run", "Crossing", "Hollow", "Rise", "Dell", "Green", "Glen", "Reach", "Turn", "Brook", "Way", "Knoll", "Corner", "Lane", "Links"];
const ICE_A = ["Frost", "Glacier", "Sleet", "Rime", "Polar", "Tundra", "Icicle", "Blizzard", "Floe", "Snowdrift", "Permafrost", "Hoarfrost", "Igloo", "Yeti", "Penguin", "Fjord"];
const ICE_B = ["Bend", "Run", "Slide", "Shelf", "Pass", "Field", "Drop", "Sheet", "Ridge", "Spill", "Rink", "Trail"];
const KIND: Record<string, string[]> = {
  straight: ["Straight", "Runway", "Hello", "Main Street"],
  dogleg: ["Elbow", "Dogleg", "Corner"],
  zbend: ["Zed", "Detour", "Switch"],
  hairpin: ["Hairpin", "U-Turn", "Uturn", "Boomerang"],
  snake: ["Snake", "Wiggle", "Ribbon", "Squiggle"],
  crown: ["Crown", "Castle", "Moat", "Fortress"],
  table: ["Tilt", "Pinball", "Arcade", "Flipper"],
  islands: ["Island Hop", "Archipelago", "Leap", "Gap Year"],
  zigzag: ["Zigzag", "Lightning", "Stairs"],
  fairway: ["Links", "Fairway", "Long Drive", "The Course"],
};
function nameOf(rand: Rand, kind: string, ice: boolean) {
  if (rand.chance(0.4)) return rand.pick(KIND[kind] ?? KIND.straight);
  return `${rand.pick(ice ? ICE_A : GRASS_A)} ${rand.pick(ice ? ICE_B : GRASS_B)}`;
}

// --- Putting it together ---

const THEME = (ice: boolean): Theme => (ice ? "ice" : "hills");
const WALL = (ice: boolean): WallStyle => (ice ? "ice" : "wood");

// Moves everything on a hole by (dx, dy).
function shift(c: Course, dx: number, dy: number): Course {
  const m = (p: Vec) => v(p.x + dx, p.y + dy);
  const mp = (ps: Vec[]) => ps.map(m);
  return {
    ...c,
    tee: m(c.tee),
    cup: m(c.cup),
    greens: c.greens.map((g) => ({ ...g, poly: mp(g.poly) })),
    zones: c.zones.map((z) => (z.kind === "mound" ? { ...z, poly: mp(z.poly), center: m(z.center) } : { ...z, poly: mp(z.poly) })),
    walls: c.walls.map((w) => ({ ...w, pts: mp(w.pts) })),
    bumpers: c.bumpers.map((b) => ({ ...b, at: m(b.at) })),
    movers: c.movers.map((mv) => (mv.kind === "spinner" ? { ...mv, at: m(mv.at) } : mv.kind === "slider" ? { ...mv, a: m(mv.a), b: m(mv.b) } : { ...mv, hub: m(mv.hub), mouth: [m(mv.mouth[0]), m(mv.mouth[1])] as [Vec, Vec] })),
    portals: c.portals.map((p) => ({ a: m(p.a), b: m(p.b) })),
    boxes: mp(c.boxes),
    mines: mp(c.mines ?? []),
  };
}

// One candidate: a board, things on it, and boxes. Not checked yet.
function candidate(seed: number, o: GenOpts, kindIndex: number): { c: Course; ramps: boolean; kind: string } {
  const rand = randOf(seed);
  const ice = o.terrain === 1 || (o.terrain === 2 && rand.chance(0.5));
  const open = o.style === 1 || (o.style === 2 && rand.chance(0.35));
  // Holes get longer through a nine, with some give either way.
  const pos = o.n % 9;
  const len = Math.max(0, Math.min(1, (pos <= 1 ? 0.15 : pos >= 6 ? 0.7 : 0.45) + rand.R(-0.2, 0.25)));
  const budget = [1, 2, 3][o.hazards] + (rand.chance(0.5) ? 1 : 0) + (len > 0.6 ? 1 : 0);
  // Fairways are long: more on them.
  if (open) return { ...fairwayHole(rand, o, len, ice, budget + 3), kind: "fairway" };

  const kind = MINI[kindIndex % MINI.length];
  const lay = L[kind](rand, len);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of lay.path) (x0 = Math.min(x0, p.x - p.hw)), (y0 = Math.min(y0, p.y - p.hw)), (x1 = Math.max(x1, p.x + p.hw)), (y1 = Math.max(y1, p.y + p.hw));
  const pad = 14;
  const F = new Field(x0 - pad, y0 - pad, Math.ceil((x1 - x0 + pad * 2) / G), Math.ceil((y1 - y0 + pad * 2) / G));
  lay.draw(F);
  const boards = trace(F);
  const tee = lay.path[0], cup = lay.path[lay.path.length - 1];
  const onBoard = (p: Vec) => {
    let n = 0;
    for (const g of boards) if (inPoly(p, g)) n++;
    return n % 2 === 1;
  };
  const edgeDist = (p: Vec) => {
    let d = Infinity;
    for (const g of boards) for (const [a, b] of edges(g)) {
      const q = closest(p, a, b);
      d = Math.min(d, hyp(p.x - q.x, p.y - q.y));
    }
    return d;
  };
  const b: Build = {
    rand,
    ice,
    open: false,
    hazards: o.hazards,
    lay,
    inside: (p, margin = 0) => onBoard(p) && edgeDist(p) > margin + 0.6,
    bumpers: [...(lay.bumpers ?? [])],
    walls: [...(lay.walls ?? [])],
    zones: [...(lay.zones ?? [])],
    movers: [],
    mines: [],
    portals: [],
    boxes: [],
    taken: [{ c: tee, r: 3.2 }, { c: cup, r: 2.6 }, ...(lay.bumpers ?? []).map((x) => ({ c: x.at, r: x.r + 0.6 })), ...(lay.zones ?? []).map((z) => ({ c: v(z.poly[0].x + 1.4, z.poly[0].y + 1.4), r: 2.2 }))],
  };
  if (!lay.noObstacles) {
    const menu = ice ? MENU_ICE : MENU_MINI;
    const used = new Set<string>();
    // A table's the pinball one: it always gets its bumpers.
    if (kind === "table") for (let k = 0; k < 6 && !used.has("cluster"); k++) if (OBSTACLES.cluster(b)) used.add("cluster");
    for (let k = 0, made = 0; k < 40 && made < budget; k++) {
      const what = rand.pick(menu);
      // Mines only when the hazards are up; never the same big thing twice.
      if (what === "mines" && o.hazards < 2) continue;
      if (used.has(what) && what !== "bumper") continue;
      if (OBSTACLES[what](b)) {
        used.add(what);
        made++;
      }
    }
  }
  placeBoxes(b, len);
  const course: Course = {
    id: `gen-${seed}`,
    name: nameOf(rand, kind, ice),
    course: "Generated",
    theme: THEME(ice),
    ...(ice ? { surface: "packed" as Ground } : {}),
    par: 3,
    w: 0,
    h: 0,
    tee: v(tee.x, tee.y),
    cup: v(cup.x, cup.y),
    off: "oob",
    greens: boards.map((poly) => ({ poly })),
    zones: b.zones,
    walls: b.walls.map((w) => ({ ...w, style: WALL(ice) })),
    blocks: [],
    props: [],
    bumpers: b.bumpers,
    movers: b.movers,
    portals: b.portals,
    wells: [],
    lamps: [],
    boxes: b.boxes,
    mines: b.mines,
  };
  return { c: framed(course), ramps: !!lay.ramps, kind };
}

// Boxes along the way, a little off the line: one or two a hole, three on a long one.
function placeBoxes(b: Build, len: number) {
  const want = 1 + (b.rand.chance(0.5) ? 1 : 0) + (len > 0.65 ? 1 : 0);
  for (let k = 0; k < 30 && b.boxes.length < want; k++) {
    const { p } = onPath(b, b.rand.R(0.2, 0.85), b.rand.pick([-0.65, 0.65]));
    if (!free(b, p, 1.4)) continue;
    b.boxes.push(p);
    take(b, p, 1.4);
  }
}

// Sized to the board, with a margin all round, everything moved to match.
function framed(c: Course): Course {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of c.greens) for (const p of g.poly) (x0 = Math.min(x0, p.x)), (y0 = Math.min(y0, p.y)), (x1 = Math.max(x1, p.x)), (y1 = Math.max(y1, p.y));
  const m = c.off === "water" ? 6 : 3;
  const out = shift(c, m - x0, m - y0);
  return { ...out, w: x1 - x0 + m * 2, h: y1 - y0 + m * 2 };
}

function fairwayHole(rand: Rand, o: GenOpts, len: number, ice: boolean, budget: number): { c: Course; ramps: boolean } {
  const f = fairway(rand, len, ice, o.hazards);
  const { path, pts, tee, cup } = f;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) (x0 = Math.min(x0, p.x - p.hw)), (y0 = Math.min(y0, p.y - p.hw)), (x1 = Math.max(x1, p.x + p.hw)), (y1 = Math.max(y1, p.y + p.hw));
  const pad = 22;
  const land = new Field(x0 - pad, y0 - pad, Math.ceil((x1 - x0 + pad * 2) / G), Math.ceil((y1 - y0 + pad * 2) / G));
  // The land: the fairway with rough round it, wider here and there, and a tee box and a green apron.
  f.fw(land, f.rough);
  for (let k = 0; k < 3; k++) {
    const s = path[Math.floor(rand.R(0.15, 0.85) * (path.length - 1))];
    const d = disk(v(s.x + rand.R(-2, 2), s.y + rand.R(-2, 2)), s.hw + f.rough + rand.R(0.5, 2.5));
    land.apply(d.bb, d.f);
  }
  for (const [c, r0] of [[tee, 5], [cup, 7.5]] as const) {
    const d = disk(c, r0 + rand.R(0, 2));
    land.apply(d.bb, d.f);
  }
  const boards = trace(land);
  const fairwayF = new Field(land.x0, land.y0, land.nx, land.ny);
  f.fw(fairwayF, 0);
  const g = disk(cup, rand.R(4, 5.5));
  fairwayF.apply(g.bb, g.f);
  const tb = disk(tee, 2.8);
  fairwayF.apply(tb.bb, tb.f);
  const fairways = trace(fairwayF);
  const inLand = (p: Vec) => {
    let n = 0;
    for (const b of boards) if (inPoly(p, b)) n++;
    return n % 2 === 1;
  };
  const inFair = (p: Vec) => fairways.some((x) => inPoly(p, x));
  const zones: Zone[] = fairways.map((poly) => ({ kind: (ice ? "packed" : "green") as Ground, poly }));
  const taken: { c: Vec; r: number }[] = [{ c: tee, r: 4 }, { c: cup, r: 3.4 }];
  const clear = (p: Vec, r: number) => taken.every((t) => hyp(t.c.x - p.x, t.c.y - p.y) > t.r + r);
  const water: Vec[][] = [];
  const sand: Vec[][] = [];
  const bridges: { poly: Vec[]; ends: [Vec, Vec] }[] = [];
  const overlapsAny = (poly: Vec[], others: Vec[][], margin: number) => others.some((o2) => poly.some((p) => inPoly(p, o2) || o2.some((q) => hyp(q.x - p.x, q.y - p.y) < margin)));
  let made = 0;
  // A river across, with a bridge over it, sometimes.
  if (rand.chance(0.45 + 0.15 * o.hazards)) {
    const at = path[Math.floor(rand.R(0.35, 0.6) * (path.length - 1))];
    const nx = -at.dy, ny = at.dx, half = rand.R(1.6, 2.6);
    const span = 40;
    const ctl = [-1, -0.5, 0, 0.5, 1].map((k, i) => ({ x: at.x + nx * k * span + at.dx * (i % 2 ? rand.R(-2, 2) : 0), y: at.y + ny * k * span + at.dy * (i % 2 ? rand.R(-2, 2) : 0), hw: half }));
    const river = new Field(land.x0, land.y0, land.nx, land.ny);
    const rp = curve(ctl, 6);
    for (let i = 1; i < rp.length; i++) {
      const c = capsule(rp[i - 1], rp[i], half, half);
      river.apply(c.bb, c.f);
    }
    // Only where there's land: the lake round it is water anyway.
    for (let k = 0; k < river.a.length; k++) river.a[k] = Math.min(river.a[k], land.a[k] - 0.3);
    const loops = trace(river);
    if (loops.length && clear(at, half + 2)) {
      water.push(...loops);
      // The bridge: along the fairway, a little wider than the river, and narrower than the fairway.
      const bw = rand.R(2.2, 3), bl = half + 1.6;
      const ang = datan2(at.dy, at.dx);
      const poly = [v(-bl, -bw), v(bl, -bw), v(bl, bw), v(-bl, bw)].map((q) => v(at.x + q.x * dcos(ang) - q.y * dsin(ang), at.y + q.x * dsin(ang) + q.y * dcos(ang)));
      bridges.push({ poly, ends: [v(at.x - at.dx * (bl + 0.6), at.y - at.dy * (bl + 0.6)), v(at.x + at.dx * (bl + 0.6), at.y + at.dy * (bl + 0.6))] });
      taken.push({ c: at, r: half + 2 });
      made++;
    }
  }
  // Ponds off to the side, biting into the fairway's edge.
  for (let k = 0; k < 12 && made < budget; k++) {
    const what = rand.pick(["pond", "bunker", "bunker", "green-bunker", "pond", "mound", "wind"]);
    if (what === "pond") {
      const s = path[Math.floor(rand.R(0.2, 0.85) * (path.length - 1))];
      const side = rand.pick([-1, 1]), off = s.hw + rand.R(1, 4);
      const c = v(s.x - s.dy * side * off, s.y + s.dx * side * off);
      const rx = rand.R(2.5, 5), ry = rand.R(2, 3.5);
      const poly = blob(c.x, c.y, rx, ry, Math.floor(rand.R(1, 99)), 0.12, 24);
      if (!clear(c, Math.max(rx, ry) + 1) || overlapsAny(poly, sand, 1.2)) continue;
      if (inPoly(tee, poly) || inPoly(cup, poly)) continue;
      // On ice, some ponds have frozen over.
      if (ice && rand.chance(0.4)) zones.push({ kind: "ice", poly });
      else water.push(poly);
      taken.push({ c, r: Math.max(rx, ry) });
      made++;
    } else if (what === "bunker" || what === "green-bunker") {
      const s = what === "green-bunker" ? path[path.length - 1] : path[Math.floor(rand.R(0.25, 0.8) * (path.length - 1))];
      const side = rand.pick([-1, 1]), off = what === "green-bunker" ? rand.R(4.2, 5.5) : s.hw + rand.R(-0.5, 1.5);
      const ang = rand.R(-0.6, 0.6);
      const c = v(s.x - (s.dy * dcos(ang) + s.dx * dsin(ang)) * side * off, s.y + (s.dx * dcos(ang) - s.dy * dsin(ang)) * side * off);
      const rx = rand.R(1.4, 2.6), ry = rand.R(1.1, 1.9);
      const poly = blob(c.x, c.y, rx, ry, Math.floor(rand.R(1, 99)), 0.15, 20);
      // Never in a pond, never on the tee or in the cup's way.
      if (!clear(c, Math.max(rx, ry) + 0.5) || overlapsAny(poly, water, 1.2) || !poly.every(inLand)) continue;
      sand.push(poly);
      taken.push({ c, r: Math.max(rx, ry) + 0.3 });
      made++;
    } else if (what === "mound") {
      const s = path[Math.floor(rand.R(0.4, 0.75) * (path.length - 1))];
      if (!clear(s, 3)) continue;
      const radius = rand.R(3, 4.5);
      zones.push({ kind: "mound", poly: circle(s.x, s.y, radius, 20), center: v(s.x, s.y), radius, strength: rand.R(4, 7) });
      taken.push({ c: s, r: radius - 1 });
      made++;
    } else if (what === "wind" && o.hazards > 0) {
      const s = path[Math.floor(rand.R(0.35, 0.7) * (path.length - 1))];
      if (!clear(s, 2)) continue;
      const side = rand.pick([-1, 1]);
      zones.push({ kind: "wind", poly: rect(s.x - 6, s.y - 4, 12, 8), dir: v(-s.dy * side, s.dx * side), strength: rand.R(5, 9) });
      made++;
    }
  }
  zones.push(...sand.map((poly) => ({ kind: (ice ? "snow" : "sand") as Ground, poly })));
  zones.push(...water.map((poly) => ({ kind: "water" as Ground, poly })));
  zones.push(...bridges.map((br) => ({ kind: "bridge" as Ground, poly: br.poly })));
  // A box or two in the rough, worth the detour.
  const boxes: Vec[] = [];
  for (let k = 0; k < 30 && boxes.length < 1 + (rand.chance(0.6) ? 1 : 0) + (len > 0.6 ? 1 : 0); k++) {
    const s = path[Math.floor(rand.R(0.2, 0.85) * (path.length - 1))];
    const side = rand.pick([-1, 1]), off = s.hw + rand.R(0.5, f.rough - 1);
    const p = v(s.x - s.dy * side * off, s.y + s.dx * side * off);
    if (!clear(p, 1.5) || !inLand(p) || water.some((w) => inPoly(p, w)) || sand.some((w) => inPoly(p, w))) continue;
    boxes.push(p);
    taken.push({ c: p, r: 1.5 });
  }
  const off: Ground = rand.chance(0.65) ? "water" : "oob";
  const course: Course = {
    id: `gen-${o.seed}-${o.n}`,
    name: nameOf(rand, "fairway", ice),
    course: "Generated",
    theme: THEME(ice),
    surface: ice ? "snow" : "rough",
    par: 4,
    w: 0,
    h: 0,
    tee: v(tee.x, tee.y),
    cup: v(cup.x, cup.y),
    off,
    greens: boards.map((poly) => ({ poly, rim: false })),
    zones,
    walls: [],
    blocks: [],
    props: [],
    bumpers: [],
    movers: [],
    portals: [],
    wells: [],
    lamps: [],
    boxes,
    mines: [],
  };
  void inFair;
  return { c: framed(course), ramps: false };
}

// --- Checks ---

// Everything that should be true of any hole, whatever the bot makes of it. A reason, or null if it's fine.
export function problems(c: Course, ramps = false): string | null {
  const w = compile(c);
  const ground = (p: Vec) => groundAt(w, p);
  const onBoard = (p: Vec) => {
    let n = 0;
    for (const g of c.greens) if (inPoly(p, g.poly)) n++;
    return n % 2 === 1;
  };
  const wallDist = (p: Vec) => {
    let d = Infinity;
    for (const s of w.segs) {
      if (s.h > 50) continue;
      const q = closest(p, s.a, s.b);
      d = Math.min(d, hyp(p.x - q.x, p.y - q.y) - s.r);
    }
    return d;
  };
  const playable = (g: Ground) => !HAZARDS.includes(g);
  if (!onBoard(c.tee) || !playable(ground(c.tee))) return "tee off the board";
  if (!onBoard(c.cup) || !playable(ground(c.cup))) return "cup off the board";
  if (["sand", "snow", "ice", "water"].includes(ground(c.cup))) return "cup in a hazard";
  if (ground(c.tee) === "sand" || (ground(c.tee) === "snow" && c.surface !== "snow")) return "tee in the sand";
  for (const t of [c.tee, ...(c.tees ?? [])]) if (wallDist(t) < 0.9) return "tee against a wall";
  // Sand and water never overlap.
  const sands = c.zones.filter((z) => z.kind === "sand" || z.kind === "snow");
  const waters = c.zones.filter((z) => z.kind === "water");
  for (const s of sands) for (const p of s.poly) if (waters.some((wz) => inPoly(p, wz.poly))) return "sand in the water";
  for (const wz of waters) for (const p of wz.poly) if (sands.some((s) => inPoly(p, s.poly))) return "water in the sand";
  // Bridges land on something you can stand on at both ends.
  for (const z of c.zones)
    if (z.kind === "bridge") {
      const [a, b, cc, d] = z.poly;
      const ends = [v((a.x + d.x) / 2, (a.y + d.y) / 2), v((b.x + cc.x) / 2, (b.y + cc.y) / 2)];
      const out = (p: Vec, q: Vec) => v(p.x + (p.x - q.x) * 0.15, p.y + (p.y - q.y) * 0.15);
      if (!playable(ground(out(ends[0], ends[1]))) || !playable(ground(out(ends[1], ends[0])))) return "bridge to nowhere";
    }
  // Bumpers: on the board and dry, and either against a wall or with room for a ball between.
  for (const b of c.bumpers) {
    if (!onBoard(b.at) || !playable(ground(b.at))) return "bumper off the board";
    const gap = wallDist(b.at) - b.r;
    if (gap > 0.15 && gap < 1.15) return "a ball could wedge by a bumper";
    for (const o of c.bumpers) {
      if (o === b) continue;
      const g2 = hyp(o.at.x - b.at.x, o.at.y - b.at.y) - o.r - b.r;
      if (g2 > 0.05 && g2 < 0.95) return "a ball could wedge between bumpers";
    }
  }
  for (const m of c.mines ?? []) if (!onBoard(m) || !playable(ground(m))) return "mine off the board";
  for (const b of c.boxes) {
    const g = ground(b);
    // (Deep snow's the rough on an ice fairway; a drift on a mini hole is a hazard.)
    if (!onBoard(b) || !playable(g) || g === "sand" || (g === "snow" && c.surface !== "snow")) return "box in a hazard";
    if (wallDist(b) < 1) return "box against a wall";
  }
  for (const m of c.movers) if (m.kind === "spinner" && wallDist(m.at) < m.L + 0.7) return "spinner hits the wall";
  if ((c.tees?.length ?? 0) < 3) return "no room on the tee";
  if (!ramps) {
    const f = distanceField(c, w);
    if (!reachable(f, c, c.tee.x, c.tee.y)) return "no way round on the ground";
  }
  return null;
}

// How the bot does: three goes with shaky hands. Par from how many it takes; null if it can't do it.
function judge(c: Course): number | null {
  const w = compile(c);
  const runs: number[] = [];
  for (const sd of [1, 2, 3]) {
    const r = rng(sd * 7919 + c.tee.x * 13);
    const n = playHole(c, w, { limit: 9, shaky: () => r() * 2 - 1, angles: 24, powers: [0.14, 0.24, 0.36, 0.5, 0.66, 0.84, 1] });
    // Either of the first two going wrong is enough: don't spend longer on a hole that's a slog.
    if (n === null && sd < 3) return null;
    runs.push(n ?? 11);
  }
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
  if (avg < 1.34) return null; // in one nearly every time: not a hole
  return Math.max(2, Math.min(7, Math.round(avg + 0.3)));
}

// Hole `n` from the seed: candidates until one passes, the nth of a shuffled list of shapes so a course
// mixes them up. A plain straight hole if nothing passes, which never happens in practice.
export function generateHole(o: GenOpts, debug?: (msg: string) => void): Course {
  const order = [...MINI];
  const sr = randOf(mix(o.seed, 77));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(sr.r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let attempt = 0; attempt < 14; attempt++) {
    const seed = mix(o.seed, o.n, attempt);
    const kindIndex = MINI.indexOf(order[(o.n + Math.floor(attempt / 3)) % order.length]);
    const { c: raw, ramps, kind } = candidate(seed, o, kindIndex);
    const c = withTees({ ...raw, id: `gen-${o.seed}-${o.n}-${attempt}` });
    const why = problems(c, ramps);
    if (why) {
      debug?.(`${c.name}: ${why}`);
      continue;
    }
    const par = judge(c);
    if (par === null) {
      debug?.(`${c.name}: the bot couldn't play it`);
      continue;
    }
    debug?.(`kept ${kind} on attempt ${attempt + 1}`);
    return { ...c, par, id: `gen-${o.seed}-${o.n}` };
  }
  return fallback(o);
}

function fallback(o: GenOpts): Course {
  const ice = o.terrain === 1;
  const c: Course = {
    id: `gen-${o.seed}-${o.n}`,
    name: ice ? "Plain Sailing" : "Easy Does It",
    course: "Generated",
    theme: THEME(ice),
    ...(ice ? { surface: "packed" as Ground } : {}),
    par: 2,
    w: 22,
    h: 38,
    tee: v(11, 31),
    cup: v(11, 7),
    off: "oob",
    greens: [{ poly: rect(7, 3, 8, 32) }],
    zones: [],
    walls: [],
    blocks: [],
    props: [],
    bumpers: [{ at: v(12.5, 19), r: 1, kick: 5 }],
    movers: [],
    portals: [],
    wells: [],
    lamps: [],
    boxes: [v(9, 13)],
    mines: [],
  };
  return withTees(c);
}
