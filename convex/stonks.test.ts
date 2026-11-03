import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { contribution, downsample, liveWeight, withMinute, type Point } from "./stonks/board";
import { marketClock, nextOpen, sessionDay } from "./stonks/market";
import { setup, signedIn } from "./test.setup";

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
  test("a stock's share times its move is the index points it's moved", () => {
    // 7.5% of a 6000 index, up 10%: 45 points.
    expect(contribution(7.5, 110, 100, 100, 6000, 6000)).toBeCloseTo(45);
    expect(contribution(7.5, 90, 100, 100, 6000, 6000)).toBeCloseTo(-45);
    expect(contribution(7.5, 90, undefined, 100, 6000, 6000)).toBe(0);
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
    expect(await t.query(api.stonks.deepWatch, {})).toEqual(["^GSPC", "NVDA", "AAPL"]);
    const now = ET("2026-10-30T10:00:00");
    await t.mutation(internal.stonks.ingest, { ticks: [tick("^GSPC", 6000, now), tick("NVDA", 190, now), tick("AAPL", 310, now)], feeds: [{ source: "yahoo", state: "live" }] });
    const b = await t.query(api.stonks.board, {});
    expect(b.rows.map((r) => r.symbol)).toEqual(["AAPL", "NVDA"]); // NVDA fell, AAPL rose: they swap
    expect(b.rows[0]).toMatchObject({ rank: 1, price: 310, name: "APPLE INC" });
    expect(b.index?.price).toBe(6000);
    expect(b.feeds).toEqual([expect.objectContaining({ source: "yahoo", state: "live" })]);
  });

  test("the board knows who moved the index, who's up, and who changed places since the close", async () => {
    const t = setup();
    await t.mutation(internal.stonks.holdings, {
      asOf: "2026-10-29",
      indexBase: 6000,
      holdings: [
        { symbol: "NVDA", name: "NVIDIA CORP", weight: 7.77, base: 200 },
        { symbol: "AAPL", name: "APPLE INC", weight: 7.65, base: 300 },
      ],
    });
    const open = ET("2026-10-30T09:30:00");
    for (const [symbol, prevClose] of [["^GSPC", 6000], ["NVDA", 200], ["AAPL", 300]] as const) await t.mutation(internal.stonks.series, { symbol, range: "1D", points: [[open, prevClose]], prevClose });
    await t.mutation(internal.stonks.ingest, { ticks: [tick("^GSPC", 6000, open + 60_000), tick("NVDA", 190, open + 60_000), tick("AAPL", 310, open + 60_000)] });
    const b = await t.query(api.stonks.board, {});
    expect(b.rows.map((r) => [r.symbol, r.rank, r.baseRank])).toEqual([["AAPL", 1, 2], ["NVDA", 2, 1]]);
    expect(b.movers.map((m) => m.symbol)).toEqual(["NVDA", "AAPL"]);
    expect(b.movers[0].points).toBeCloseTo(-23.31);
    expect(b.movers[1].points).toBeCloseTo(15.3);
    expect([b.up, b.down]).toEqual([1, 1]);
    expect(await t.query(api.stonks.quote, { symbol: "NVDA" })).toMatchObject({ rank: 2, baseRank: 1, price: 190 });
  });

  // Convex keeps the old version of every row it rewrites, which is what filled the disk: these tests count rewrites.
  const hoursOf = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("stockDayHours").collect());

  test("a day's chart is a row per hour, so a new minute rewrites one hour and an unchanged refresh rewrites none", async () => {
    vi.useFakeTimers();
    const t = setup();
    const nine = ET("2026-10-30T09:00:00");
    const points = Array.from({ length: 180 }, (_, i) => [nine + i * 60_000, 100 + i]);
    vi.setSystemTime(nine + 3 * 3600_000);
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1D", points });
    expect(await hoursOf(t)).toHaveLength(3);
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1D" })).points).toEqual(points);
    const before = await hoursOf(t);

    // The same day again: nothing's new, so nothing's written.
    vi.setSystemTime(nine + 3 * 3600_000 + 60_000);
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1D", points });
    expect(await hoursOf(t)).toEqual(before);

    // One point changes in the last hour: only that row is rewritten.
    const changed = [...points.slice(0, -1), [points[179][0], 999]];
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1D", points: changed });
    const after = await hoursOf(t);
    expect(after.filter((h, i) => h.at !== before[i].at)).toHaveLength(1);
    expect(after.at(-1)!.points.at(-1)![1]).toBe(999);

    // A minute finishing rewrites its own hour, and starts a new one when the clock turns over.
    const noon = ET("2026-10-30T12:00:00");
    const trade = (time: number, price: number) => t.mutation(internal.stonks.ingest, { ticks: [{ symbol: "AAPL", price, time, recv: time, source: "yahoo", session: "regular" }] });
    await trade(noon + 5_000, 500);
    await trade(noon + 65_000, 501);
    const rows = await hoursOf(t);
    expect(rows).toHaveLength(4);
    expect(rows.at(-1)!.points).toEqual([[noon, 500]]);
    expect(rows[0].at).toBe(after[0].at);
    expect((await t.query(api.stonks.sparks, {}))["^GSPC"]).toEqual([]);

    // The next morning starts the chart over, and what's replaced by this goes too.
    const tomorrow = ET("2026-10-31T09:30:00");
    vi.setSystemTime(tomorrow);
    await trade(tomorrow, 510);
    expect(await hoursOf(t)).toHaveLength(0);
    await trade(tomorrow + 60_000, 511);
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1D" })).points).toEqual([[tomorrow, 510]]);
  });

  test("a longer range or a profile that hasn't changed isn't written again", async () => {
    vi.useFakeTimers();
    const t = setup();
    const start = ET("2026-10-30T10:00:00");
    vi.setSystemTime(start);
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1W", points: [[start, 1]] });
    await t.mutation(internal.stonks.setProfile, { symbol: "AAPL", news: [{ title: "Apple", publisher: "Yahoo Finance", link: "https://x.test", time: start }] });
    vi.setSystemTime(start + 60_000);
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1W", points: [[start, 1]] });
    await t.mutation(internal.stonks.setProfile, { symbol: "AAPL", news: [{ title: "Apple", publisher: "Yahoo Finance", link: "https://x.test", time: start }] });
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1W" })).at).toBe(start);
    expect((await t.query(api.stonks.profile, { symbol: "AAPL" })).at).toBe(start);
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1W", points: [[start, 2]] });
    await t.mutation(internal.stonks.setProfile, { symbol: "AAPL", news: [] });
    expect((await t.query(api.stonks.chart, { symbol: "AAPL", range: "1W" })).at).toBeGreaterThan(start);
    expect((await t.query(api.stonks.profile, { symbol: "AAPL" })).at).toBeGreaterThan(start);
  });

  test("the sidecar writes every trade only while someone's here or an order's waiting", async () => {
    const t = setup();
    expect(await t.query(api.stonks.hot, {})).toEqual([]);
    const p = (await signedIn(t, "Shlok")).as;
    await p.mutation(api.stonks.watching, { symbols: ["^GSPC"], level: "seen" });
    expect(await t.query(api.stonks.hot, {})).toEqual(["*"]);
    await t.run(async (ctx) => {
      for (const v of await ctx.db.query("stockViews").collect()) await ctx.db.delete(v._id);
    });
    expect(await t.query(api.stonks.hot, {})).toEqual([]);
    const time = Date.now();
    await t.mutation(internal.stonks.ingest, { ticks: [{ symbol: "NVDA", price: 200, time, recv: time, source: "yahoo", session: "post" }] });
    await p.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 100 });
    expect(await t.query(api.stonks.hot, {})).toEqual(["NVDA"]);
  });

  test("profiles and news: either can come alone, and the board knows how busy a stock is", async () => {
    const t = setup();
    await t.mutation(internal.stonks.holdings, { asOf: "2026-10-29", holdings: [{ symbol: "AAPL", name: "APPLE INC", weight: 7.6 }] });
    const open = ET("2026-10-30T09:30:00");
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1D", points: [[open, 300]], prevClose: 298, volume: 84_000_000 });
    await t.mutation(internal.stonks.setProfile, { symbol: "AAPL", stats: { marketCap: 5.03e12, trailingPE: 39.5, avgVolume: 42_000_000, rating: "buy", earnings: ET("2026-11-02T16:30:00") } });
    await t.mutation(internal.stonks.setProfile, { symbol: "AAPL", news: [{ title: "Apple takes the top spot", publisher: "Yahoo Finance", link: "https://example.com/a", time: open }] });
    const p = await t.query(api.stonks.profile, { symbol: "AAPL" });
    expect(p.stats).toMatchObject({ marketCap: 5.03e12, rating: "buy" });
    expect(p.news.map((n) => n.title)).toEqual(["Apple takes the top spot"]);
    const b = await t.query(api.stonks.board, {});
    expect(b.rows[0].relVolume).toBeCloseTo(2);
    expect(b.rows[0].earnings).toBe(ET("2026-11-02T16:30:00"));
    expect(await t.query(api.stonks.profile, { symbol: "MSFT" })).toEqual({ stats: null, news: [], at: null });
  });

  test("the day's history brings the day's and year's stats", async () => {
    const t = setup();
    const open = ET("2026-10-30T09:30:00");
    await t.mutation(internal.stonks.series, { symbol: "AAPL", range: "1D", points: [[open, 300]], prevClose: 298, dayHigh: 305, dayLow: 297, volume: 51_000_000, yearHigh: 351.7, yearLow: 243.4 });
    expect(await t.query(api.stonks.quote, { symbol: "AAPL" })).toMatchObject({ dayHigh: 305, dayLow: 297, volume: 51_000_000, yearHigh: 351.7, yearLow: 243.4 });
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

describe("paper trading", () => {
  afterEach(() => vi.useRealTimers());
  const open = ET("2026-10-30T09:30:00");
  async function market() {
    vi.useFakeTimers();
    vi.setSystemTime(open);
    const t = setup();
    await t.mutation(internal.stonks.ingest, { ticks: [tick("NVDA", 200, open - 1000), tick("TSLA", 400, open - 1000)] });
    return t;
  }
  const tickAt = (t: ReturnType<typeof setup>, symbol: string, price: number, time: number, extra = {}) => t.mutation(internal.stonks.ingest, { ticks: [tick(symbol, price, time, extra)] });

  test("everyone starts with $10,000, before they've done anything", async () => {
    const t = await market();
    const { as, userId } = await signedIn(t, "Shlok");
    await signedIn(t, "Chris");
    expect(await as.query(api.stonks.portfolio, {})).toMatchObject({ worth: 10000, cash: 10000, free: 10000, gain: 0, positions: [], waiting: [] });
    const crew = await as.query(api.stonks.crew, {});
    expect(crew.map((c) => [c.name, c.worth])).toEqual([["Chris", 10000], ["Shlok", 10000]]);
    expect(crew.find((c) => c.userId === userId)?.me).toBe(true);
  });

  test("an order waits for a trade after the tap, in the regular session, and fills at that price", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    vi.setSystemTime(open + 10_000);
    await as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 1000 });
    // A trade from before the tap, arriving late: knowing that price mustn't help.
    await tickAt(t, "NVDA", 150, open + 9_000);
    expect((await as.query(api.stonks.portfolio, {}))?.waiting).toHaveLength(1);
    // Another stock's trade doesn't touch it, and nor does after hours.
    await tickAt(t, "TSLA", 410, open + 11_000);
    await tickAt(t, "NVDA", 160, open + 11_000, { session: "post" });
    expect((await as.query(api.stonks.portfolio, {}))?.positions).toEqual([]);
    await tickAt(t, "NVDA", 250, open + 12_000);
    const p = await as.query(api.stonks.portfolio, {});
    expect(p).toMatchObject({ cash: 9000, worth: 10000, waiting: [], positions: [expect.objectContaining({ symbol: "NVDA", shares: 4, avg: 250 })] });
    expect(p?.lastFill).toMatchObject({ side: "buy", symbol: "NVDA", amount: 1000, price: 250 });
    // The price moves, and so does everything derived from it.
    await tickAt(t, "NVDA", 300, open + 13_000);
    const later = await as.query(api.stonks.portfolio, {});
    expect(later).toMatchObject({ worth: 10200, gain: 200 });
    expect(later?.positions[0]).toMatchObject({ value: 1200, gain: 200, gainPct: 0.2 });
    expect((await as.query(api.stonks.crew, {}))[0].worth).toBe(10200);
    expect((await as.query(api.stonks.trades, {}))[0]).toMatchObject({ side: "buy", symbol: "NVDA", amount: 1000, price: 250 });
  });

  test("short, then cover at a profit", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    vi.setSystemTime(open + 1000);
    await as.mutation(api.stonks.order, { symbol: "TSLA", side: "short", dollars: 2000 });
    await tickAt(t, "TSLA", 400, open + 2000);
    expect(await as.query(api.stonks.portfolio, {})).toMatchObject({ cash: 12000, worth: 10000, free: 8000 });
    await expect(as.mutation(api.stonks.order, { symbol: "TSLA", side: "buy", dollars: 100 })).rejects.toThrow("Cover your short first.");
    vi.setSystemTime(open + 3000);
    await as.mutation(api.stonks.order, { symbol: "TSLA", side: "cover" });
    await tickAt(t, "TSLA", 320, open + 4000);
    expect(await as.query(api.stonks.portfolio, {})).toMatchObject({ cash: 10400, worth: 10400, positions: [] });
    expect((await as.query(api.stonks.trades, { symbol: "TSLA" }))[0]).toMatchObject({ side: "cover", realized: 400 });
  });

  test("you can't invest more than you have, and waiting orders count", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    await expect(as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 10001 })).rejects.toThrow("You have $10,000.00 to invest.");
    await expect(as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 0.5 })).rejects.toThrow("smallest order");
    await expect(as.mutation(api.stonks.order, { symbol: "NOPE", side: "buy", dollars: 100 })).rejects.toThrow("You can't trade that.");
    await as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 7000 });
    expect((await as.query(api.stonks.portfolio, {}))?.free).toBe(3000);
    await expect(as.mutation(api.stonks.order, { symbol: "TSLA", side: "short", dollars: 3500 })).rejects.toThrow("You have $3,000.00 to invest.");
  });

  test("the same tap twice is one order, and a waiting order can be cancelled, only by its owner", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    const chris = await signedIn(t, "Chris");
    const a = await as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 500 });
    expect(await as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 500 })).toBe(a);
    await expect(chris.as.mutation(api.stonks.cancelOrder, { id: a })).rejects.toThrow("isn't your order");
    await as.mutation(api.stonks.cancelOrder, { id: a });
    await tickAt(t, "NVDA", 210, open + 5000);
    expect(await as.query(api.stonks.portfolio, {})).toMatchObject({ cash: 10000, positions: [], waiting: [] });
  });

  test("an order that waited reports back, and betting against a friend tells them", async () => {
    const t = await market();
    const shlok = await signedIn(t, "Shlok");
    const chris = await signedIn(t, "Chris");
    await chris.as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 1000 });
    vi.setSystemTime(open + 1000);
    await tickAt(t, "NVDA", 200, open + 1000);
    const pushes = async () => (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((f) => f.name.includes("sendToUser")).map((f) => f.args[0] as { userId: string; title: string; body: string });
    expect(await pushes()).toEqual([]); // filled within the second: Chris saw it
    await shlok.as.mutation(api.stonks.order, { symbol: "NVDA", side: "short", dollars: 500 });
    vi.setSystemTime(open + 60_000);
    await tickAt(t, "NVDA", 205, open + 60_000);
    const sent = await pushes();
    expect(sent.find((p) => p.userId === shlok.userId)).toMatchObject({ title: "Shorted NVDA", body: "$500.00 at $205.00" });
    expect(sent.find((p) => p.userId === chris.userId)).toMatchObject({ title: "Shlok shorted NVDA", body: "And you own it." });
    expect((await shlok.as.query(api.stonks.holders, { symbol: "NVDA" })).map((h) => [h.name, h.shares > 0])).toEqual(expect.arrayContaining([["Chris", true], ["Shlok", false]]));
  });

  test("what someone holds keeps streaming, even outside the top", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    await t.mutation(internal.stonks.holdings, { asOf: "2026-10-29", holdings: [{ symbol: "AAPL", name: "APPLE INC", weight: 7 }] });
    expect(await t.query(api.stonks.watchlist, {})).toEqual(["^GSPC", "AAPL"]);
    await as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 500 });
    expect(await t.query(api.stonks.watchlist, {})).toEqual(["^GSPC", "AAPL", "NVDA"]);
    vi.setSystemTime(open + 1000);
    await tickAt(t, "NVDA", 200, open + 1000);
    expect(await t.query(api.stonks.watchlist, {})).toEqual(["^GSPC", "AAPL", "NVDA"]);
  });

  test("anything in any currency: dollars go in, the local price fills it, and the currency counts", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    // Toyota in yen, with the rate from a batch quote: the stream doesn't carry this pair.
    await t.mutation(internal.stonks.snapshot, { rows: [{ symbol: "7203.T", price: 3000, time: open - 5000, currency: "JPY", type: "EQUITY", exchange: "JPX", state: "REGULAR", name: "TOYOTA MOTOR CORP" }] });
    expect(await t.query(api.stonks.watchlist, {})).toEqual(["^GSPC"]);
    vi.setSystemTime(open + 1000);
    const id = await as.mutation(api.stonks.order, { symbol: "7203.T", side: "buy", dollars: 1000 });
    expect(await t.query(api.stonks.watchlist, {})).toEqual(expect.arrayContaining(["7203.T", "JPYUSD=X"]));
    // Yahoo's feed from Tokyo runs 15 minutes late. A trade stamped before the tap can't fill it, however
    // late it arrives, and without a rate it waits too.
    await tickAt(t, "7203.T", 3010, open + 500);
    await tickAt(t, "7203.T", 3020, open + 2000);
    expect((await as.query(api.stonks.portfolio, {}))?.waiting.map((w) => w.id)).toEqual([id]);
    await t.mutation(internal.stonks.snapshot, { rows: [{ symbol: "JPYUSD=X", price: 0.005, time: open + 2000, type: "CURRENCY", currency: "USD" }] });
    await tickAt(t, "7203.T", 3200, open + 3000);
    const p = await as.query(api.stonks.portfolio, {});
    expect(p?.positions[0]).toMatchObject({ symbol: "7203.T", avg: 16, shares: 62.5, value: 1000 }); // 3200 yen is $16
    expect(p?.lastFill).toMatchObject({ price: 3200, currency: "JPY", amount: 1000 });
    // The yen strengthens: the same shares are worth more dollars.
    await t.mutation(internal.stonks.snapshot, { rows: [{ symbol: "JPYUSD=X", price: 0.006, time: open + 4000 }] });
    expect(await as.query(api.stonks.portfolio, {})).toMatchObject({ worth: 10200 });
  });

  test("London is quoted in pence", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    await t.mutation(internal.stonks.snapshot, { rows: [{ symbol: "GBPUSD=X", price: 1.25, time: open, currency: "USD" }, { symbol: "VOD.L", price: 100, time: open, currency: "GBp" }] });
    vi.setSystemTime(open + 1000);
    await as.mutation(api.stonks.order, { symbol: "VOD.L", side: "buy", dollars: 500 });
    await tickAt(t, "VOD.L", 100, open + 2000);
    expect((await as.query(api.stonks.portfolio, {}))?.positions[0]).toMatchObject({ avg: 1.25, shares: 400 });
  });

  test("overnight trades don't fill, and something the stream doesn't carry fills from a batch quote", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    vi.setSystemTime(open + 1000);
    await t.mutation(internal.stonks.snapshot, { rows: [{ symbol: "ES=F", price: 7600, time: open, type: "FUTURE", currency: "USD" }] });
    await as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 100 });
    await as.mutation(api.stonks.order, { symbol: "ES=F", side: "short", dollars: 760 });
    await tickAt(t, "NVDA", 180, open + 2000, { session: "overnight" });
    // The batch's latest trade is from before the tap: nothing yet.
    await t.mutation(internal.stonks.snapshot, { rows: [{ symbol: "ES=F", price: 7500, time: open + 500 }] });
    expect((await as.query(api.stonks.portfolio, {}))?.waiting).toHaveLength(2);
    await t.mutation(internal.stonks.snapshot, { rows: [{ symbol: "ES=F", price: 7600, time: open + 3000 }] });
    const p = await as.query(api.stonks.portfolio, {});
    expect(p?.positions[0]).toMatchObject({ symbol: "ES=F", shares: -0.1 });
    expect(p?.waiting).toHaveLength(1);
  });

  test("search: instant from what's known, ask Yahoo once, and its answers join in", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    await t.mutation(internal.stonks.addSymbols, { rows: [{ symbol: "AAPL", name: "Apple Inc.", type: "EQUITY", exchange: "NMS" }, { symbol: "AAP", name: "Advance Auto Parts", type: "EQUITY" }, { symbol: "TM", name: "Toyota Motor Corporation", type: "EQUITY" }] });
    expect((await as.query(api.stonks.search, { q: "aap" })).map((r) => r.symbol)).toEqual(["AAP", "AAPL"]);
    expect((await as.query(api.stonks.search, { q: "toyota" })).map((r) => r.symbol)).toEqual(["TM"]);
    expect(await as.query(api.stonks.search, { q: " " })).toEqual([]);
    await as.mutation(api.stonks.lookup, { q: "Toyota" });
    await as.mutation(api.stonks.lookup, { q: "toyota " });
    expect(await t.query(api.stonks.pendingLookups, {})).toEqual(["toyota"]);
    await t.mutation(internal.stonks.lookedUp, { q: "toyota", rows: [{ symbol: "TM", name: "Toyota Motor Corporation", type: "EQUITY" }, { symbol: "7203.T", name: "TOYOTA MOTOR CORP", type: "EQUITY", exchange: "Tokyo Stock Exchange" }] });
    expect(await t.query(api.stonks.pendingLookups, {})).toEqual([]);
    await as.mutation(api.stonks.lookup, { q: "toyota" });
    expect(await t.query(api.stonks.pendingLookups, {})).toEqual([]); // asked once
    expect((await as.query(api.stonks.search, { q: "toyota" })).map((r) => r.symbol)).toEqual(["TM", "7203.T"]);
  });

  test("charts nobody has opened in two weeks are cleared out", async () => {
    const t = await market();
    await t.mutation(internal.stonks.series, { symbol: "OLD", range: "1Y", points: [[open, 1]] });
    vi.setSystemTime(open + 10 * 86_400_000);
    await t.mutation(internal.stonks.series, { symbol: "NEW", range: "1Y", points: [[open, 1]] });
    vi.setSystemTime(open + 15 * 86_400_000);
    await t.mutation(internal.stonks.sweepSeries, {});
    expect((await t.query(api.stonks.chart, { symbol: "OLD", range: "1Y" })).points).toEqual([]);
    expect((await t.query(api.stonks.chart, { symbol: "NEW", range: "1Y" })).points).toHaveLength(1);
  });

  test("what's on someone's screen streams while it's there, and only what's open gets history", async () => {
    const t = await market();
    const { as } = await signedIn(t);
    await t.mutation(internal.stonks.addSymbols, { rows: [{ symbol: "SHOP", name: "Shopify" }, { symbol: "KO", name: "Coca-Cola" }] });
    await as.mutation(api.stonks.watching, { symbols: ["SHOP", "not a thing!"], level: "seen" });
    await as.mutation(api.stonks.watching, { symbols: ["KO"], level: "open" });
    expect(await t.query(api.stonks.watchlist, {})).toEqual(["^GSPC", "SHOP", "KO"]);
    expect(await t.query(api.stonks.deepWatch, {})).toEqual(["^GSPC", "KO"]);
    vi.setSystemTime(open + 100_000);
    await t.mutation(internal.stonks.sweepViews, {});
    expect(await t.query(api.stonks.watchlist, {})).toEqual(["^GSPC"]);
  });

  test("net worth history: on every fill and every 15 minutes, skipping what hasn't changed, thinning what's old", async () => {
    const t = await market();
    const shlok = await signedIn(t, "Shlok");
    await signedIn(t, "Chris");
    // Nobody's traded: nothing to record, everyone's on $10,000.
    await t.mutation(internal.stonks.recordWorth, {});
    expect(await t.query(api.stonks.worthHistory, {})).toEqual([]);
    vi.setSystemTime(open + 1000);
    await shlok.as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 1000 });
    await tickAt(t, "NVDA", 200, open + 2000);
    const first = await t.query(api.stonks.worthHistory, {});
    expect(first.map((r) => r.worths.map((x) => x.w))).toEqual([[10000]]);
    await t.mutation(internal.stonks.recordWorth, {}); // nothing's moved
    expect(await t.query(api.stonks.worthHistory, {})).toHaveLength(1);
    await tickAt(t, "NVDA", 220, open + 3000);
    await t.mutation(internal.stonks.recordWorth, {});
    expect((await t.query(api.stonks.worthHistory, {})).at(-1)?.worths[0].w).toBe(10100);
    // Four rows an hour for a month, then thinned: hourly after 3 days, daily after 14.
    const uid = shlok.userId;
    const day = 86_400_000;
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("stockWorth").collect()) await ctx.db.delete(r._id);
      for (let h = 0; h < 30 * 24 * 4; h++) await ctx.db.insert("stockWorth", { t: open + (h * day) / 96, worths: [{ u: uid, w: 10000 + h }] });
    });
    vi.setSystemTime(open + 30 * day);
    await t.mutation(internal.stonks.thinWorth, {});
    const rows = await t.query(api.stonks.worthHistory, {});
    const span = (from: number, to: number) => rows.filter((r) => r.t >= open + from * day && r.t < open + to * day).length;
    expect(span(0, 16)).toBeLessThanOrEqual(17); // daily
    expect(span(17, 27)).toBeLessThanOrEqual(10 * 24 + 1); // hourly
    expect(span(27.5, 30)).toBeGreaterThan(2 * 96); // untouched
    expect(rows.length).toBeLessThan(600);
  });

  test("a player's profile: their money, positions, what they're waiting on and their record, for anyone to see", async () => {
    const t = await market();
    const shlok = await signedIn(t, "Shlok");
    const chris = await signedIn(t, "Chris");
    vi.setSystemTime(open + 1000);
    await shlok.as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 2000 });
    await shlok.as.mutation(api.stonks.order, { symbol: "TSLA", side: "short", dollars: 1000 });
    await t.mutation(internal.stonks.ingest, { ticks: [tick("NVDA", 200, open + 2000), tick("TSLA", 400, open + 2000)] });
    vi.setSystemTime(open + 3000);
    await shlok.as.mutation(api.stonks.order, { symbol: "NVDA", side: "sell", shares: 5 });
    await tickAt(t, "NVDA", 240, open + 4000);
    vi.setSystemTime(open + 5000);
    await shlok.as.mutation(api.stonks.order, { symbol: "TSLA", side: "cover", shares: 1 });
    await tickAt(t, "TSLA", 500, open + 6000);
    vi.setSystemTime(open + 7000);
    await shlok.as.mutation(api.stonks.order, { symbol: "NVDA", side: "buy", dollars: 500 });
    const p = await chris.as.query(api.stonks.player, { userId: shlok.userId });
    expect(p).toMatchObject({ me: false, place: 1, of: 2, start: 10000, gain: 150 });
    expect(p?.card.name).toBe("Shlok");
    expect(p?.positions.map((x) => x.symbol)).toEqual(["NVDA", "TSLA"]);
    expect(p?.positions.find((x) => x.symbol === "TSLA")).toMatchObject({ shares: -1.5, gain: -150 });
    expect(p?.waiting.map((o) => [o.symbol, o.side, o.dollars])).toEqual([["NVDA", "buy", 500]]);
    expect(p?.record).toMatchObject({ trades: 4, wins: 1, losses: 1, realized: 100, best: { symbol: "NVDA", realized: 200 }, worst: { symbol: "TSLA", realized: -100 } });
    expect(p?.history[0]).toMatchObject({ side: "cover", symbol: "TSLA", realized: -100 });
    // The positions and what's idle add up to the net worth.
    const held = p!.positions.reduce((n, x) => n + Math.abs(x.value), 0);
    expect(held + p!.idle).toBeCloseTo(p!.worth);
    expect((await shlok.as.query(api.stonks.player, { userId: shlok.userId }))?.me).toBe(true);
  });
});
