// The New York Stock Exchange's clock, shared by the server and phones. Times are ms since the epoch;
// everything else is New York wall time, worked out with Intl (no tz database of our own).

export const INDEX = "^GSPC";
export const RANGES = ["1D", "1W", "1M", "1Y", "5Y"] as const;
export type Range = (typeof RANGES)[number];

// Full closures and 1pm closes, through 2027.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Wall = { y: number; m: number; d: number; hh: number; mm: number; ss: number };
function wall(ms: number): Wall {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}
const dayKey = (w: { y: number; m: number; d: number }) => `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;

/** The instant New York's clock reads hh:mm on that day. */
function at(y: number, m: number, d: number, hh: number, mm: number) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const w = wall(guess);
  const off = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm) - guess; // New York minus UTC
  return guess - off;
}

export type Day = { key: string; open: number; close: number };
function tradingDay(y: number, m: number, d: number): Day | null {
  const key = dayKey({ y, m, d });
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6 || HOLIDAYS.has(key)) return null;
  return { key, open: at(y, m, d, 9, 30), close: at(y, m, d, EARLY.has(key) ? 13 : 16, 0) };
}
function shift(y: number, m: number, d: number, by: number) {
  const t = new Date(Date.UTC(y, m - 1, d + by));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()] as const;
}

/** The trading day `ms` falls on, or the last one before it. */
export function sessionDay(ms: number): Day {
  const w = wall(ms);
  for (let i = 0; i < 10; i++) {
    const [y, m, d] = shift(w.y, w.m, w.d, -i);
    const day = tradingDay(y, m, d);
    if (day && (i > 0 || ms >= day.open - 5.5 * 3600_000)) return day; // from 4am on, today is the day
  }
  throw new Error("no trading day in ten days");
}

export function nextOpen(ms: number): number {
  const w = wall(ms);
  for (let i = 0; i < 10; i++) {
    const [y, m, d] = shift(w.y, w.m, w.d, i);
    const day = tradingDay(y, m, d);
    if (day && day.open > ms) return day.open;
  }
  throw new Error("no trading day in ten days");
}

export type Clock = { state: "open" | "pre" | "post" | "closed"; day: Day; nextOpen: number };
export function marketClock(ms: number): Clock {
  const day = sessionDay(ms);
  const state = ms >= day.open && ms < day.close ? "open" : ms < day.open && ms >= day.open - 5.5 * 3600_000 ? "pre" : ms >= day.close && ms < day.close + 4 * 3600_000 ? "post" : "closed";
  return { state, day, nextOpen: nextOpen(ms) };
}

export const display = (symbol: string) => (symbol === INDEX ? "S&P 500" : symbol.replace("-", "."));
