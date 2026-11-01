import { INDEX, type Range } from "../../../convex/stonks/market";

const two = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1,234.56", or "6,812.34" for the index (points, not dollars). */
export const price = (n: number, symbol?: string) => (symbol === INDEX ? two.format(n) : `$${two.format(n)}`);
/** "+12.34" / "−0.56" with a real minus. */
export const signed = (n: number, symbol?: string) => `${n >= 0 ? "+" : "−"}${price(Math.abs(n), symbol)}`;
export const percent = (n: number) => `${two.format(Math.abs(n))}%`;
export const weight = (n: number) => `${two.format(n)}%`;

const NY = "America/New_York";
const clock = new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "numeric", minute: "2-digit" });
const dayTime = new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const date = new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric", year: "numeric" });
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short", hour: "numeric", minute: "2-digit" });
const short = new Intl.DateTimeFormat("en-US", { timeZone: NY, month: "short", day: "numeric" });

/** What a point on a range's chart is called when you put your finger on it. */
export const pointTime = (t: number, range: Range) => (range === "1D" ? `${clock.format(t)} ET` : range === "1W" || range === "1M" ? dayTime.format(t) : date.format(t));
export const opensAt = (t: number) => `${weekday.format(t)} ET`;
const dayName = new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "long" });
/** "Today", or the session's day when it's over and another day has started (a weekend: "Friday"). */
export const sessionName = (open: number, now: number) => (dayName.format(open) === dayName.format(now) ? "Today" : dayName.format(open));
/** When a trade happened: "12s ago" while it's fresh, then the time ("Fri 7:59 PM ET"). */
export const tradeTime = (t: number, now: number) => (now - t < 3600_000 ? ago(now - t) : `${weekday.format(t)} ET`);
export const asOfDay = (iso: string) => short.format(new Date(`${iso}T12:00:00Z`));
export const periodName: Record<Range, string> = { "1D": "Today", "1W": "Past week", "1M": "Past month", "1Y": "Past year", "5Y": "Past 5 years" };

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
