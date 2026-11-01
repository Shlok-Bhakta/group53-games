import { v } from "convex/values";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { contribution, downsample, liveWeight, minuteOf, withMinute, type Point } from "./stonks/board";
import { INDEX, RANGES } from "./stonks/market";
import { newsItem, statsValidator } from "./stonks/profile";

// Stonks: live prices for the S&P 500's biggest companies, ranked by their share of the index.
//
// Prices come from the stonks sidecar (stonks/, a small Rust service on kiwi): it holds the market
// data streams (Yahoo first, Nasdaq standing by), follows `watchlist` live, and writes through the
// internal mutations here with the admin key, once a second at most. Phones only read. Every price
// change reaches every phone through these queries, so they're split by how often they change:
// `board` (prices, every second while the market's open) is small; `sparks` and `chart` change once a
// minute, when a minute of trading is finished. Pre-market and after-hours trades count too.

const SHOWN = 20; // rows on the board; a few more are streamed so the ranking can change hands live

const quoteOf = (ctx: QueryCtx, symbol: string) =>
  ctx.db
    .query("stockQuotes")
    .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
    .unique();
const seriesOf = (ctx: QueryCtx, symbol: string, range: string) =>
  ctx.db
    .query("stockSeries")
    .withIndex("by_symbol_range", (q) => q.eq("symbol", symbol).eq("range", range))
    .unique();
const profileOf = (ctx: QueryCtx, symbol: string) =>
  ctx.db
    .query("stockProfiles")
    .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
    .unique();
const indexDoc = (ctx: QueryCtx) =>
  ctx.db
    .query("stockIndex")
    .withIndex("by_key", (q) => q.eq("key", "spx"))
    .unique();

/** What the sidecar should stream: the index, and every holding in the file. */
export const watchlist = query({
  args: {},
  handler: async (ctx) => {
    const idx = await indexDoc(ctx);
    return [INDEX, ...(idx?.holdings.map((h) => h.symbol) ?? [])];
  },
});

const view = (q: Doc<"stockQuotes">) => ({
  symbol: q.symbol,
  name: q.name,
  price: q.price,
  prevClose: q.prevClose,
  regularPrice: q.regularPrice,
  time: q.time,
  recv: q.recv,
  source: q.source,
  session: q.session,
  dayHigh: q.dayHigh,
  dayLow: q.dayLow,
  volume: q.volume,
  yearHigh: q.yearHigh,
  yearLow: q.yearLow,
});
export type QuoteView = ReturnType<typeof view>;

/** Every holding with a price, ranked by live share of the index, with where it ranked at the previous
 *  close and how many index points it's moved the S&P today. */
async function ranked(ctx: QueryCtx) {
  const idx = await indexDoc(ctx);
  const index = await quoteOf(ctx, INDEX);
  // Holdings with no price yet (the sidecar's still starting) wait off the board.
  const rows = (
    await Promise.all(
      (idx?.holdings ?? []).map(async (h) => {
        const q = await quoteOf(ctx, h.symbol);
        if (!q) return null;
        const stats = (await profileOf(ctx, h.symbol))?.stats;
        const before = q.prevClose ? liveWeight(h.weight, q.prevClose, h.base, index?.prevClose, idx?.indexBase) : h.weight;
        return {
          ...view(q),
          name: q.name ?? h.name,
          weight: liveWeight(h.weight, q.price, h.base, index?.price, idx?.indexBase),
          before,
          points: contribution(h.weight, q.price, q.prevClose, h.base, index?.prevClose, idx?.indexBase),
          // Today's volume against a normal day's: 2 means twice as busy.
          relVolume: q.volume && stats?.avgVolume ? q.volume / stats.avgVolume : undefined,
          earnings: stats?.earnings,
        };
      }),
    )
  ).filter((r) => r !== null);
  const baseRank = new Map([...rows].sort((a, b) => b.before - a.before).map((r, i) => [r.symbol, i + 1]));
  rows.sort((a, b) => b.weight - a.weight);
  return { idx, index, rows: rows.map((r, i) => ({ ...r, rank: i + 1, baseRank: baseRank.get(r.symbol)! })) };
}

/** The board: the index and the top holdings by live weight, with their prices, who's moved the index
 *  most today, and how many of the top are up. Changes with every price. */
export const board = query({
  args: {},
  handler: async (ctx) => {
    const { idx, index, rows } = await ranked(ctx);
    const shown = rows.slice(0, SHOWN);
    const feeds = await ctx.db.query("stockFeeds").collect();
    const moved = (r: (typeof rows)[number]) => (r.prevClose ? r.price - r.prevClose : 0);
    return {
      asOf: idx?.asOf ?? null,
      index: index ? view(index) : null,
      rows: shown,
      up: shown.filter((r) => moved(r) > 0).length,
      down: shown.filter((r) => moved(r) < 0).length,
      share: shown.reduce((n, r) => n + r.weight, 0),
      movers: [...rows].filter((r) => r.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 6).map((r) => ({ symbol: r.symbol, points: r.points })),
      feeds: feeds.map((f) => ({ source: f.source, state: f.state, detail: f.detail, at: f.at })),
    };
  },
});

/** Each stock's day so far, at most 48 points, for the board's little charts. Changes once a minute. */
export const sparks = query({
  args: {},
  handler: async (ctx) => {
    const idx = await indexDoc(ctx);
    const symbols = [INDEX, ...(idx?.holdings.map((h) => h.symbol) ?? [])];
    const out: Record<string, Point[]> = {};
    for (const s of symbols) out[s] = downsample(((await seriesOf(ctx, s, "1D"))?.points ?? []) as Point[], 48);
    return out;
  },
});

/** One stock's price history for a range. The live price on top comes from `quote`. */
export const chart = query({
  args: { symbol: v.string(), range: v.string() },
  handler: async (ctx, { symbol, range }) => {
    const s = await seriesOf(ctx, symbol, range);
    return { points: (s?.points ?? []) as Point[], at: s?.at ?? null };
  },
});

/** A company's key stats and news, or the market's news for the index. Changes every half hour or so. */
export const profile = query({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const p = await profileOf(ctx, symbol);
    return { stats: p?.stats ?? null, news: p?.news ?? [], at: p?.at ?? null };
  },
});

/** One stock, or the index: its price and stats, and for a holding its place on the board. */
export const quote = query({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const q = await quoteOf(ctx, symbol);
    if (!q) return null;
    const row = symbol === INDEX ? undefined : (await ranked(ctx)).rows.find((r) => r.symbol === symbol);
    return { ...view(q), name: row?.name ?? q.name, weight: row?.weight, rank: row?.rank, baseRank: row?.baseRank, points: row?.points };
  },
});

// ---- Written by the sidecar (admin key) ----

const tick = v.object({
  symbol: v.string(),
  price: v.number(),
  time: v.number(),
  recv: v.number(),
  source: v.string(),
  session: v.optional(v.string()),
  dayHigh: v.optional(v.number()),
  dayLow: v.optional(v.number()),
  volume: v.optional(v.number()),
});
const feed = v.object({ source: v.string(), state: v.string(), detail: v.optional(v.string()) });

async function setSeries(ctx: MutationCtx, symbol: string, range: string, points: Point[]) {
  const row = await seriesOf(ctx, symbol, range);
  if (row) await ctx.db.patch(row._id, { points, at: Date.now() });
  else await ctx.db.insert("stockSeries", { symbol, range, points, at: Date.now() });
}

/** The latest trade per symbol, plus how each source is doing. Trades in every session (4am to 8pm New
 *  York) draw the day's chart; a gap of hours means a new day, so the chart starts over and the last
 *  regular-session price becomes the previous close. */
export const ingest = internalMutation({
  args: { ticks: v.array(tick), feeds: v.optional(v.array(feed)) },
  handler: async (ctx, { ticks, feeds }) => {
    for (const t of ticks) {
      const q = await quoteOf(ctx, t.symbol);
      if (q && t.time < q.time) continue; // a standby source catching up on something older
      const minute = minuteOf(t.time);
      const regular = t.session === undefined || t.session === "regular";
      let prevClose = q?.prevClose;
      if (q && q.minute !== undefined && q.minuteClose !== undefined && minute > q.minute) {
        const day = ((await seriesOf(ctx, t.symbol, "1D"))?.points ?? []) as Point[];
        if (minute - q.minute > NEW_DAY) {
          await setSeries(ctx, t.symbol, "1D", []);
          if (q.regularPrice !== undefined) prevClose = q.regularPrice;
        } else if (day.length && q.minute - day.at(-1)![0] < NEW_DAY) await setSeries(ctx, t.symbol, "1D", withMinute(day, q.minute, q.minuteClose));
        else if (!day.length) await setSeries(ctx, t.symbol, "1D", [[q.minute, q.minuteClose]]);
      }
      const row = { ...t, minute, minuteClose: t.price, prevClose, ...(regular ? { regularPrice: t.price } : {}) };
      if (q) await ctx.db.patch(q._id, row);
      else await ctx.db.insert("stockQuotes", row);
    }
    for (const f of feeds ?? []) {
      const row = await ctx.db
        .query("stockFeeds")
        .withIndex("by_source", (q) => q.eq("source", f.source))
        .unique();
      if (row) {
        if (row.state !== f.state || row.detail !== f.detail) await ctx.db.patch(row._id, { ...f, at: Date.now() });
      } else await ctx.db.insert("stockFeeds", { ...f, at: Date.now() });
    }
  },
});
// Overnight, trading stops from 8pm to 4am: anything quiet that long is the next day.
const NEW_DAY = 4 * 3600_000;

/** A range's history from the source (Yahoo's chart data), replacing what's there. The 1D one also
 *  brings the previous close, the company's name and the day's and year's stats. */
export const series = internalMutation({
  args: {
    symbol: v.string(),
    range: v.string(),
    points: v.array(v.array(v.number())),
    prevClose: v.optional(v.number()),
    name: v.optional(v.string()),
    dayHigh: v.optional(v.number()),
    dayLow: v.optional(v.number()),
    volume: v.optional(v.number()),
    yearHigh: v.optional(v.number()),
    yearLow: v.optional(v.number()),
  },
  handler: async (ctx, { symbol, range, points, ...stats }) => {
    if (!(RANGES as readonly string[]).includes(range)) throw new Error(`unknown range ${range}`);
    await setSeries(ctx, symbol, range, points as Point[]);
    const patch = Object.fromEntries(Object.entries(stats).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length === 0) return;
    const q = await quoteOf(ctx, symbol);
    if (q) await ctx.db.patch(q._id, patch);
    else {
      const last = points.at(-1);
      if (last) await ctx.db.insert("stockQuotes", { symbol, price: last[1], time: last[0], recv: Date.now(), source: "history", ...patch });
    }
  },
});

/** A company's key stats (and the sidecar's news for it), replacing what's there. Either can come alone. */
export const setProfile = internalMutation({
  args: { symbol: v.string(), stats: v.optional(statsValidator), news: v.optional(v.array(newsItem)) },
  handler: async (ctx, { symbol, stats, news }) => {
    const row = await profileOf(ctx, symbol);
    const patch = { ...(stats && { stats }), ...(news && { news }), at: Date.now() };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("stockProfiles", { symbol, ...patch });
  },
});

/** The index's holdings, from SPY's daily file: the top few by weight, with each one's price that day. */
export const holdings = internalMutation({
  args: {
    asOf: v.string(),
    holdings: v.array(v.object({ symbol: v.string(), name: v.string(), weight: v.number(), base: v.optional(v.number()) })),
    indexBase: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await indexDoc(ctx);
    if (row) await ctx.db.patch(row._id, { ...args, at: Date.now() });
    else await ctx.db.insert("stockIndex", { key: "spx", ...args, at: Date.now() });
  },
});
