import {
  BALL_R,
  DECEL,
  DT,
  MAX_SPEED,
  compile,
  inPoly,
  nearSegs,
  newSim,
  rng,
  shoot,
  step,
  v,
  type Bumper,
  type Course,
  type Prop,
  type Theme,
  type Vec,
  type Wall,
  type Zone,
} from "./engine";

// Holes from a seed. The fairway is a winding path with doglegs, drawn into a signed-distance field
// together with open areas, ponds and islands, so everything blends into one smooth shape; its outline
// becomes the walls. Then features go along the path, each one a choice: cut across the pond or go
// round, take the narrow lane past the island or the wide one, use the bridge or jump the stream. A bot
// plays every hole: ones it can't finish, or where a hole in one is easy, are thrown away, and how it
// does sets par.

const G = 0.5; // field resolution, in course units

// --- Fields ---

class Field {
  readonly a: Float32Array;
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly nx: number,
    readonly ny: number,
    fill = -50,
  ) {
    this.a = new Float32Array(nx * ny).fill(fill);
  }
  static over(bb: { x0: number; y0: number; x1: number; y1: number }) {
    return new Field(bb.x0, bb.y0, Math.ceil((bb.x1 - bb.x0) / G) + 1, Math.ceil((bb.y1 - bb.y0) / G) + 1);
  }
  copyShape(fill = -50) {
    return new Field(this.x0, this.y0, this.nx, this.ny, fill);
  }
  at(x: number, y: number) {
    const fx = (x - this.x0) / G, fy = (y - this.y0) / G;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.ny - 1) return -50;
    const tx = fx - i, ty = fy - j;
    const a = this.a, n = this.nx;
    const top = a[j * n + i] * (1 - tx) + a[j * n + i + 1] * tx;
    const bot = a[(j + 1) * n + i] * (1 - tx) + a[(j + 1) * n + i + 1] * tx;
    return top * (1 - ty) + bot * ty;
  }
  // Apply `f(distance) -> value` to every cell within reach, combined with what's there.
  stamp(cx0: number, cy0: number, cx1: number, cy1: number, reach: number, dist: (x: number, y: number) => number, op: (old: number, val: number) => number) {
    const i0 = Math.max(0, Math.floor((Math.min(cx0, cx1) - reach - this.x0) / G));
    const i1 = Math.min(this.nx - 1, Math.ceil((Math.max(cx0, cx1) + reach - this.x0) / G));
    const j0 = Math.max(0, Math.floor((Math.min(cy0, cy1) - reach - this.y0) / G));
    const j1 = Math.min(this.ny - 1, Math.ceil((Math.max(cy0, cy1) + reach - this.y0) / G));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        this.a[k] = op(this.a[k], dist(this.x0 + i * G, this.y0 + j * G));
      }
  }
  capsule(a: Vec, b: Vec, ra: number, rb: number, op: (old: number, val: number) => number, k = 0) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-9;
    this.stamp(a.x, a.y, b.x, b.y, Math.max(ra, rb) + k + 2, (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      return ra + (rb - ra) * t - Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    }, op);
  }
  disk(c: Vec, r: number, op: (old: number, val: number) => number, k = 0) {
    this.capsule(c, c, r, r, op, k);
  }
  // A wobbly disk: a few overlapping ones.
  blob(c: Vec, r: number, rand: () => number, op: (old: number, val: number) => number) {
    this.disk(c, r, op);
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2, d = r * (0.3 + rand() * 0.35);
      this.disk({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d }, r * (0.55 + rand() * 0.25), op);
    }
  }
  combine(other: Field, op: (a: number, b: number) => number) {
    const out = this.copyShape();
    for (let i = 0; i < this.a.length; i++) out.a[i] = op(this.a[i], other.a[i]);
    return out;
  }
}

const smax = (k: number) => (a: number, b: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};
const smin = (k: number) => (a: number, b: number) => -smax(k)(-a, -b);
const union = (a: number, b: number) => Math.max(a, b);
const cut = (k: number) => (a: number, b: number) => smin(k)(a, -b);

// The outline of a field's positive region, as closed loops (marching squares).
export function contours(f: Field, level = 0): Vec[][] {
  const { nx, ny, a } = f;
  const H = (i: number, j: number) => j * nx + i; // edge from point (i,j) to (i+1,j)
  const V = (i: number, j: number) => nx * ny + j * nx + i; // edge from point (i,j) to (i,j+1)
  const pts = new Map<number, Vec>();
  const links = new Map<number, number[]>();
  const val = (i: number, j: number) => a[j * nx + i];
  const point = (e: number): Vec => {
    let p = pts.get(e);
    if (p) return p;
    const vert = e >= nx * ny;
    const k = vert ? e - nx * ny : e;
    const i = k % nx, j = Math.floor(k / nx);
    const v0 = val(i, j), v1 = vert ? val(i, j + 1) : val(i + 1, j);
    const t = Math.max(0, Math.min(1, (level - v0) / (v1 - v0 || 1e-9)));
    p = vert ? v(f.x0 + i * G, f.y0 + (j + t) * G) : v(f.x0 + (i + t) * G, f.y0 + j * G);
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
      const tl = val(i, j) > level, tr = val(i + 1, j) > level, br = val(i + 1, j + 1) > level, bl = val(i, j + 1) > level;
      const c = (+tl << 3) | (+tr << 2) | (+br << 1) | +bl;
      if (c === 0 || c === 15) continue;
      const T = H(i, j), B = H(i, j + 1), L = V(i, j), R = V(i + 1, j);
      const mid = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > level;
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
      const next = (links.get(cur) ?? []).find((n) => n !== prev && !seen.has(n)) ?? (links.get(cur) ?? []).find((n) => n !== prev);
      if (next === undefined || next === start) break;
      prev = cur;
      cur = next;
      if (seen.has(cur)) break;
    }
    if (loop.length >= 6) loops.push(simplify(loop, 0.06));
  }
  return loops;
}

// Drop points that sit on a nearly straight line between their neighbors.
function simplify(loop: Vec[], eps: number): Vec[] {
  let pts = loop;
  for (let pass = 0; pass < 3; pass++) {
    const out: Vec[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = out.length ? out[out.length - 1] : pts[pts.length - 1];
      const b = pts[i], c = pts[(i + 1) % pts.length];
      const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy);
      const d = l > 0 ? Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) / l : 0;
      if (d < eps && l < 2.5 && out.length) continue;
      out.push(b);
    }
    pts = out;
  }
  return pts;
}

// --- The path ---

type Sample = { x: number; y: number; w: number; s: number; tx: number; ty: number };

function spline(ctl: { x: number; y: number; w: number }[]): Sample[] {
  const raw: { x: number; y: number; w: number }[] = [];
  const at = (i: number) => ctl[Math.max(0, Math.min(ctl.length - 1, i))];
  for (let i = 0; i < ctl.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const steps = Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) * 2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * (t * t * (3 - 2 * t)) });
    }
  }
  raw.push(ctl[ctl.length - 1]);
  // Resample by arc length, one point per unit.
  const out: Sample[] = [];
  let s = 0;
  let next = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    if (s >= next || i === raw.length - 1) {
      const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      out.push({ x: raw[i].x, y: raw[i].y, w: raw[i].w, s, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l });
      next = s + 1;
    }
  }
  return out;
}

// --- Names ---

const FIRST = ["Maple", "Heron", "Willow", "Clover", "Foxglove", "Bramble", "Thistle", "Juniper", "Meadow", "Hollow", "Badger", "Kestrel", "Fern", "Mossy", "Oak", "Wren", "Lark", "Elder", "Hazel", "Sorrel"];
const LAST = ["Bend", "Run", "Crossing", "Hollow", "Rise", "Dell", "Green", "Glen", "Reach", "Turn", "Brook", "Way", "Fold", "Knoll", "Corner", "Lane"];

// --- Generation ---

export type HoleStats = { length: number; bot: number; features: string[] };
export type GenHole = Course & { seed: number; stats: HoleStats };

export function generate(seed: number, theme: Theme = "hills"): GenHole | null {
  const r = rng(seed * 7919 + 17);
  const R = (a: number, b: number) => a + r() * (b - a);
  const features: string[] = [];

  // A path heading north with two to four bends. It never turns back on itself.
  const legs = 3 + Math.floor(r() * 3);
  let heading = -Math.PI / 2 + R(-0.35, 0.35);
  let side = r() < 0.5 ? 1 : -1;
  const ctl = [{ x: 0, y: 0, w: R(4.6, 5.6) }];
  for (let i = 0; i < legs; i++) {
    const L = R(17, 30);
    const last = ctl[ctl.length - 1];
    ctl.push({ x: last.x + Math.cos(heading) * L, y: last.y + Math.sin(heading) * L, w: R(4.2, 6.6) });
    const turn = R(0.45, 1.15) * (r() < 0.7 ? side : -side);
    side = -Math.sign(turn);
    heading = Math.max(-Math.PI + 0.3, Math.min(-0.3, heading + turn));
  }
  const path = spline(ctl);
  const total = path[path.length - 1].s;
  if (total < 60 || total > 140) return null;
  // Parts of the path that pass close to each other would merge into one blob.
  for (let i = 0; i < path.length; i += 2)
    for (let j = i + 2; j < path.length; j += 2) {
      const a = path[i], b = path[j];
      if (j - i < (a.w + b.w) * 2.5 + 8) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.w + b.w + 7) return null;
    }
  const at = (s: number): Sample => path[Math.max(0, Math.min(path.length - 1, Math.round(s)))];
  const normal = (p: Sample) => v(-p.ty, p.tx);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of path) {
    x0 = Math.min(x0, p.x - p.w - 16);
    y0 = Math.min(y0, p.y - p.w - 16);
    x1 = Math.max(x1, p.x + p.w + 16);
    y1 = Math.max(y1, p.y + p.w + 16);
  }
  const P = Field.over({ x0, y0, x1, y1 }); // the fairway
  const W = P.copyShape(); // water
  const S = P.copyShape(); // sand
  for (let i = 1; i < path.length; i++) P.capsule(path[i - 1], path[i], path[i - 1].w, path[i].w, union);

  const zones: Zone[] = [];
  const walls: Wall[] = [];
  const bumpers: Bumper[] = [];
  const props: Prop[] = [];
  const boxes: Vec[] = [];
  const islands: { a: Vec; b: Vec; r: number }[] = [];
  const bridges: Vec[][] = [];
  const rect = (c: Vec, along: Vec, len: number, wid: number): Vec[] => {
    const n = v(-along.y, along.x);
    const hl = len / 2, hw = wid / 2;
    return [
      v(c.x - along.x * hl - n.x * hw, c.y - along.y * hl - n.y * hw),
      v(c.x + along.x * hl - n.x * hw, c.y + along.y * hl - n.y * hw),
      v(c.x + along.x * hl + n.x * hw, c.y + along.y * hl + n.y * hw),
      v(c.x - along.x * hl + n.x * hw, c.y - along.y * hl + n.y * hw),
    ];
  };
  const ribbon = (s0: number, s1: number, extra: number): Vec[] => {
    const left: Vec[] = [], right: Vec[] = [];
    for (let s = s0; s <= s1; s += 1) {
      const p = at(s), n = normal(p);
      left.push(v(p.x + n.x * (p.w + extra), p.y + n.y * (p.w + extra)));
      right.push(v(p.x - n.x * (p.w + extra), p.y - n.y * (p.w + extra)));
    }
    return [...left, ...right.reverse()];
  };
  const used: [number, number][] = [];
  const free = (s0: number, s1: number) => used.every(([a, b]) => s1 < a - 4 || s0 > b + 4);
  const claim = (s0: number, s1: number) => used.push([s0, s1]);
  const spot = (lo: number, hi: number, len: number) => {
    for (let k = 0; k < 20; k++) {
      const s = R(total * lo, total * hi);
      if (free(s - len / 2, s + len / 2)) return s;
    }
    return null;
  };

  // The green: a bowl that helps, a crown that doesn't, or flat.
  const end = at(total - R(3.5, 5));
  const cup = v(end.x + normal(end).x * R(-end.w * 0.3, end.w * 0.3), end.y + normal(end).y * R(-end.w * 0.3, end.w * 0.3));
  P.disk(cup, R(5, 6.5), smax(3));
  claim(total - 12, total);
  const green = r();
  if (green < 0.4) zones.push({ kind: "mound", poly: circlePoly(cup, 5.5), center: cup, radius: 5.5, strength: -R(1.2, 2) });
  else if (green < 0.65) zones.push({ kind: "mound", poly: circlePoly(cup, 4.5), center: v(cup.x + R(-1, 1), cup.y + R(-1, 1)), radius: 4.5, strength: R(1.6, 2.6) });

  const tee = at(3.2);
  claim(0, 9);

  // Features, three to five, no two on top of each other.
  const menu = ["pond", "island", "stream", "gate", "slope", "chamber", "hill"];
  const count = 3 + Math.floor(r() * 3);
  for (let n = 0; n < count * 3 && features.length < count; n++) {
    const kind = menu[Math.floor(r() * menu.length)];
    if (features.includes(kind) && kind !== "slope") continue;
    if (kind === "pond") {
      // On the inside of a bend, with the fairway opened up round it.
      const bends = ctl.slice(1, -1).map((c) => path.reduce((best, p) => (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? p : best), path[0]));
      const b = bends[Math.floor(r() * bends.length)];
      if (!b || !free(b.s - 9, b.s + 9)) continue;
      const before = at(b.s - 6), after = at(b.s + 6);
      const turn = before.tx * after.ty - before.ty * after.tx;
      const n0 = normal(b);
      const inward = turn > 0 ? 1 : -1;
      const radius = R(2.8, 4.4);
      const c = v(b.x + n0.x * inward * R(0.5, 2.5), b.y + n0.y * inward * R(0.5, 2.5));
      P.disk(c, radius + R(4.5, 6), smax(4));
      W.blob(c, radius, r, union);
      claim(b.s - 9, b.s + 9);
      features.push("pond");
      // A ramp straight at the far side, for anyone brave.
      if (r() < 0.6) {
        const from = at(b.s - R(10, 13));
        const to = at(b.s + 10);
        const dir = norm(v(to.x - from.x, to.y - from.y));
        const deck = rect(from, dir, 2.6, 2.8);
        if (P.at(from.x, from.y) > 2.5 && deck.every((q) => W.at(q.x, q.y) < -1.5 && P.at(q.x, q.y) > 0.8)) {
          zones.push({ kind: "ramp", poly: deck, dir, lift: 0.62 });
          features.push("ramp");
        }
      }
      boxes.push(v(c.x + n0.x * -inward * (radius + 1.6), c.y + n0.y * -inward * (radius + 1.6)));
    } else if (kind === "island") {
      // Two lanes round a garden bed: one wide, one tight.
      const s = spot(0.25, 0.72, 20);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const half = R(4, 6), ir = R(1.4, 2.3);
      const shift = R(-1.5, 1.5);
      const a = v(at(s - half).x + n0.x * shift, at(s - half).y + n0.y * shift);
      const b = v(at(s + half).x + n0.x * shift, at(s + half).y + n0.y * shift);
      for (let t = s - half - 5; t <= s + half + 5; t += 1) P.disk(at(t), at(t).w + ir + R(2.6, 3.2), smax(3));
      P.capsule(a, b, ir, ir, cut(1.5));
      islands.push({ a, b, r: ir });
      claim(s - half - 6, s + half + 6);
      features.push("island");
      if (r() < 0.5) {
        const lane = r() < 0.5 ? 1 : -1;
        const m = v((a.x + b.x) / 2 + n0.x * lane * (ir + 2.4), (a.y + b.y) / 2 + n0.y * lane * (ir + 2.4));
        S.blob(m, R(1.4, 2), r, union);
        boxes.push(v((a.x + b.x) / 2 - n0.x * lane * (ir + 1.8), (a.y + b.y) / 2 - n0.y * lane * (ir + 1.8)));
      }
    } else if (kind === "stream") {
      // Wall to wall water, a narrow bridge, and maybe a ramp to jump it.
      const s = spot(0.25, 0.7, 14);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const half = R(0.9, 1.4);
      W.capsule(v(p.x - n0.x * (p.w + 8), p.y - n0.y * (p.w + 8)), v(p.x + n0.x * (p.w + 8), p.y + n0.y * (p.w + 8)), half, half, union);
      const off = R(-p.w * 0.45, p.w * 0.45);
      const bw = R(2.6, 3.3);
      const bc = v(p.x + n0.x * off, p.y + n0.y * off);
      const along = v(p.tx, p.ty);
      const bl = half * 2 + 2.4;
      const deck = rect(bc, along, bl, bw);
      bridges.push(deck);
      zones.push({ kind: "bridge", poly: deck });
      for (const k of [-1, 1]) {
        const o = v(n0.x * (bw / 2) * k, n0.y * (bw / 2) * k);
        walls.push({ pts: [v(bc.x - along.x * (bl / 2 - 0.3) + o.x, bc.y - along.y * (bl / 2 - 0.3) + o.y), v(bc.x + along.x * (bl / 2 - 0.3) + o.x, bc.y + along.y * (bl / 2 - 0.3) + o.y)], w: 0.3, h: 0.7, style: "rail" });
      }
      claim(s - 8, s + 8);
      features.push("stream");
      if (r() < 0.5) {
        const rp = at(s - R(5, 7));
        const roff = off > 0 ? -R(1.5, rp.w * 0.6) : R(1.5, rp.w * 0.6);
        const rc = v(rp.x + n0.x * roff, rp.y + n0.y * roff);
        const deck = rect(rc, along, 2.4, 2.6);
        if (P.at(rc.x, rc.y) > 2 && deck.every((q) => W.at(q.x, q.y) < -1.5 && P.at(q.x, q.y) > 0.8)) {
          zones.push({ kind: "ramp", poly: deck, dir: along, lift: 0.6 });
          features.push("ramp");
        }
      }
    } else if (kind === "gate") {
      // A hedge across the fairway with one or two gaps.
      const s = spot(0.2, 0.78, 8);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const span = p.w + 1;
      const gaps = r() < 0.5 ? [R(-span + 2.5, span - 2.5)] : [R(-span + 2.5, -1.5), R(1.5, span - 2.5)];
      const gw = R(2.6, 3.4);
      const cuts = [-span - 1, ...gaps.flatMap((g) => [g - gw / 2, g + gw / 2]), span + 1];
      for (let k = 0; k < cuts.length; k += 2) {
        const u0 = cuts[k], u1 = cuts[k + 1];
        if (u1 - u0 < 0.6) continue;
        walls.push({ pts: [v(p.x + n0.x * u0, p.y + n0.y * u0), v(p.x + n0.x * u1, p.y + n0.y * u1)], w: 1, h: 1.3, style: "hedge" });
      }
      claim(s - 4, s + 4);
      features.push("gate");
    } else if (kind === "slope") {
      // A side hill that pulls the ball one way.
      const len = R(10, 16);
      const s = spot(0.15, 0.75, len);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const sign = r() < 0.5 ? 1 : -1;
      zones.push({ kind: "slope", poly: ribbon(s - len / 2, s + len / 2, 2), dir: v(n0.x * sign, n0.y * sign), strength: R(2.2, 3.4) });
      claim(s - len / 2, s + len / 2);
      features.push("slope");
    } else if (kind === "chamber") {
      // A wide open space with posts to bank off.
      const s = spot(0.3, 0.72, 14);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const c = v(p.x + n0.x * R(-2, 2), p.y + n0.y * R(-2, 2));
      const cr = p.w * R(1.5, 1.9);
      P.disk(c, cr, smax(4));
      const k = 3 + Math.floor(r() * 3);
      const rot = r() * Math.PI;
      for (let i = 0; i < k; i++) {
        const a = rot + (i / k) * Math.PI * 2;
        bumpers.push({ at: v(c.x + Math.cos(a) * cr * 0.5, c.y + Math.sin(a) * cr * 0.5), r: R(0.5, 0.7), kick: 1.2 });
      }
      if (r() < 0.5) bumpers.push({ at: c, r: 0.8, kick: 1.2 });
      claim(s - cr, s + cr);
      features.push("chamber");
      if (r() < 0.6) boxes.push(v(c.x + Math.cos(rot + Math.PI / k) * cr * 0.75, c.y + Math.sin(rot + Math.PI / k) * cr * 0.75));
    } else if (kind === "hill") {
      const s = spot(0.2, 0.75, 12);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const c = v(p.x + n0.x * R(-p.w * 0.5, p.w * 0.5), p.y + n0.y * R(-p.w * 0.5, p.w * 0.5));
      const hr = R(4, 6);
      P.disk(c, hr * 0.9, smax(3));
      zones.push({ kind: "mound", poly: circlePoly(c, hr), center: c, radius: hr, strength: R(2.6, 3.8) });
      claim(s - 6, s + 6);
      features.push("hill");
    }
  }
  if (features.filter((f) => f !== "ramp").length < 3) return null;

  // Bunkers by the green, and maybe one out on the fairway.
  const nb = 1 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const a = r() * Math.PI * 2, d = R(3.4, 5.5);
    const c = v(cup.x + Math.cos(a) * d, cup.y + Math.sin(a) * d);
    S.blob(c, R(1.2, 2.1), r, union);
  }
  if (r() < 0.5) {
    const s = spot(0.35, 0.8, 6);
    if (s !== null) {
      const p = at(s), n0 = normal(p);
      const side = r() < 0.5 ? 1 : -1;
      S.blob(v(p.x + n0.x * side * p.w * 0.55, p.y + n0.y * side * p.w * 0.55), R(1.5, 2.4), r, union);
    }
  }

  // Outlines. Water reaches the walls; sand stays a little inside them and never touches the cup.
  const greenLoops = contours(P);
  const water = contours(W.combine(P, (w, p) => Math.min(w, p)));
  S.disk(cup, 1.6, cut(0.5));
  S.disk(v(tee.x, tee.y), 2.5, cut(0.5));
  const sand = contours(S.combine(P, (s, p) => Math.min(s, p - 0.8)).combine(W, (s, w) => Math.min(s, -w - 0.4)));
  zones.unshift(...sand.map((poly) => ({ kind: "sand" as const, poly })), ...water.map((poly) => ({ kind: "water" as const, poly })));
  // Bridges go after the water so they win.
  zones.sort((a, b) => order(a.kind) - order(b.kind));

  // Check it plays: the cup and tee are well inside and away from hazards, and there's a way through.
  const ok = (p: Vec, clear: number) => P.at(p.x, p.y) > clear && W.at(p.x, p.y) < -1 && S.at(p.x, p.y) < -0.3;
  if (!ok(cup, 2) || !ok(tee, 2)) return null;
  const blocked = (p: Vec) => walls.some((w) => w.pts.some((q, i) => i > 0 && segDist(p, w.pts[i - 1], q) < w.w / 2 + BALL_R + 0.1)) || bumpers.some((b) => Math.hypot(p.x - b.at.x, p.y - b.at.y) < b.r + BALL_R + 0.1);
  const route = shortest(P, W, bridges, blocked, tee, cup);
  if (!route) return null;
  boxes.splice(0, boxes.length, ...boxes.filter((b) => ok(b, 1.2) && !blocked(b)).slice(0, 2));

  // Scenery: trees crowd the edges, thinning out further away; lamps along the walls.
  const decor: Prop[] = [];
  const pr = rng(seed * 31 + 5);
  for (let i = 0; i < 9000 && decor.length < (x1 - x0) * (y1 - y0) * 0.035; i++) {
    const p = v(x0 + 2 + pr() * (x1 - x0 - 4), y0 + 2 + pr() * (y1 - y0 - 4));
    const d = -P.at(p.x, p.y);
    if (d < 1.8) continue;
    const grove = 0.5 + 0.5 * Math.sin(p.x * 0.13 + seed) * Math.sin(p.y * 0.11 + seed * 0.7) + 0.25 * Math.sin(p.x * 0.31 - p.y * 0.27);
    if (pr() > Math.max(0.25, 1 - d / 14) * Math.min(1, Math.max(0.12, grove * 1.6))) continue;
    const big = pr() < 0.75;
    const rr = big ? 1.1 + pr() * 1.1 : 0.5 + pr() * 0.4;
    if (decor.some((q) => Math.hypot(q.at.x - p.x, q.at.y - p.y) < q.r + rr + 0.2)) continue;
    if (d < rr + 1.2) continue;
    decor.push({ kind: big ? "tree" : pr() < 0.6 ? "bush" : "rock", at: p, r: rr, h: big ? 3 + rr * 1.2 : 0.8, seed: Math.floor(pr() * 1e6) });
  }
  for (let i = 0; i < 40; i++) {
    const p = v(x0 + pr() * (x1 - x0), y0 + pr() * (y1 - y0));
    if (-P.at(p.x, p.y) > 1.5 && !decor.some((q) => Math.hypot(q.at.x - p.x, q.at.y - p.y) < q.r + 0.8)) decor.push({ kind: "flowers", at: p, r: 0.6 + pr() * 0.6, h: 0, seed: Math.floor(pr() * 1e6) });
  }
  for (const isl of islands) {
    const mid = v((isl.a.x + isl.b.x) / 2, (isl.a.y + isl.b.y) / 2);
    decor.push({ kind: "tree", at: mid, r: Math.min(1.6, isl.r * 0.95), h: 4, seed: Math.floor(pr() * 1e6) });
    for (const e of [isl.a, isl.b]) decor.push({ kind: pr() < 0.5 ? "bush" : "flowers", at: v((e.x + mid.x) / 2, (e.y + mid.y) / 2), r: Math.min(0.8, isl.r * 0.6), h: 0.8, seed: Math.floor(pr() * 1e6) });
  }
  const lamps: Vec[] = [];
  for (let s = 10; s < total - 4; s += R(11, 15)) {
    const p = at(s), n0 = normal(p);
    const k = lamps.length % 2 ? 1 : -1;
    for (let o = p.w + 1; o < p.w + 9; o += 0.5) {
      const q = v(p.x + n0.x * k * o, p.y + n0.y * k * o);
      if (P.at(q.x, q.y) < -1.1) {
        lamps.push(q);
        break;
      }
    }
  }
  const clearOfLamps = decor.filter((d) => lamps.every((l) => Math.hypot(l.x - d.at.x, l.y - d.at.y) > d.r + 0.6));

  // Everything shifted so the course starts at the origin.
  const dx = -x0, dy = -y0;
  const mv = (p: Vec) => v(p.x + dx, p.y + dy);
  const course: GenHole = {
    seed,
    id: `gen-${seed}`,
    name: `${FIRST[seed % FIRST.length]} ${LAST[Math.floor(seed / FIRST.length) % LAST.length]}`,
    course: "Green Hills",
    theme,
    par: 4,
    w: x1 - x0,
    h: y1 - y0,
    tee: mv(tee),
    cup: mv(cup),
    off: "oob",
    greens: greenLoops.map((poly) => ({ poly: poly.map(mv) })),
    zones: zones.map((z) => ({ ...z, poly: z.poly.map(mv), ...("center" in z ? { center: mv(z.center) } : {}) })),
    walls: walls.map((w) => ({ ...w, pts: w.pts.map(mv) })),
    blocks: [],
    props: clearOfLamps.map((p) => ({ ...p, at: mv(p.at) })),
    bumpers: bumpers.map((b) => ({ ...b, at: mv(b.at) })),
    movers: [],
    portals: [],
    wells: [],
    lamps: lamps.map(mv),
    boxes: boxes.map(mv),
    stats: { length: Math.round(route.length), bot: 0, features },
  };
  // A bot plays it. It has to get round, and it mustn't be able to hole out in one.
  const hazard = (p: Vec) => {
    const q = v(p.x - dx, p.y - dy);
    return (W.at(q.x, q.y) > -0.4 && !bridges.some((b) => inPoly(q, b))) || S.at(q.x, q.y) > -0.2;
  };
  const bot = botPlay(course, route.points.map(mv), hazard);
  if (bot > 8 || bot <= 2) return null;
  course.stats.bot = bot;
  course.par = Math.max(3, Math.min(6, Math.round(route.length / 27 + 1.2)));
  if (bot > course.par + 2) return null;
  return course;
}

const order = (k: Zone["kind"]) => (k === "sand" ? 0 : k === "water" ? 1 : k === "bridge" ? 2 : 3);
const norm = (p: Vec) => {
  const l = Math.hypot(p.x, p.y) || 1;
  return v(p.x / l, p.y / l);
};
function circlePoly(c: Vec, r: number, n = 28): Vec[] {
  return Array.from({ length: n }, (_, i) => v(c.x + Math.cos((i / n) * Math.PI * 2) * r, c.y + Math.sin((i / n) * Math.PI * 2) * r));
}
function segDist(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

// The shortest way round on the ground, avoiding water (bridges are fine) and walls.
function shortest(P: Field, W: Field, bridges: Vec[][], blocked: (p: Vec) => boolean, from: Vec, to: Vec) {
  const g = 1;
  const x0 = P.x0, y0 = P.y0;
  const nx = Math.ceil(((P.nx - 1) * G) / g), ny = Math.ceil(((P.ny - 1) * G) / g);
  const pass = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p = v(x0 + i * g, y0 + j * g);
      pass[j * nx + i] = +(P.at(p.x, p.y) > 0.8 && (W.at(p.x, p.y) < -0.2 || bridges.some((b) => inPoly(p, b))) && !blocked(p));
    }
  const idx = (p: Vec) => Math.round((p.y - y0) / g) * nx + Math.round((p.x - x0) / g);
  const start = idx(from), goal = idx(to);
  const dist = new Float32Array(nx * ny).fill(Infinity);
  const prev = new Int32Array(nx * ny).fill(-1);
  dist[start] = 0;
  // Dijkstra on a small grid; a sorted bucket queue is plenty.
  const queue: number[] = [start];
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (queue.length) {
    let bi = 0;
    for (let k = 1; k < queue.length; k++) if (dist[queue[k]] < dist[queue[bi]]) bi = k;
    const cur = queue[bi];
    queue[bi] = queue[queue.length - 1];
    queue.pop();
    if (cur === goal) break;
    const ci = cur % nx, cj = Math.floor(cur / nx);
    for (const [di, dj, c] of steps) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const k = nj * nx + ni;
      if (!pass[k] && k !== goal) continue;
      const d = dist[cur] + c * g;
      if (d < dist[k]) {
        if (dist[k] === Infinity) queue.push(k);
        dist[k] = d;
        prev[k] = cur;
      }
    }
  }
  if (dist[goal] === Infinity) return null;
  const points: Vec[] = [];
  for (let k = goal; k !== -1; k = prev[k]) points.push(v(x0 + (k % nx) * g, y0 + Math.floor(k / nx) * g));
  return { length: dist[goal], points: points.reverse() };
}

// How far a putt of a given power rolls on flat carpet, and the power for a given distance.
const ROLL_DRAG = 0.12;
function rollDistance(power: number) {
  const v0 = MAX_SPEED * power, a = DECEL.green, k = ROLL_DRAG;
  return v0 / k - (a / (k * k)) * Math.log(1 + (k * v0) / a);
}
export function powerFor(distance: number) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (rollDistance(m) < distance) lo = m;
    else hi = m;
  }
  return hi;
}
export const MAX_ROLL = rollDistance(1);

// A decent but not perfect player: aims at the furthest point of the route it can see and reach.
function botPlay(course: Course, route: Vec[], hazard: (p: Vec) => boolean): number {
  const world = compile(course);
  const sim = newSim(course, 1);
  const clear = (a: Vec, b: Vec) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(l / 0.4);
    for (let i = 1; i <= n; i++) {
      const p = v(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
      for (const s of nearSegs(world, p.x, p.y)) if (segDist(p, s.a, s.b) < s.r + BALL_R + 0.15) return false;
      for (const b2 of course.bumpers) if (Math.hypot(p.x - b2.at.x, p.y - b2.at.y) < b2.r + BALL_R + 0.15) return false;
      if (hazard(p)) return false;
    }
    return true;
  };
  for (let shot = 0; shot < 10; shot++) {
    const here = v(sim.x, sim.y);
    let target: Vec | null = null;
    let putt = false;
    if (Math.hypot(course.cup.x - here.x, course.cup.y - here.y) < MAX_ROLL * 0.85 && clear(here, course.cup)) {
      target = course.cup;
      putt = true;
    } else {
      for (let i = route.length - 1; i >= 0; i -= 2) {
        const p = route[i];
        if (Math.hypot(p.x - here.x, p.y - here.y) < MAX_ROLL * 0.7 && clear(here, p)) {
          target = p;
          break;
        }
      }
    }
    if (!target) {
      // Nothing in sight: nudge along the route.
      const nearest = route.reduce((bi, p, i) => (Math.hypot(p.x - here.x, p.y - here.y) < Math.hypot(route[bi].x - here.x, route[bi].y - here.y) ? i : bi), 0);
      target = route[Math.min(route.length - 1, nearest + 6)];
    }
    const d = Math.hypot(target.x - here.x, target.y - here.y);
    shoot(sim, Math.atan2(target.y - here.y, target.x - here.x), powerFor(putt ? d + 0.8 : d));
    for (let i = 0; i < 40 / DT && (sim.mode === "roll" || sim.mode === "out"); i++) step(sim, world);
    if (sim.mode === "sunk") return sim.strokes;
  }
  return 99;
}

// The first `n` holes that make the cut, starting from a seed.
export function holesFrom(start: number, n: number, theme: Theme = "hills"): GenHole[] {
  const out: GenHole[] = [];
  for (let s = start; out.length < n && s < start + n * 40; s++) {
    const h = generate(s, theme);
    if (h) out.push(h);
  }
  return out;
}
