import { ago } from "@/lib/time";
import type { Range } from "../../../convex/stonks/market";

const two = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formats = new Map<string, Intl.NumberFormat>();
function money(n: number, currency: string, digits: number) {
  const key = `${currency}:${digits}`;
  let f = formats.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    formats.set(key, f);
  }
  return f.format(n);
}
// Cheap things need more places: a dogecoin's 7 cents, a yen's 0.6 of a cent.
const placesFor = (n: number) => (n === 0 || Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 4 : 6);
// Quoted in cents of a currency, as London is.
const MINOR: Record<string, string> = { GBp: "p", GBX: "p", ILA: "ag", ZAc: "c", ZAC: "c" };

/** How a thing's prices read: a currency code, or "" for plain numbers (index points, exchange rates). */
export const unitOf = (q: { type?: string; currency?: string } | null | undefined) => (q?.type === "INDEX" || q?.type === "CURRENCY" ? "" : (q?.currency ?? "USD"));

/** "$1,234.56", "¥3,056.00", "119.10p", or "6,812.34" where there's no unit. */
export function price(n: number, unit: string = "USD") {
  const places = placesFor(n);
  if (unit === "") return new Intl.NumberFormat("en-US", { minimumFractionDigits: Math.max(places, 2), maximumFractionDigits: Math.max(places, 2) }).format(n);
  if (MINOR[unit]) return `${two.format(n)}${MINOR[unit]}`;
  return money(n, unit, places);
}
/** "+12.34" / "−0.56" with a real minus. */
export const signed = (n: number, unit?: string) => `${n >= 0 ? "+" : "−"}${price(Math.abs(n), unit)}`;
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
export const tradeTime = (t: number, now: number) => (now - t < 3600_000 ? ago(now - t, { seconds: true }) : `${weekday.format(t)} ET`);
/** Where a price came from, as a reader would put it. */
export const sourceName = (s: string) => ({ yahoo: "Yahoo", nasdaq: "Nasdaq", history: "Yahoo" })[s] ?? s;
export const asOfDay = (iso: string) => short.format(new Date(`${iso}T12:00:00Z`));
export const periodName: Record<Range, string> = { "1D": "Today", "1W": "Past week", "1M": "Past month", "1Y": "Past year", "5Y": "Past 5 years" };

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const compact1 = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** "$5.03T", "41.9M" */
export const big = (n: number, money = false) => `${money ? "$" : ""}${compact.format(n)}`;
export const count = (n: number) => compact1.format(n);
/** A fraction as a percent: 0.0031 -> "0.31%" */
export const frac = (n: number, signed = false) => `${signed && n > 0 ? "+" : n < 0 ? "−" : ""}${two.format(Math.abs(n) * 100)}%`;
export const ratio = (n: number) => two.format(n);
const day = new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short", month: "short", day: "numeric" });
export const dayOf = (t: number) => day.format(t);
const dayOnly = new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short" });
/** "Mon" if it's within the week, else "Nov 12". */
export const soon = (t: number, now: number) => (t - now < 6 * 86_400_000 ? dayOnly.format(t) : short.format(t));
/** Points moved on the index: "+12.3", "−4.0" */
export const pts = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;
export const RATING: Record<string, string> = { strong_buy: "Strong buy", buy: "Buy", hold: "Hold", underperform: "Underperform", sell: "Sell" };

/** "4.87 shares", "1 share", "0.024 BTC", "100 units": how much of something, in what it comes in. */
export const shareCount = (n: number, symbol = "") => {
  const x = Math.abs(n);
  const amount = x.toLocaleString("en-US", { maximumFractionDigits: x < 1 ? 6 : 3 });
  const coin = symbol.match(/^([A-Z0-9]+)-[A-Z]{3,4}$/)?.[1];
  if (coin) return `${amount} ${coin}`;
  if (symbol.includes("=")) return `${amount} ${x === 1 ? "unit" : "units"}`;
  return `${amount} ${x === 1 ? "share" : "shares"}`;
};

const KINDS: Record<string, string> = { ETF: "ETF", CRYPTOCURRENCY: "Crypto", CURRENCY: "Forex", FUTURE: "Future", INDEX: "Index", MUTUALFUND: "Fund" };
/** What a search result is, when it isn't simply a stock. */
export const kindOf = (type?: string) => (type ? KINDS[type] : undefined);
