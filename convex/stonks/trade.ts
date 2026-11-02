// Stonks' paper trading, the rules on their own. Everyone starts with $10,000, and a position is shares
// at an average price: positive is long, negative is short.
//
// A dollar of net worth backs a dollar of positions, long or short, so there's no leverage: shorting
// $1,000 uses $1,000 of what you can invest, even though it puts $1,000 in cash.

export const START_CASH = 10_000;
export const MIN_ORDER = 1; // dollars
const DUST = 1e-6; // shares this small are a rounding error, not a position

export type Side = "buy" | "sell" | "short" | "cover";
export type Position = { symbol: string; shares: number; avg: number };
export type Book = { cash: number; positions: Position[] };
/** What an order asks for: dollars to open a position; shares to close one (none means all of it). */
export type Ask = { side: Side; symbol: string; dollars?: number; shares?: number };
export type Fill = { cash: number; position: Position | null; shares: number; amount: number; realized: number };

export const opens = (side: Side) => side === "buy" || side === "short";

export const netWorth = (book: Book, price: (symbol: string) => number | undefined) =>
  book.positions.reduce((n, p) => n + p.shares * (price(p.symbol) ?? p.avg), book.cash);

/** What's free to put into new positions. Prices moving against you can take it below zero. */
export function buyingPower(book: Book, price: (symbol: string) => number | undefined) {
  const exposure = book.positions.reduce((n, p) => n + Math.abs(p.shares) * (price(p.symbol) ?? p.avg), 0);
  return netWorth(book, price) - exposure;
}

/** Why an order can't happen against this book, if it can't. */
export function refusal(book: Book, ask: Ask): string | null {
  const held = book.positions.find((p) => p.symbol === ask.symbol)?.shares ?? 0;
  if (ask.side === "buy" && held < 0) return "Cover your short first.";
  if (ask.side === "short" && held > 0) return "Sell your shares first.";
  if (ask.side === "sell" && held <= 0) return "You don't own any.";
  if (ask.side === "cover" && held >= 0) return "You aren't short.";
  return null;
}

/** An order meeting a price. Opening spends at most what's free by then; closing takes at most what's held. */
export function fill(book: Book, ask: Ask, price: number, power: number): Fill | { refused: string } {
  const why = refusal(book, ask);
  if (why) return { refused: why };
  const pos = book.positions.find((p) => p.symbol === ask.symbol);
  const held = pos?.shares ?? 0;
  if (opens(ask.side)) {
    const amount = Math.min(ask.dollars ?? 0, power);
    if (amount < MIN_ORDER) return { refused: "Not enough to invest." };
    const shares = amount / price;
    const total = Math.abs(held) + shares;
    const avg = (Math.abs(held) * (pos?.avg ?? 0) + amount) / total;
    const long = ask.side === "buy";
    return { cash: book.cash + (long ? -amount : amount), position: { symbol: ask.symbol, shares: long ? total : -total, avg }, shares, amount, realized: 0 };
  }
  const shares = Math.min(ask.shares ?? Math.abs(held), Math.abs(held));
  if (shares <= 0) return { refused: "Nothing to close." };
  const amount = shares * price;
  const long = ask.side === "sell";
  const left = Math.abs(held) - shares;
  const realized = long ? shares * (price - pos!.avg) : shares * (pos!.avg - price);
  return {
    cash: book.cash + (long ? amount : -amount),
    position: left < DUST ? null : { symbol: ask.symbol, shares: long ? left : -left, avg: pos!.avg },
    shares,
    amount,
    realized,
  };
}

// ---- Other currencies ----

// Yahoo quotes a few markets in cents of their currency: London's GBp is a hundredth of a pound.
const MINOR: Record<string, [string, number]> = { GBp: ["GBP", 100], GBX: ["GBP", 100], ILA: ["ILS", 100], ZAc: ["ZAR", 100], ZAC: ["ZAR", 100] };

/** The currency's pair against the dollar, or null for dollars. */
export function fxPair(currency: string | undefined): string | null {
  if (!currency || currency === "USD") return null;
  const major = MINOR[currency]?.[0] ?? currency.toUpperCase();
  return major === "USD" ? null : `${major}USD=X`;
}

/** Dollars per one unit of the quoted currency, given the pair's price; undefined until the pair's known. */
export function toUsd(currency: string | undefined, pairPrice: number | undefined): number | undefined {
  if (!fxPair(currency)) return 1;
  if (!pairPrice) return undefined;
  return pairPrice / (MINOR[currency!]?.[1] ?? 1);
}
