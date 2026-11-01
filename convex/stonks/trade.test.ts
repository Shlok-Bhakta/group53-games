import { describe, expect, test } from "vitest";
import { buyingPower, fill, netWorth, refusal, START_CASH, type Book } from "./trade";

const empty: Book = { cash: START_CASH, positions: [] };
const at = (prices: Record<string, number>) => (s: string) => prices[s];
const ok = <T extends object>(f: T | { refused: string }) => {
  if ("refused" in f) throw new Error(f.refused);
  return f;
};

describe("paper trading rules", () => {
  test("buying moves cash into shares, at an average price", () => {
    const a = ok(fill(empty, { side: "buy", symbol: "NVDA", dollars: 1000 }, 200, START_CASH));
    expect(a.cash).toBe(9000);
    expect(a.position).toEqual({ symbol: "NVDA", shares: 5, avg: 200 });
    const book: Book = { cash: a.cash, positions: [a.position!] };
    const b = ok(fill(book, { side: "buy", symbol: "NVDA", dollars: 1500 }, 300, 8000));
    expect(b.position).toEqual({ symbol: "NVDA", shares: 10, avg: 250 });
    expect(netWorth({ cash: b.cash, positions: [b.position!] }, at({ NVDA: 300 }))).toBe(10500);
  });

  test("a short puts cash in and owes shares: it gains when the price falls and loses when it rises", () => {
    const s = ok(fill(empty, { side: "short", symbol: "TSLA", dollars: 2000 }, 400, START_CASH));
    expect(s.cash).toBe(12000);
    expect(s.position).toEqual({ symbol: "TSLA", shares: -5, avg: 400 });
    const book: Book = { cash: s.cash, positions: [s.position!] };
    expect(netWorth(book, at({ TSLA: 400 }))).toBe(10000);
    expect(netWorth(book, at({ TSLA: 300 }))).toBe(10500);
    expect(netWorth(book, at({ TSLA: 500 }))).toBe(9500);
    const c = ok(fill(book, { side: "cover", symbol: "TSLA" }, 300, 0));
    expect(c.position).toBeNull();
    expect(c.cash).toBe(10500);
    expect(c.realized).toBe(500);
  });

  test("a dollar of net worth backs a dollar of positions, long or short", () => {
    expect(buyingPower(empty, at({}))).toBe(10000);
    const long: Book = { cash: 6000, positions: [{ symbol: "A", shares: 20, avg: 200 }] };
    expect(buyingPower(long, at({ A: 200 }))).toBe(6000);
    const short: Book = { cash: 14000, positions: [{ symbol: "B", shares: -20, avg: 200 }] };
    expect(buyingPower(short, at({ B: 200 }))).toBe(6000);
    // Short proceeds can't be spent twice, and a squeeze takes it below zero.
    expect(buyingPower(short, at({ B: 400 }))).toBe(-2000);
  });

  test("opening spends at most what's free; closing takes at most what's held", () => {
    expect(ok(fill(empty, { side: "buy", symbol: "A", dollars: 5000 }, 100, 3000)).amount).toBe(3000);
    expect(fill(empty, { side: "buy", symbol: "A", dollars: 5000 }, 100, 0)).toEqual({ refused: "Not enough to invest." });
    const book: Book = { cash: 0, positions: [{ symbol: "A", shares: 10, avg: 100 }] };
    const half = ok(fill(book, { side: "sell", symbol: "A", shares: 4 }, 150, 0));
    expect(half.position).toEqual({ symbol: "A", shares: 6, avg: 100 });
    expect(half.realized).toBe(200);
    expect(ok(fill(book, { side: "sell", symbol: "A", shares: 99 }, 150, 0)).position).toBeNull();
  });

  test("you can't be long and short the same stock", () => {
    const long: Book = { cash: 0, positions: [{ symbol: "A", shares: 1, avg: 100 }] };
    const short: Book = { cash: 0, positions: [{ symbol: "A", shares: -1, avg: 100 }] };
    expect(refusal(long, { side: "short", symbol: "A" })).toBe("Sell your shares first.");
    expect(refusal(short, { side: "buy", symbol: "A" })).toBe("Cover your short first.");
    expect(refusal(empty, { side: "sell", symbol: "A" })).toBe("You don't own any.");
    expect(refusal(empty, { side: "cover", symbol: "A" })).toBe("You aren't short.");
    expect(refusal(long, { side: "buy", symbol: "A" })).toBeNull();
  });
});
