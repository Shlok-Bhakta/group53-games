export type Point = [number, number];

export const MINUTE = 60_000;
export const minuteOf = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;

export function liveWeight(w0: number, price?: number, base?: number, index?: number, indexBase?: number) {
  if (!price || !base || !index || !indexBase) return w0;
  return (w0 * (price / base)) / (index / indexBase);
}

export function contribution(w0: number, price: number, prevClose?: number, base?: number, indexPrev?: number, indexBase?: number) {
  if (!prevClose || !indexPrev) return 0;
  const before = liveWeight(w0, prevClose, base, indexPrev, indexBase);
  return (before / 100) * (price / prevClose - 1) * indexPrev;
}

export function downsample(points: Point[], n: number): Point[] {
  if (points.length <= n) return points;
  const t0 = points[0][0],
    span = points.at(-1)![0] - t0 || 1;
  const out: Point[] = [points[0]];
  let bucket = 0;
  for (const p of points.slice(1)) {
    const b = Math.min(n - 1, Math.floor(((p[0] - t0) / span) * (n - 1)));
    if (b === bucket && out.length > 1) out[out.length - 1] = p;
    else out.push(p);
    bucket = b;
  }
  return out;
}

export function withMinute(points: Point[], minute: number, close: number): Point[] {
  const last = points.at(-1);
  if (last && last[0] === minute) return [...points.slice(0, -1), [minute, close]];
  if (last && last[0] > minute) return points;
  return [...points, [minute, close]];
}
