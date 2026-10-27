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
  type Sim,
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
  // A straight piece with square ends: hard corners where pieces meet.
  box(a: Vec, b: Vec, hw: number, ext: number, op: (old: number, val: number) => number) {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / L, uy = dy / L;
    this.stamp(a.x, a.y, b.x, b.y, hw + ext + 2, (x, y) => {
      const px = x - a.x, py = y - a.y;
      const qx = Math.abs(px * ux + py * uy - L / 2) - (L / 2 + ext), qy = Math.abs(-px * uy + py * ux) - hw;
      return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0));
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

type Sample = { x: number; y: number; w: number; pw: number; s: number; tx: number; ty: number };
type Raw = { x: number; y: number; w: number; pw: number };

// One point per unit of length, each with the way it's heading.
function resample(raw: Raw[]): Sample[] {
  const out: Sample[] = [];
  let s = 0;
  let next = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    if (s >= next || i === raw.length - 1) {
      const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      out.push({ ...raw[i], s, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l });
      next = s + 1;
    }
  }
  return out;
}
const line = (a: Raw, b: Raw, out: Raw[]) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let k = 0; k < n; k++) {
    const t = k / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, pw: a.pw + (b.pw - a.pw) * t });
  }
};

// Through control points: curved legs as a smooth spline, hard legs as straight lines.
function spline(ctl: Raw[], hard: boolean[] = []): Sample[] {
  const raw: Raw[] = [];
  const at = (i: number) => ctl[Math.max(0, Math.min(ctl.length - 1, i))];
  for (let i = 0; i < ctl.length - 1; i++) {
    if (hard[i]) {
      line(ctl[i], ctl[i + 1], raw);
      continue;
    }
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const steps = Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) * 2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      const e = t * t * (3 - 2 * t);
      raw.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * e, pw: p1.pw + (p2.pw - p1.pw) * e });
    }
  }
  raw.push(ctl[ctl.length - 1]);
  return resample(raw);
}

// --- Shapes ---
//
// Every hole is one of four shapes. Each lays out the way through (the path the features go along)
// and draws its fairway (F) and everything playable (P, the fairway plus rough) into fields.

export type Shape = "bends" | "switchback" | "spiral" | "loop";
type Layout = {
  shape: Shape;
  path: Sample[];
  stamp: (F: Field, P: Field) => void;
  extent: Vec[]; // points the course reaches, with room
  cupAtEnd: boolean;
  menu: string[];
  ctl?: Raw[];
  ramps?: { at: Vec; dir: Vec }[];
  posts?: Vec[];
};
type Rand = { r: () => number; R: (a: number, b: number) => number };

// Doglegs: three to five legs, some curving with rough along them, some straight with hard corners.
function bends({ r, R }: Rand): Layout | null {
  const legs = 3 + Math.floor(r() * 3);
  let heading = -Math.PI / 2 + R(-0.35, 0.35);
  let side = r() < 0.5 ? 1 : -1;
  const hard: boolean[] = [];
  const w0 = R(6, 7.5);
  const ctl: Raw[] = [{ x: 0, y: 0, w: w0, pw: w0 + R(0, 3) }];
  for (let i = 0; i < legs; i++) {
    const isHard = r() < 0.4;
    hard.push(isHard);
    // Straight legs run at whole 45 degree angles, like something built.
    const h = isHard ? Math.max(-Math.PI * 0.75, Math.min(-Math.PI * 0.25, Math.round(heading / (Math.PI / 4)) * (Math.PI / 4))) : heading;
    const L = R(30, 50);
    const last = ctl[ctl.length - 1];
    const w = R(5.5, 9);
    ctl.push({ x: last.x + Math.cos(h) * L, y: last.y + Math.sin(h) * L, w, pw: w + (isHard ? 0 : r() < 0.75 ? R(2, 5) : 0) });
    const turn = R(0.45, 1.15) * (r() < 0.7 ? side : -side);
    side = -Math.sign(turn);
    heading = Math.max(-Math.PI + 0.3, Math.min(-0.3, h + turn));
  }
  // A hard leg's ends have no rough, so its walls meet the curve's cleanly.
  ctl.forEach((c, i) => {
    if (hard[i] || hard[i - 1]) c.pw = c.w;
  });
  const path = spline(ctl, hard);
  for (let i = 0; i < path.length; i += 2)
    for (let j = i + 2; j < path.length; j += 2) {
      const a = path[i], b = path[j];
      if (j - i < (a.pw + b.pw) * 2.5 + 8) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.pw + b.pw + 7) return null;
    }
  return {
    shape: "bends",
    path,
    ctl,
    cupAtEnd: false,
    menu: ["pond", "island", "stream", "gate", "slope", "chamber", "hill", "boost"],
    extent: path.flatMap((p) => [v(p.x - p.pw - 16, p.y - p.pw - 16), v(p.x + p.pw + 16, p.y + p.pw + 16)]),
    stamp: (F, P) => {
      for (let i = 1; i < path.length; i++) {
        F.capsule(path[i - 1], path[i], path[i - 1].w, path[i].w, union);
        P.capsule(path[i - 1], path[i], path[i - 1].pw, path[i].pw, union);
      }
      // Straight legs again as boxes, for their square corners.
      for (let i = 0; i < legs; i++)
        if (hard[i]) {
          const ext = Math.min(ctl[i].w, ctl[i + 1].w);
          F.box(ctl[i], ctl[i + 1], Math.min(ctl[i].w, ctl[i + 1].w), ext, union);
          P.box(ctl[i], ctl[i + 1], Math.min(ctl[i].w, ctl[i + 1].w), ext, union);
        }
    },
  };
}

// Switchbacks: parallel lanes joined at alternate ends by square hairpin turns. Ramps can jump a lane.
function switchback({ r, R }: Rand): Layout {
  const n = r() < 0.5 ? 3 : 4;
  const Ln = R(36, 52), w = R(4.8, 6.2), gap = R(3.2, 5);
  const pitch = 2 * w + gap;
  const flip = r() < 0.5 ? -1 : 1;
  const corners: Raw[] = [];
  for (let k = 0; k < n; k++) {
    const y = -k * pitch;
    const [xa, xb] = k % 2 ? [Ln, 0] : [0, Ln];
    corners.push({ x: xa * flip, y, w, pw: w }, { x: xb * flip, y, w, pw: w });
  }
  const raw: Raw[] = [];
  for (let i = 0; i < corners.length - 1; i++) line(corners[i], corners[i + 1], raw);
  raw.push(corners[corners.length - 1]);
  const path = resample(raw);
  const ramps: { at: Vec; dir: Vec }[] = [];
  for (let k = 0; k < n - 1; k++)
    if (r() < 0.5) ramps.push({ at: v(R(Ln * 0.3, Ln * 0.7) * flip, -k * pitch - w * 0.35), dir: v(0, -1) });
  return {
    shape: "switchback",
    path,
    cupAtEnd: false,
    menu: ["slope", "boost", "gate", "stream"],
    ramps,
    extent: corners.flatMap((c) => [v(c.x - w - 16, c.y - w - 16), v(c.x + w + 16, c.y + w + 16)]),
    stamp: (F, P) => {
      for (let i = 0; i < corners.length - 1; i++)
        for (const f of [F, P]) f.box(corners[i], corners[i + 1], w, w, union);
    },
  };
}

// A spiral coiling in to a round green in the middle. Ramps on the outer arms jump the wall inward.
function spiral({ r, R }: Rand): Layout {
  const R0 = R(25, 31), sp = R(14, 16), w = Math.min(R(5, 6), (sp - 3.5) / 2);
  const g = R(6, 7.5), rEnd = g + 1;
  const turns = (R0 - rEnd) / sp;
  const dir = r() < 0.5 ? 1 : -1, a0 = Math.PI / 2 + R(-0.5, 0.5);
  const at = (th: number, rad: number): Raw => ({ x: Math.cos(a0 + dir * th) * rad, y: Math.sin(a0 + dir * th) * rad, w, pw: w });
  const raw: Raw[] = [];
  for (let th = 0; th < turns * Math.PI * 2; ) {
    const rad = R0 - (sp * th) / (Math.PI * 2);
    raw.push(at(th, rad));
    th += 0.5 / rad;
  }
  raw.push({ x: 0, y: 0, w, pw: w });
  const path = resample(raw);
  // Ramps pointing at the middle, where there's an arm inside to land on.
  const ramps: { at: Vec; dir: Vec }[] = [];
  for (const frac of [0.2, 0.45]) {
    if (r() < 0.35) continue;
    const p = path[Math.floor(path.length * frac)];
    const d = Math.hypot(p.x, p.y);
    if (d - sp < g + 2) continue;
    ramps.push({ at: v(p.x * (1 - (w * 0.3) / d), p.y * (1 - (w * 0.3) / d)), dir: v(-p.x / d, -p.y / d) });
  }
  return {
    shape: "spiral",
    path,
    cupAtEnd: true,
    menu: ["slope", "boost", "gate", "stream"],
    ramps,
    extent: [v(-R0 - w - 16, -R0 - w - 16), v(R0 + w + 16, R0 + w + 16)],
    stamp: (F, P) => {
      for (const f of [F, P]) {
        for (let i = 1; i < path.length; i++) f.capsule(path[i - 1], path[i], w, w, union);
        f.disk(v(0, 0), g, smax(2));
      }
    },
  };
}

// A loop round a walled green whose only gate faces away from the tee: you have to go all the way
// round. Round or square. One side is clear; the other has posts to bank off.
function loop({ r, R }: Rand): Layout {
  const square = r() < 0.45;
  const Rr = R(17, 23), w = R(4.5, 5.6), g = Math.min(R(5, 6.5), Rr - w - 4);
  const gw = R(2.4, 3);
  const L0 = R(24, 36);
  const way = r() < 0.5 ? 1 : -1;
  const rough = R(2, 4.5);
  const raw: Raw[] = [];
  line({ x: 0, y: Rr + L0, w, pw: w + rough }, { x: 0, y: Rr, w, pw: w }, raw);
  const ring: Raw[] = [];
  if (square) {
    const c = [v(0, Rr), v(way * Rr, Rr), v(way * Rr, -Rr), v(0, -Rr)].map((p) => ({ ...p, w, pw: w }));
    for (let i = 0; i < c.length - 1; i++) line(c[i], c[i + 1], raw);
  } else
    for (let a = 0; a <= Math.PI; a += 0.4 / Rr) raw.push({ x: Math.sin(a) * Rr * way, y: Math.cos(a) * Rr, w, pw: w });
  line({ x: 0, y: -Rr, w: gw, pw: gw }, { x: 0, y: 0, w: gw, pw: gw }, raw);
  raw.push({ x: 0, y: 0, w: gw, pw: gw });
  for (let a = 0; a <= Math.PI * 2; a += 0.4 / Rr) ring.push({ x: Math.sin(a) * Rr, y: Math.cos(a) * Rr, w, pw: w });
  const path = resample(raw);
  const posts = [0.3, 0.5, 0.7].map((k) => {
    const a = Math.PI * k;
    return square ? v(-way * Rr, Rr - k * 2 * Rr) : v(-way * Math.sin(a) * Rr, Math.cos(a) * Rr);
  });
  return {
    shape: "loop",
    path,
    cupAtEnd: true,
    menu: ["slope", "boost", "gate", "stream"],
    posts,
    extent: [v(-Rr - w - 16, -Rr - w - 16), v(Rr + w + 16, Rr + L0 + 16)],
    stamp: (F, P) => {
      // The way in, with rough either side.
      F.capsule(v(0, Rr + L0), v(0, Rr), w, w, union);
      P.capsule(v(0, Rr + L0), v(0, Rr), w + rough, w, union);
      for (const f of [F, P]) {
        if (square) {
          const c = [v(-Rr, Rr), v(Rr, Rr), v(Rr, -Rr), v(-Rr, -Rr)];
          for (let i = 0; i < 4; i++) f.box(c[i], c[(i + 1) % 4], w, w, union);
          f.box(v(-g, 0), v(g, 0), g, 0, union);
          f.box(v(0, -Rr), v(0, -g), gw, 0, union);
        } else {
          for (let i = 1; i < ring.length; i++) f.capsule(ring[i - 1], ring[i], w, w, union);
          f.disk(v(0, 0), g, union);
          f.capsule(v(0, -Rr), v(0, -g + 0.5), gw, gw, union);
        }
      }
    },
  };
}

// --- Names ---

const FIRST = ["Maple", "Heron", "Willow", "Clover", "Foxglove", "Bramble", "Thistle", "Juniper", "Meadow", "Hollow", "Badger", "Kestrel", "Fern", "Mossy", "Oak", "Wren", "Lark", "Elder", "Hazel", "Sorrel"];
const LAST = ["Bend", "Run", "Crossing", "Hollow", "Rise", "Dell", "Green", "Glen", "Reach", "Turn", "Brook", "Way", "Fold", "Knoll", "Corner", "Lane"];

const SHAPE_WORDS: Partial<Record<Shape, string[]>> = {
  spiral: ["Coil", "Spiral", "Whirl", "Swirl", "Snail"],
  switchback: ["Switchback", "Zigzag", "Hairpins", "Ladder", "Stairs"],
  loop: ["Loop", "Ring", "Roundabout", "Orbit", "Donut"],
};

// --- Generation ---

export type HoleStats = { length: number; bot: number; features: string[]; shape: Shape };
export type GenHole = Course & { seed: number; stats: HoleStats };

// `debug`, if passed, is told the shape and what the bot scored, even for holes that get thrown out.
export function generate(seed: number, theme: Theme = "hills", debug?: { shape?: Shape; bot?: number; keep?: boolean }): GenHole | null {
  const r = rng(seed * 7919 + 17);
  const R = (a: number, b: number) => a + r() * (b - a);
  const features: string[] = [];

  // The shape first: doglegs most often, then loops, spirals and switchbacks.
  const roll = r();
  const lay = roll < 0.36 ? bends({ r, R }) : roll < 0.58 ? loop({ r, R }) : roll < 0.8 ? spiral({ r, R }) : switchback({ r, R });
  if (!lay) return null;
  if (debug) debug.shape = lay.shape;
  const path = lay.path;
  const total = path[path.length - 1].s;
  if (total < 100 || total > 240) return null;
  const at = (s: number): Sample => path[Math.max(0, Math.min(path.length - 1, Math.round(s)))];
  const normal = (p: Sample) => v(-p.ty, p.tx);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of lay.extent) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const P = Field.over({ x0, y0, x1, y1 }); // everything playable
  const F = P.copyShape(); // the fairway; the rest of P is rough
  const W = P.copyShape(); // water
  const S = P.copyShape(); // sand
  lay.stamp(F, P);
  // Widening the course widens both.
  const both = {
    disk: (c: Vec, rad: number, op: (a: number, b: number) => number) => (F.disk(c, rad, op), P.disk(c, rad, op)),
    capsule: (a: Vec, b: Vec, ra: number, rb: number, op: (a: number, b: number) => number) => (F.capsule(a, b, ra, rb, op), P.capsule(a, b, ra, rb, op)),
  };
  const ctl = lay.ctl ?? [];

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
      left.push(v(p.x + n.x * (p.pw + extra), p.y + n.y * (p.pw + extra)));
      right.push(v(p.x - n.x * (p.pw + extra), p.y - n.y * (p.pw + extra)));
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
  const cup = lay.cupAtEnd ? v(path[path.length - 1].x, path[path.length - 1].y) : v(end.x + normal(end).x * R(-end.w * 0.3, end.w * 0.3), end.y + normal(end).y * R(-end.w * 0.3, end.w * 0.3));
  if (!lay.cupAtEnd) both.disk(cup, R(5, 6.5), smax(3));
  claim(total - (lay.cupAtEnd ? 24 : 12), total);
  const green = r();
  if (green < 0.4) zones.push({ kind: "mound", poly: circlePoly(cup, 5.5), center: cup, radius: 5.5, strength: -R(1.2, 2) });
  else if (green < 0.65) zones.push({ kind: "mound", poly: circlePoly(cup, 4.5), center: v(cup.x + R(-1, 1), cup.y + R(-1, 1)), radius: 4.5, strength: R(1.6, 2.6) });

  const tee = at(3.2);
  claim(0, 9);

  // Features, three to five, no two on top of each other.
  const menu = lay.menu;
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
      const radius = R(3.5, 6);
      const c = v(b.x + n0.x * inward * R(0.5, 2.5), b.y + n0.y * inward * R(0.5, 2.5));
      both.disk(c, radius + R(5, 7), smax(4));
      W.blob(c, radius, r, union);
      claim(b.s - 9, b.s + 9);
      features.push("pond");
      // A ramp straight at the far side, for anyone brave.
      if (r() < 0.6) {
        const from = at(b.s - R(12, 16));
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
      const half = R(6, 10), ir = R(1.8, 3.2);
      const shift = R(-1.5, 1.5);
      const a = v(at(s - half).x + n0.x * shift, at(s - half).y + n0.y * shift);
      const b = v(at(s + half).x + n0.x * shift, at(s + half).y + n0.y * shift);
      for (let t = s - half - 5; t <= s + half + 5; t += 1) both.disk(at(t), at(t).pw + ir + R(3, 4), smax(3));
      both.capsule(a, b, ir, ir, cut(1.5));
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
      const reach = p.pw + (lay.shape === "bends" ? 8 : 0.8);
      W.capsule(v(p.x - n0.x * reach, p.y - n0.y * reach), v(p.x + n0.x * reach, p.y + n0.y * reach), half, half, union);
      const off = R(-p.w * 0.45, p.w * 0.45);
      const bw = Math.min(R(2.6, 3.3), p.w * 1.2);
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
      const span = p.pw + (lay.shape === "bends" ? 1 : 0.6);
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
      const len = R(14, 24);
      const s = spot(0.15, 0.75, len);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const sign = r() < 0.5 ? 1 : -1;
      zones.push({ kind: "slope", poly: ribbon(s - len / 2, s + len / 2, lay.shape === "bends" ? 2 : 0.6), dir: v(n0.x * sign, n0.y * sign), strength: R(2.2, 3.4) });
      claim(s - len / 2, s + len / 2);
      features.push("slope");
    } else if (kind === "chamber") {
      // A wide open space with posts to bank off.
      const s = spot(0.3, 0.72, 14);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const c = v(p.x + n0.x * R(-2, 2), p.y + n0.y * R(-2, 2));
      const cr = p.w * R(1.4, 1.8);
      both.disk(c, cr, smax(4));
      const k = 4 + Math.floor(r() * 4);
      const rot = r() * Math.PI;
      for (let i = 0; i < k; i++) {
        const a = rot + (i / k) * Math.PI * 2;
        bumpers.push({ at: v(c.x + Math.cos(a) * cr * 0.5, c.y + Math.sin(a) * cr * 0.5), r: R(0.5, 0.7), kick: 1.2 });
      }
      if (r() < 0.5) bumpers.push({ at: c, r: 0.8, kick: 1.2 });
      claim(s - cr, s + cr);
      features.push("chamber");
      if (r() < 0.6) boxes.push(v(c.x + Math.cos(rot + Math.PI / k) * cr * 0.75, c.y + Math.sin(rot + Math.PI / k) * cr * 0.75));
    } else if (kind === "boost") {
      // A run of speed pads down a straight.
      const s = spot(0.15, 0.7, 16);
      if (s === null) continue;
      const n = 2 + Math.floor(r() * 2);
      const off = R(-0.35, 0.35);
      for (let i = 0; i < n; i++) {
        const p = at(s - 6 + i * 6), n0 = normal(p);
        const c = v(p.x + n0.x * p.w * off, p.y + n0.y * p.w * off);
        zones.push({ kind: "boost", poly: rect(c, v(p.tx, p.ty), 2.6, 2.6), dir: v(p.tx, p.ty), strength: 45 });
      }
      claim(s - 9, s + 9);
      features.push("boost");
    } else if (kind === "hill") {
      const s = spot(0.2, 0.75, 12);
      if (s === null) continue;
      const p = at(s), n0 = normal(p);
      const c = v(p.x + n0.x * R(-p.w * 0.5, p.w * 0.5), p.y + n0.y * R(-p.w * 0.5, p.w * 0.5));
      const hr = R(5, 8);
      both.disk(c, hr * 0.9, smax(3));
      zones.push({ kind: "mound", poly: circlePoly(c, hr), center: c, radius: hr, strength: R(2.6, 3.8) });
      claim(s - 6, s + 6);
      features.push("hill");
    }
  }
  // The shape's own ramps and posts.
  for (const rp of lay.ramps ?? []) {
    const deck = rect(rp.at, rp.dir, 2.6, 2.6);
    if (deck.every((q) => P.at(q.x, q.y) > 0.6 && W.at(q.x, q.y) < -1.5)) {
      zones.push({ kind: "ramp", poly: deck, dir: rp.dir, lift: 0.55 });
      features.push("ramp");
    }
  }
  for (const at0 of lay.posts ?? []) bumpers.push({ at: at0, r: R(0.6, 0.85), kick: 1.2 });
  if (features.filter((f) => f !== "ramp").length < (lay.shape === "bends" ? 3 : 2)) return null;

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
      S.blob(v(p.x + n0.x * side * p.w * 0.55, p.y + n0.y * side * p.w * 0.55), R(2, 3.2), r, union);
    }
  }

  // Outlines. Water reaches the walls; sand stays a little inside them and never touches the cup.
  const greenLoops = contours(P);
  // Rough is whatever's playable but not fairway; the fairway sits on top of it.
  const hasRough = path.some((p) => p.pw > p.w + 0.5);
  const outer = greenLoops.filter((g, i) => !greenLoops.some((o, j) => j !== i && inPoly(g[0], o)));
  const fairway = hasRough ? contours(F.combine(P, (f, pl) => Math.min(f, pl))) : [];
  const water = contours(W.combine(P, (w, p) => Math.min(w, p)));
  S.disk(cup, 1.6, cut(0.5));
  S.disk(v(tee.x, tee.y), 2.5, cut(0.5));
  const sand = contours(S.combine(P, (s, p) => Math.min(s, p - 0.8)).combine(W, (s, w) => Math.min(s, -w - 0.4)));
  zones.unshift(
    ...(hasRough ? outer.map((poly) => ({ kind: "rough" as const, poly })) : []),
    ...fairway.map((poly) => ({ kind: "green" as const, poly })),
    ...sand.map((poly) => ({ kind: "sand" as const, poly })),
    ...water.map((poly) => ({ kind: "water" as const, poly })),
  );
  // Bridges go after the water so they win.
  zones.sort((a, b) => order(a.kind) - order(b.kind));

  // Check it plays: the cup and tee are well inside and away from hazards, and there's a way through.
  const ok = (p: Vec, clear: number) => P.at(p.x, p.y) > clear && W.at(p.x, p.y) < -1 && S.at(p.x, p.y) < -0.3;
  if (!ok(cup, 2) || !ok(tee, 2)) return null;
  const blocked = (p: Vec) => walls.some((w) => w.pts.some((q, i) => i > 0 && segDist(p, w.pts[i - 1], q) < w.w / 2 + BALL_R + 0.1)) || bumpers.some((b) => Math.hypot(p.x - b.at.x, p.y - b.at.y) < b.r + BALL_R + 0.1);
  const route = geodesic(P, W, bridges, blocked, tee, cup);
  if (!route) return null;
  // Boxes all the way along, some on the line and some off it.
  for (const frac of [0.22, 0.42, 0.62, 0.82]) {
    const q = route.points[Math.floor(route.points.length * frac)];
    const p = at(total * frac), n0 = normal(p);
    const off = R(-p.w * 0.5, p.w * 0.5);
    boxes.push(v(q.x + n0.x * off, q.y + n0.y * off));
  }
  boxes.splice(0, boxes.length, ...boxes.filter((b) => ok(b, 1.2) && !blocked(b) && Math.hypot(b.x - tee.x, b.y - tee.y) > 8).slice(0, 6));

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
    name: `${FIRST[seed % FIRST.length]} ${(SHAPE_WORDS[lay.shape] ?? LAST)[Math.floor(seed / FIRST.length) % (SHAPE_WORDS[lay.shape] ?? LAST).length]}`,
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
    stats: { length: Math.round(route.length), bot: 0, features, shape: lay.shape },
  };
  // A bot plays it. It has to get round, and it mustn't be able to hole out in one.
  // A straight line the ball can roll along: well inside the walls, no water on the way.
  const clearLine = (a: Vec, b: Vec) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5);
    for (let i = 1; i <= n; i++) {
      const p = v(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
      if (P.at(p.x, p.y) < BALL_R + 0.5 || (W.at(p.x, p.y) > -0.3 && !bridges.some((br) => inPoly(p, br))) || blocked(p)) return false;
    }
    return true;
  };
  const bot = botPlay(course, route, v(dx, dy), clearLine);
  if (debug) debug.bot = bot;
  if ((bot > 8 || bot <= 2) && !debug?.keep) return null;
  course.stats.bot = bot;
  course.par = Math.max(3, Math.min(7, Math.round(bot * 0.6 + (route.length / 45 + 1.4) * 0.4)));
  return course;
}

const order = (k: Zone["kind"]) => ["rough", "green", "sand", "water", "bridge"].indexOf(k) + 1 || 9;
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

// How far it is to the cup on the ground from everywhere, going round water (bridges are fine) and
// walls: Dijkstra out from the cup on a one-unit grid. The route from the tee runs downhill on it.
type Geo = { length: number; points: Vec[]; at: (p: Vec) => number; toward: (p: Vec, ahead: number) => Vec };
function geodesic(P: Field, W: Field, bridges: Vec[][], blocked: (p: Vec) => boolean, from: Vec, to: Vec): Geo | null {
  const g = 1;
  const x0 = P.x0, y0 = P.y0;
  const nx = Math.ceil(((P.nx - 1) * G) / g), ny = Math.ceil(((P.ny - 1) * G) / g);
  const pass = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p = v(x0 + i * g, y0 + j * g);
      if (P.at(p.x, p.y) < 0.8) continue;
      pass[j * nx + i] = +((W.at(p.x, p.y) < -0.2 || bridges.some((br) => inPoly(p, br))) && !blocked(p));
    }
  const cell = (p: Vec) => Math.max(0, Math.min(ny - 1, Math.round((p.y - y0) / g))) * nx + Math.max(0, Math.min(nx - 1, Math.round((p.x - x0) / g)));
  const dist = new Float32Array(nx * ny).fill(Infinity);
  const goal = cell(to);
  dist[goal] = 0;
  pass[goal] = 1;
  // A binary heap of [distance, cell].
  const heap: number[] = [goal];
  const less = (a: number, b: number) => dist[heap[a]] < dist[heap[b]];
  const push = (k: number) => {
    heap.push(k);
    for (let i = heap.length - 1; i > 0; ) {
      const pi = (i - 1) >> 1;
      if (!less(i, pi)) break;
      [heap[i], heap[pi]] = [heap[pi], heap[i]];
      i = pi;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  const done = new Uint8Array(nx * ny);
  while (heap.length) {
    const cur = pop();
    if (done[cur]) continue;
    done[cur] = 1;
    const ci = cur % nx, cj = Math.floor(cur / nx);
    for (const [di, dj, c] of steps) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const k = nj * nx + ni;
      if (!pass[k]) continue;
      const d = dist[cur] + c * g;
      if (d < dist[k]) {
        dist[k] = d;
        push(k);
      }
    }
  }
  // Anywhere the grid can't reach (right up against a wall), use the nearest cell that can.
  const at = (p: Vec) => {
    const k = cell(p);
    if (dist[k] < Infinity) return dist[k];
    let best = Infinity;
    const ci = k % nx, cj = Math.floor(k / nx);
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const ni = ci + di, nj = cj + dj;
        if (ni >= 0 && nj >= 0 && ni < nx && nj < ny) best = Math.min(best, dist[nj * nx + ni] + Math.hypot(di, dj) * g);
      }
    return best;
  };
  // Downhill from a point toward the cup, `ahead` units along.
  const toward = (p: Vec, ahead: number) => {
    let k = cell(p);
    if (dist[k] === Infinity) {
      const ci = k % nx, cj = Math.floor(k / nx);
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const ni = ci + di, nj = cj + dj;
          if (ni >= 0 && nj >= 0 && ni < nx && nj < ny && dist[nj * nx + ni] < dist[k]) k = nj * nx + ni;
        }
    }
    const start = dist[k];
    while (dist[k] > 0 && start - dist[k] < ahead) {
      const ci = k % nx, cj = Math.floor(k / nx);
      let next = k;
      for (const [di, dj] of steps) {
        const ni = ci + di, nj = cj + dj;
        if (ni >= 0 && nj >= 0 && ni < nx && nj < ny && dist[nj * nx + ni] < dist[next]) next = nj * nx + ni;
      }
      if (next === k) break;
      k = next;
    }
    return v(x0 + (k % nx) * g, y0 + Math.floor(k / nx) * g);
  };
  const length = at(from);
  if (length === Infinity) return null;
  const points: Vec[] = [];
  for (let p = from, guard = 0; guard < 2000; guard++) {
    points.push(p);
    if (Math.hypot(p.x - to.x, p.y - to.y) < 1.5) break;
    p = toward(p, 1);
  }
  points.push(to);
  return { length, points, at, toward };
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

// A decent player: before each shot it tries several (at points further and further along the way to
// the cup, and straight at the cup when it can see it), plays each out, and takes the one that ends
// closest to the cup by the walking distance. Splashing in costs it, the way it costs a player.
function botPlay(course: Course, geo: Geo, shift: Vec, clear: (a: Vec, b: Vec) => boolean): number {
  const world = compile(course);
  let sim = newSim(course, 1);
  const local = (p: Vec) => v(p.x - shift.x, p.y - shift.y);
  const world2 = (p: Vec) => v(p.x + shift.x, p.y + shift.y);
  const settle = (s: Sim) => {
    for (let i = 0; i < 30 / DT && (s.mode === "roll" || s.mode === "out"); i++) step(s, world);
  };
  for (let shot = 0; shot < 10; shot++) {
    const here = v(sim.x, sim.y);
    const tries: { angle: number; power: number }[] = [];
    const aimAt = (p: Vec, extra = 0) => {
      const d = Math.hypot(p.x - here.x, p.y - here.y);
      if (d < 0.5) return;
      for (const k of [0.92, 1.05]) tries.push({ angle: Math.atan2(p.y - here.y, p.x - here.x), power: Math.min(1, powerFor(d * k + extra)) });
    };
    const left = geo.at(local(here));
    if (Math.hypot(course.cup.x - here.x, course.cup.y - here.y) < MAX_ROLL * 0.8 && left < MAX_ROLL) aimAt(course.cup, 0.8);
    // The furthest few points along the way it can see, plus a couple of shorter safe ones.
    const seen: Vec[] = [];
    for (let ahead = 4; ahead < Math.min(left + 4, MAX_ROLL * 0.85); ahead += 3) {
      const p = world2(geo.toward(local(here), ahead));
      if (clear(local(here), local(p))) seen.push(p);
    }
    for (const p of seen.slice(-3)) aimAt(p);
    for (const ahead of [8, 16]) if (ahead < left + 4) aimAt(world2(geo.toward(local(here), ahead)));
    let best: Sim | null = null, bestScore = Infinity;
    for (const t of tries) {
      const s = structuredClone(sim);
      s.events = [];
      shoot(s, t.angle, t.power);
      settle(s);
      const score = s.mode === "sunk" ? -1 : geo.at(local(v(s.x, s.y))) + (s.strokes - sim.strokes - 1) * 25;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return 99;
    sim = best;
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
