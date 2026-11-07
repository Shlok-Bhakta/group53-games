import { describe, expect, test } from "vitest";
import { buyingPower, fill, fxPair, netWorth, refusal, START_CASH, toUsd, type Book } from "./trade";

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

describe("currencies", () => {
  test("each currency's pair against the dollar, with Yahoo's cents mapped to their whole currency", () => {
    expect(fxPair(undefined)).toBeNull();
    expect(fxPair("")).toBeNull();
    expect(fxPair("USD")).toBeNull();
    expect(fxPair("usd")).toBeNull();
    expect(fxPair("JPY")).toBe("JPYUSD=X");
    expect(fxPair("eur")).toBe("EURUSD=X");
    expect(fxPair("GBp")).toBe("GBPUSD=X");
    expect(fxPair("GBX")).toBe("GBPUSD=X");
    expect(fxPair("GBP")).toBe("GBPUSD=X");
    expect(fxPair("ILA")).toBe("ILSUSD=X");
    expect(fxPair("ZAc")).toBe("ZARUSD=X");
    expect(fxPair("ZAC")).toBe("ZARUSD=X");
    // Anything else is taken at its word: its pair just won't have a price until Yahoo has one.
    expect(fxPair("XYZ")).toBe("XYZUSD=X");
  });

  test("dollars per unit: 1 for dollars, the pair's price for whole currencies, a hundredth of it for cents", () => {
    expect(toUsd(undefined, undefined)).toBe(1);
    expect(toUsd("USD", undefined)).toBe(1);
    expect(toUsd("USD", 7)).toBe(1); // a dollar is a dollar whatever a stray pair says
    expect(toUsd("JPY", 0.0065)).toBe(0.0065);
    expect(toUsd("GBP", 1.25)).toBe(1.25);
    expect(toUsd("GBp", 1.25)).toBe(1.25 / 100);
    expect(toUsd("GBX", 1.3)).toBe(1.3 / 100);
    expect(toUsd("ILA", 0.27)).toBe(0.27 / 100);
    expect(toUsd("ZAc", 0.055)).toBe(0.055 / 100);
    expect(toUsd("ZAC", 0.055)).toBe(0.055 / 100);
  });

  test("a rate that isn't known yet is undefined, so an order waits instead of filling at 0 or 1", () => {
    expect(toUsd("JPY", undefined)).toBeUndefined();
    expect(toUsd("GBp", undefined)).toBeUndefined();
    expect(toUsd("XYZ", undefined)).toBeUndefined();
    expect(toUsd("JPY", 0)).toBeUndefined();
  });
});
