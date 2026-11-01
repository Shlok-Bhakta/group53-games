import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { downsample, liveWeight, withMinute, type Point } from "./stonks/board";
import { marketClock, nextOpen, sessionDay } from "./stonks/market";
import { setup } from "./test.setup";

const ET = (s: string) => new Date(`${s}-04:00`).getTime(); // EDT (Oct 2026 is still daylight time until Nov 1)
const EST = (s: string) => new Date(`${s}-05:00`).getTime();

describe("market clock", () => {
  test("open, pre, post and closed, in New York time", () => {
    expect(marketClock(ET("2026-10-30T10:00:00")).state).toBe("open");
    expect(marketClock(ET("2026-10-30T08:00:00")).state).toBe("pre");
    expect(marketClock(ET("2026-10-30T17:00:00")).state).toBe("post");
    expect(marketClock(ET("2026-10-31T12:00:00")).state).toBe("closed"); // Saturday
  });
  test("a weekend belongs to Friday's session, and opens on Monday across the clock change", () => {
    const sat = ET("2026-10-31T12:00:00");
    expect(sessionDay(sat).key).toBe("2026-10-30");
    expect(nextOpen(sat)).toBe(EST("2026-11-02T09:30:00"));
  });
  test("holidays and early closes", () => {
    expect(sessionDay(EST("2026-11-26T12:00:00")).key).toBe("2026-11-25"); // Thanksgiving
    expect(sessionDay(EST("2026-11-27T12:00:00")).close).toBe(EST("2026-11-27T13:00:00"));
  });
});

describe("board math", () => {
  test("a stock's share of the index moves with its price over the index's", () => {
    expect(liveWeight(7.5, 110, 100, 6000, 6000)).toBeCloseTo(8.25);
    expect(liveWeight(7.5, 110, 100, 6600, 6000)).toBeCloseTo(7.5);
    expect(liveWeight(7.5, undefined, 100, 6000, 6000)).toBe(7.5);
  });
  test("downsampling keeps the ends and at most n points", () => {
    const pts: Point[] = Array.from({ length: 390 }, (_, i) => [i * 60_000, 100 + i]);
    const d = downsample(pts, 48);
    expect(d.length).toBeLessThanOrEqual(49);
    expect(d[0]).toEqual(pts[0]);
    expect(d.at(-1)).toEqual(pts.at(-1));
  });
  test("a finished minute is added once", () => {
    const pts: Point[] = [[0, 1], [60_000, 2]];
    expect(withMinute(pts, 120_000, 3)).toEqual([...pts, [120_000, 3]]);
    expect(withMinute(pts, 60_000, 5)).toEqual([[0, 1], [60_000, 5]]);
    expect(withMinute(pts, 0, 9)).toBe(pts);
  });
});

const tick = (symbol: string, price: number, time: number, extra = {}) => ({ symbol, price, time, recv: time + 50, source: "yahoo", session: "regular", ...extra });

describe("stonks", () => {
  test("the board ranks holdings by live weight, and the watch list follows the file", async () => {
    const t = setup();
    await t.mutation(internal.stonks.holdings, {
      asOf: "2026-10-29",
      indexBase: 6000,
      holdings: [
        { symbol: "NVDA", name: "NVIDIA CORP", weight: 7.77, base: 200 },
        { symbol: "AAPL", name: "APPLE INC", weight: 7.65, base: 300 },
      ],
    });
    expect(await t.query(api.stonks.watchlist, {})).toEqual(["^GSPC", "NVDA", "AAPL"]);
    const now = ET("2026-10-30T10:00:00");
    await t.mutation(internal.stonks.ingest, { ticks: [tick("^GSPC", 6000, now), tick("NVDA", 190, now), tick("AAPL", 310, now)], feeds: [{ source: "yahoo", state: "live" }] });
    const b = await t.query(api.stonks.board, {});
    expect(b.rows.map((r) => r.symbol)).toEqual(["AAPL", "NVDA"]); // NVDA fell, AAPL rose: they swap
    expect(b.rows[0]).toMatchObject({ rank: 1, price: 310, name: "APPLE INC" });
    expect(b.index?.price).toBe(6000);
    expect(b.feeds).toEqual([expect.objectContaining({ source: "yahoo", state: "live" })]);
  });

  test("live trades finish minutes onto the day's chart, after hours too, and a new day starts over", async () => {
    const t = setup();
    const open = ET("2026-10-30T09:30:00");
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1D", points: [[open, 300]], prevClose: 298, name: "Apple Inc." });
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 301, open + 61_000)] });
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 302, open + 90_000)] });
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1D" })).points).toEqual([[open, 300]]);
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 303, open + 125_000)] });
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1D" })).points).toEqual([[open, 300], [open + 60_000, 302]]);
    expect(await t.query(api.stonks.quote, { symbol: "AAPL" })).toMatchObject({ price: 303, prevClose: 298, regularPrice: 303, name: "Apple Inc." });
    // After the bell the chart keeps going, and the regular-session price stays put.
    const post = ET("2026-10-30T16:30:00");
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 305, post, { session: "post" })] });
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 306, post + 120_000, { session: "post" })] });
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1D" })).points.at(-1)).toEqual([post, 305]);
    expect(await t.query(api.stonks.quote, { symbol: "AAPL" })).toMatchObject({ price: 306, regularPrice: 303, session: "post" });
    // Monday's pre-market: a fresh chart, and Friday's close is the previous close.
    const pre = EST("2026-11-02T04:00:00");
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 307, pre, { session: "pre" })] });
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 308, pre + 60_000, { session: "pre" })] });
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1D" })).points).toEqual([[pre, 307]]);
    expect(await t.query(api.stonks.quote, { symbol: "AAPL" })).toMatchObject({ price: 308, prevClose: 303 });
  });

  test("an older trade from a standby source doesn't overwrite a newer one", async () => {
    const t = setup();
    const now = ET("2026-10-30T10:00:00");
    await t.mutation(internal.stonks.ingest, { ticks: [tick("AAPL", 301, now)] });
    await t.mutation(internal.stonks.ingest, { ticks: [{ ...tick("AAPL", 299, now - 5000), source: "nasdaq" }] });
    expect((await t.query(api.stonks.quote, { symbol: "AAPL" }))?.price).toBe(301);
  });

  test("sparks are at most 48 points a stock", async () => {
    const t = setup();
    await t.mutation(internal.stonks.holdings, { asOf: "2026-10-29", holdings: [{ symbol: "AAPL", name: "APPLE INC", weight: 7.6 }] });
    const open = ET("2026-10-30T09:30:00");
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1D", points: Array.from({ length: 390 }, (_, i) => [open + i * 60_000, 300 + i / 10]) });
    const s = await t.query(api.stonks.sparks, {});
    expect(s.AAPL.length).toBeLessThanOrEqual(49);
    expect(s["^GSPC"]).toEqual([]);
  });
});
