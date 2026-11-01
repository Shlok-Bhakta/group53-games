// Pure helpers for Stonks, shared by the server and its tests.

export type Point = [number, number]; // [ms, price]

export const MINUTE = 60_000;
export const minuteOf = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;

/** Live share of the index. SPY's file gives each weight as of a day's close; since then a stock's share
 *  moves with its own price over the index's: w = w0 · (p/p0) / (S/S0). */
export function liveWeight(w0: number, price?: number, base?: number, index?: number, indexBase?: number) {
  if (!price || !base || !index || !indexBase) return w0;
  return (w0 * (price / base)) / (index / indexBase);
}

/** Index points a stock has moved the index today: its share at the previous close times its move. */
export function contribution(w0: number, price: number, prevClose?: number, base?: number, indexPrev?: number, indexBase?: number) {
  if (!prevClose || !indexPrev) return 0;
  const before = liveWeight(w0, prevClose, base, indexPrev, indexBase);
  return (before / 100) * (price / prevClose - 1) * indexPrev;
}

/** At most `n` points: the last price in each of n equal time buckets. Keeps the first and last point. */
export function downsample(points: Point[], n: number): Point[] {
  if (points.length <= n) return points;
  const t0 = points[0][0], span = points.at(-1)![0] - t0 || 1;
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

/** The 1D series with a finished minute added (or its close corrected, if the minute's already there). */
export function withMinute(points: Point[], minute: number, close: number): Point[] {
  const last = points.at(-1);
  if (last && last[0] === minute) return [...points.slice(0, -1), [minute, close]];
  if (last && last[0] > minute) return points;
  return [...points, [minute, close]];
}
