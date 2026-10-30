import { closest, edges, inPoly, rng, v, type Vec } from "./engine";
import { dcos, dsin, hyp } from "./dmath";
// Course geometry is part of the physics, so it uses the portable math too (see dmath.ts).

// Shape helpers for writing courses by hand.

export const P = (...n: number[]): Vec[] => {
  const out: Vec[] = [];
  for (let i = 0; i < n.length; i += 2) out.push(v(n[i], n[i + 1]));
  return out;
};

export const rect = (x: number, y: number, w: number, h: number) => P(x, y, x + w, y, x + w, y + h, x, y + h);

export function rrect(x: number, y: number, w: number, h: number, r: number, n = 5): Vec[] {
  r = Math.min(r, w / 2, h / 2);
  const out: Vec[] = [];
  const corners = [
    [x + w - r, y + r, -Math.PI / 2],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ] as const;
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      out.push(v(cx + dcos(a) * r, cy + dsin(a) * r));
    }
  return out;
}

// Rounded across the top, square at the bottom: a pinball table.
export function archRect(x: number, y: number, w: number, h: number, r: number, n = 8): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    out.push(v(x + w - r + dcos(a) * r, y + r + dsin(a) * r));
  }
  out.push(v(x + w, y + h), v(x, y + h));
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * (Math.PI / 2);
    out.push(v(x + r + dcos(a) * r, y + r + dsin(a) * r));
  }
  return out;
}

export function circle(cx: number, cy: number, r: number, n = 24): Vec[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return v(cx + dcos(a) * r, cy + dsin(a) * r);
  });
}

// An organic shape: an ellipse with a wobbly edge, the same every time for the same seed.
export function blob(cx: number, cy: number, rx: number, ry: number, seed = 1, wob = 0.13, n = 32): Vec[] {
  const s = seed * 1.7;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wob * (dsin(3 * a + s) * 0.55 + dsin(5 * a + s * 2.3) * 0.3 + dsin(2 * a + s * 0.7) * 0.25);
    return v(cx + dcos(a) * rx * k, cy + dsin(a) * ry * k);
  });
}

// A winding strip (a fairway, a river): a smooth curve through [x, y, half width] points.
export function ribbon(spec: [number, number, number][], samples = 8): Vec[] {
  const pts: [number, number, number][] = [];
  const at = (i: number) => spec[Math.max(0, Math.min(spec.length - 1, i))];
  for (let i = 0; i < spec.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < samples; k++) {
      const t = k / samples, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), p1[2] + (p2[2] - p1[2]) * t]);
    }
  }
  pts.push(spec[spec.length - 1]);
  const left: Vec[] = [], right: Vec[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = hyp(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    left.push(v(p[0] + nx * p[2], p[1] + ny * p[2]));
    right.push(v(p[0] - nx * p[2], p[1] - ny * p[2]));
  });
  return [...left, ...right.reverse()];
}

export function polyDist(p: Vec, poly: Vec[]) {
  if (inPoly(p, poly)) return 0;
  let d = Infinity;
  for (const [a, b] of edges(poly)) {
    const q = closest(p, a, b);
    d = Math.min(d, hyp(p.x - q.x, p.y - q.y));
  }
  return d;
}

export function centroid(poly: Vec[]): Vec {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return v(x / poly.length, y / poly.length);
}

export function bbox(poly: Vec[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

// Shrink (k < 1) or grow a shape toward its middle. Good enough for the rounded shapes courses use.
export function scalePoly(poly: Vec[], k: number, by = 0): Vec[] {
  const c = centroid(poly);
  return poly.map((p) => {
    const dx = p.x - c.x, dy = p.y - c.y;
    const l = hyp(dx, dy) || 1;
    return v(c.x + dx * k - (dx / l) * by, c.y + dy * k - (dy / l) * by);
  });
}

// Random points that keep clear of everything `blocked` says no to, and of each other.
export function scatter(seed: number, count: number, area: [number, number, number, number], gap: number, blocked: (p: Vec) => boolean, tries = 30): Vec[] {
  const r = rng(seed);
  const out: Vec[] = [];
  for (let i = 0; i < count * tries && out.length < count; i++) {
    const p = v(area[0] + r() * area[2], area[1] + r() * area[3]);
    if (blocked(p)) continue;
    if (out.some((q) => hyp(q.x - p.x, q.y - p.y) < gap)) continue;
    out.push(p);
  }
  return out;
}
