import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { notify } from "./notify";
import { card } from "./profiles";
import { buyingPower, fill, fxPair, MIN_ORDER, netWorth, opens, refusal, START_CASH, toUsd, type Ask, type Book, type Side } from "./stonks/trade";
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

const TOP = 25; // always streaming, so the ranking can change hands live

/** Everything that needs a live price: the index and its top, anything held or on order, anything someone's
 *  looking at, and the exchange rates to value them in dollars. The sidecar streams exactly this. */
export const watchlist = query({
  args: {},
  handler: async (ctx) => {
    const { core, seen } = await watched(ctx);
    const symbols = [...new Set([...core, ...seen])];
    const pairs: string[] = [];
    for (const s of symbols) {
      const pair = fxPair((await quoteOf(ctx, s))?.currency);
      if (pair) pairs.push(pair);
    }
    return [...new Set([...symbols, ...pairs])];
  },
});

/** What also needs history, stats and news: the top, what's held or on order, and what's open on a phone. */
export const deepWatch = query({
  args: {},
  handler: async (ctx) => (await watched(ctx)).deep,
});

async function watched(ctx: QueryCtx) {
  const idx = await indexDoc(ctx);
  const held = (await ctx.db.query("stockPositions").collect()).map((p) => p.symbol);
  const waiting = (await ctx.db.query("stockOrders").withIndex("by_status_filled", (q) => q.eq("status", "waiting")).collect()).map((o) => o.symbol);
  const views = await ctx.db.query("stockViews").collect();
  const core = [INDEX, ...(idx?.holdings.slice(0, TOP).map((h) => h.symbol) ?? []), ...held, ...waiting];
  return { core, seen: views.map((v) => v.symbol), deep: [...new Set([...core, ...views.filter((v) => v.level === "open").map((v) => v.symbol)])] };
}

/** When each thing was last fetched, so a restarted sidecar doesn't ask Yahoo for it all again. */
export const freshness = query({
  args: {},
  handler: async (ctx) => {
    const series = await ctx.db.query("stockSeries").collect();
    const profiles = await ctx.db.query("stockProfiles").collect();
    return [
      ...series.map((s) => ({ symbol: s.symbol, kind: s.range, at: s.at })),
      ...profiles.flatMap((p) => [...(p.statsAt ? [{ symbol: p.symbol, kind: "stats", at: p.statsAt }] : []), ...(p.newsAt ? [{ symbol: p.symbol, kind: "news", at: p.newsAt }] : [])]),
    ];
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
  currency: q.currency,
  type: q.type,
  exchange: q.exchange,
  state: q.state,
  hint: q.hint,
  periodOpen: q.periodOpen,
  periodClose: q.periodClose,
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
    // Only the index's members have a place on the board, and only working that out depends on every price.
    const member = (await indexDoc(ctx))?.holdings.some((h) => h.symbol === symbol);
    const row = member ? (await ranked(ctx)).rows.find((r) => r.symbol === symbol) : undefined;
    return { ...view(q), name: row?.name ?? q.name, weight: row?.weight, rank: row?.rank, baseRank: row?.baseRank, points: row?.points, rate: await usdRate(ctx, q.currency) };
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
      if (regular) await fillWaiting(ctx, t.symbol, t.price, t.time);
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
    currency: v.optional(v.string()),
    type: v.optional(v.string()),
    exchange: v.optional(v.string()),
    hint: v.optional(v.number()),
    periodOpen: v.optional(v.number()),
    periodClose: v.optional(v.number()),
  },
  handler: async (ctx, { symbol, range, points, ...stats }) => {
    if (!(RANGES as readonly string[]).includes(range)) throw new Error(`unknown range ${range}`);
    await setSeries(ctx, symbol, range, points as Point[]);
    const patch: Partial<Doc<"stockQuotes">> = Object.fromEntries(Object.entries(stats).filter(([, v]) => v !== undefined));
    const q = await quoteOf(ctx, symbol);
    const last = points.at(-1);
    // Something nobody's watched in a while: its history can be newer than its last known price.
    if (range === "1D" && last && (!q || last[0] > q.time)) Object.assign(patch, { price: last[1], time: last[0], recv: Date.now(), source: "history" });
    if (Object.keys(patch).length === 0) return;
    if (q) await ctx.db.patch(q._id, patch);
    else if (last) await ctx.db.insert("stockQuotes", { symbol, price: last[1], time: last[0], recv: Date.now(), source: "history", ...patch });
  },
});

/** Yahoo's batch quotes: what each thing is, and its latest regular-session trade. It's how anything the
 *  stream doesn't carry (futures, some currencies, funds) gets a price and fills its orders. */
export const snapshot = internalMutation({
  args: {
    rows: v.array(
      v.object({
        symbol: v.string(),
        price: v.number(),
        time: v.number(),
        name: v.optional(v.string()),
        prevClose: v.optional(v.number()),
        dayHigh: v.optional(v.number()),
        dayLow: v.optional(v.number()),
        volume: v.optional(v.number()),
        yearHigh: v.optional(v.number()),
        yearLow: v.optional(v.number()),
        currency: v.optional(v.string()),
        type: v.optional(v.string()),
        exchange: v.optional(v.string()),
        state: v.optional(v.string()),
        hint: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    for (const { symbol, price, time, ...meta } of rows) {
      const q = await quoteOf(ctx, symbol);
      const newer = !q || time > q.time;
      const patch = Object.fromEntries(Object.entries(meta).filter(([, x]) => x !== undefined));
      if (q) await ctx.db.patch(q._id, { ...patch, ...(newer ? { price, time, recv: Date.now(), source: "snapshot" } : {}) });
      else await ctx.db.insert("stockQuotes", { symbol, price, time, recv: Date.now(), source: "snapshot", ...patch });
      // The latest regular-session trade, whenever it was: an order from before it fills on it.
      await fillWaiting(ctx, symbol, price, time);
    }
  },
});

// ---- Finding things ----

const searchText = (symbol: string, name: string) => `${symbol} ${symbol.replace(/[-.=^]/g, " ")} ${name}`;
const symbolRow = v.object({ symbol: v.string(), name: v.string(), type: v.optional(v.string()), exchange: v.optional(v.string()) });

async function upsertSymbols(ctx: MutationCtx, rows: { symbol: string; name: string; type?: string; exchange?: string }[]) {
  for (const r of rows) {
    const row = await ctx.db
      .query("stockSymbols")
      .withIndex("by_symbol", (q) => q.eq("symbol", r.symbol))
      .unique();
    const doc = { ...r, search: searchText(r.symbol, r.name) };
    if (!row) await ctx.db.insert("stockSymbols", doc);
    else if (row.name !== r.name || row.type !== r.type || row.exchange !== r.exchange) await ctx.db.patch(row._id, doc);
  }
}

/** US listings from Nasdaq's daily files, in chunks. */
export const addSymbols = internalMutation({
  args: { rows: v.array(symbolRow) },
  handler: (ctx, { rows }) => upsertSymbols(ctx, rows),
});

const LOOKUP_DAYS = 7;
const normal = (q: string) => q.trim().toLowerCase().slice(0, 40);

/** Asks Yahoo about a search, unless that's been asked lately. Phones never talk to Yahoo themselves. */
export const lookup = mutation({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    if ((await getAuthUserId(ctx)) === null) return;
    const text = normal(q);
    if (!text) return;
    const row = await ctx.db
      .query("stockLookups")
      .withIndex("by_q", (x) => x.eq("q", text))
      .unique();
    if (row && (!row.done || Date.now() - row.at < LOOKUP_DAYS * 86_400_000)) return;
    if (row) await ctx.db.patch(row._id, { done: false, at: Date.now() });
    else await ctx.db.insert("stockLookups", { q: text, done: false, at: Date.now() });
  },
});

export const pendingLookups = query({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("stockLookups")
        .withIndex("by_done", (q) => q.eq("done", false))
        .take(20)
    ).map((l) => l.q),
});

export const lookedUp = internalMutation({
  args: { q: v.string(), rows: v.array(symbolRow) },
  handler: async (ctx, { q, rows }) => {
    await upsertSymbols(ctx, rows);
    const row = await ctx.db
      .query("stockLookups")
      .withIndex("by_q", (x) => x.eq("q", q))
      .unique();
    if (row) await ctx.db.patch(row._id, { done: true, at: Date.now(), symbols: rows.map((r) => r.symbol) });
  },
});

/** Search anything: an exact ticker first, then Yahoo's own order for this search, tickers starting with
 *  it, and names. Instant from what's already known, and fills in as Yahoo answers. */
export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const text = normal(q);
    if (!text) return [];
    const upper = text.toUpperCase();
    const ticker = upper.replace(/\./g, "-");
    const yahoo = await ctx.db
      .query("stockLookups")
      .withIndex("by_q", (x) => x.eq("q", text))
      .unique();
    const prefix = await ctx.db
      .query("stockSymbols")
      .withIndex("by_symbol", (x) => x.gte("symbol", ticker).lt("symbol", `${ticker}\uffff`))
      .take(8);
    const named = await ctx.db
      .query("stockSymbols")
      .withSearchIndex("search_text", (x) => x.search("search", text))
      .take(15);
    const order = [...(prefix[0]?.symbol === ticker ? [ticker] : []), ...(yahoo?.symbols ?? []), ...prefix.map((p) => p.symbol), ...named.map((n) => n.symbol)];
    const rows = [];
    for (const symbol of [...new Set(order)].slice(0, 20)) {
      const s = prefix.find((p) => p.symbol === symbol) ?? named.find((n) => n.symbol === symbol) ?? (await ctx.db.query("stockSymbols").withIndex("by_symbol", (x) => x.eq("symbol", symbol)).unique());
      if (!s) continue;
      const quote = await quoteOf(ctx, symbol);
      rows.push({ symbol, name: quote?.name ?? s.name, type: quote?.type ?? s.type, exchange: s.exchange, price: quote?.price, prevClose: quote?.prevClose, currency: quote?.currency });
    }
    return rows;
  },
});

// Anything on Yahoo can be opened, so charts of what nobody looks at any more are cleared out. What's held
// or at the top is refetched well inside this, so it never goes; an old chart comes back when it's opened.
const KEEP_SERIES_MS = 14 * 86_400_000;
export const sweepSeries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("stockSeries")
      .withIndex("by_at", (q) => q.lt("at", Date.now() - KEEP_SERIES_MS))
      .take(200);
    for (const s of old) await ctx.db.delete(s._id);
  },
});

/** A phone is showing these: stream them (and if "open", fetch their charts and news) for a while. */
export const watching = mutation({
  args: { symbols: v.array(v.string()), level: v.union(v.literal("seen"), v.literal("open")) },
  handler: async (ctx, { symbols, level }) => {
    if ((await getAuthUserId(ctx)) === null) return;
    const until = Date.now() + 90_000;
    for (const symbol of symbols.slice(0, 40)) {
      // Anything shaped like a Yahoo ticker: a link can name something search hasn't found yet.
      if (!/^[\^A-Z0-9.=-]{1,20}$/.test(symbol)) continue;
      const row = await ctx.db
        .query("stockViews")
        .withIndex("by_symbol", (x) => x.eq("symbol", symbol))
        .unique();
      if (!row) await ctx.db.insert("stockViews", { symbol, level, until });
      else await ctx.db.patch(row._id, { until, level: row.level === "open" && row.until > Date.now() ? "open" : level });
    }
  },
});

export const sweepViews = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const v of await ctx.db.query("stockViews").collect()) if (v.until < Date.now()) await ctx.db.delete(v._id);
  },
});

// ---- Paper trading ----

async function bookOf(ctx: QueryCtx, userId: Id<"users">): Promise<Book> {
  const account = await ctx.db
    .query("stockAccounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const positions = await ctx.db
    .query("stockPositions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return { cash: account?.cash ?? START_CASH, positions };
}

const pricesOf = async (ctx: QueryCtx, symbols: string[]) => {
  const out = new Map<string, Doc<"stockQuotes">>();
  for (const s of new Set(symbols)) {
    const q = await quoteOf(ctx, s);
    if (q) out.set(s, q);
  }
  return out;
};

/** What a stock's worth in dollars, whatever it's quoted in. Undefined until its exchange rate is known. */
async function usdRate(ctx: QueryCtx, currency: string | undefined) {
  const pair = fxPair(currency);
  return toUsd(currency, pair ? (await quoteOf(ctx, pair))?.price : undefined);
}

/** Dollar prices for these symbols. A rate that isn't known yet leaves the symbol out. */
async function usdPrices(ctx: QueryCtx, symbols: string[]) {
  const quotes = await pricesOf(ctx, symbols);
  const out = new Map<string, number>();
  for (const [s, q] of quotes) {
    const rate = await usdRate(ctx, q.currency);
    if (rate !== undefined) out.set(s, q.price * rate);
  }
  return { quotes, usd: out };
}

const askOf = (o: Doc<"stockOrders">): Ask => ({ side: o.side, symbol: o.symbol, dollars: o.dollars, shares: o.shares });
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DID: Record<Side, string> = { buy: "Bought", sell: "Sold", short: "Shorted", cover: "Covered" };
const stockPath = (symbol: string) => `/stonks/${encodeURIComponent(symbol)}`;

/** A trade came in: every order placed before that trade happened fills at its price. An order can't fill
 *  on a trade from before the tap, so knowing the price from somewhere else is no edge. */
async function fillWaiting(ctx: MutationCtx, symbol: string, price: number, time: number) {
  const orders = await ctx.db
    .query("stockOrders")
    .withIndex("by_symbol_status", (q) => q.eq("symbol", symbol).eq("status", "waiting"))
    .collect();
  if (!orders.some((o) => o.at < time)) return;
  const currency = (await quoteOf(ctx, symbol))?.currency;
  const rate = await usdRate(ctx, currency);
  if (rate === undefined) return; // its exchange rate is on the way: the next trade fills it
  const usdPrice = price * rate;
  let filled = false;
  for (const order of orders) {
    if (order.at >= time) continue;
    const book = await bookOf(ctx, order.userId);
    const { usd } = await usdPrices(ctx, book.positions.map((p) => p.symbol));
    const power = buyingPower(book, (s) => (s === symbol ? usdPrice : usd.get(s)));
    const done = fill(book, askOf(order), usdPrice, power);
    if ("refused" in done) {
      await ctx.db.patch(order._id, { status: "refused", reason: done.refused, filledAt: time });
      await notify(ctx, order.userId, { title: `${symbol} order refused`, body: done.refused, url: stockPath(symbol), tag: `stonks-${symbol}` });
      continue;
    }
    const account = await ctx.db
      .query("stockAccounts")
      .withIndex("by_user", (q) => q.eq("userId", order.userId))
      .unique();
    if (account) await ctx.db.patch(account._id, { cash: done.cash });
    else await ctx.db.insert("stockAccounts", { userId: order.userId, cash: done.cash });
    const row = book.positions.find((p) => p.symbol === symbol) as Doc<"stockPositions"> | undefined;
    if (done.position && row) await ctx.db.patch(row._id, { shares: done.position.shares, avg: done.position.avg });
    else if (done.position) await ctx.db.insert("stockPositions", { userId: order.userId, ...done.position });
    else if (row) await ctx.db.delete(row._id);
    await ctx.db.patch(order._id, { status: "filled", filledAt: time, price, currency, filledShares: done.shares, amount: done.amount, realized: done.realized });

    // An order that sat waiting (overnight, say) reports back; one that filled in a second was watched.
    if (time - order.at > 30_000) await notify(ctx, order.userId, { title: `${DID[order.side]} ${symbol}`, body: `${money(done.amount)} at ${money(usdPrice)}`, url: stockPath(symbol), tag: `stonks-${symbol}` });
    await tellTheOtherSide(ctx, order, symbol);
    filled = true;
  }
  if (filled) await writeWorth(ctx);
}

/** Today's standings as a row of history, unless nothing's changed since the last. */
async function writeWorth(ctx: MutationCtx) {
  const worths = (await standings(ctx)).filter((c) => c.traded).map((c) => ({ u: c.userId, w: Math.round(c.worth * 100) / 100 }));
  if (worths.length === 0) return;
  const last = await ctx.db.query("stockWorth").withIndex("by_t").order("desc").first();
  const same = last && last.worths.length === worths.length && last.worths.every((x) => worths.find((y) => y.u === x.u)?.w === x.w);
  if (!same) await ctx.db.insert("stockWorth", { t: Date.now(), worths });
}

export const recordWorth = internalMutation({ args: {}, handler: writeWorth });

// Fine detail for the last few days, then hourly, then daily, so a game can run for a year.
const HOURLY_AFTER = 3 * 86_400_000;
const DAILY_AFTER = 14 * 86_400_000;
export const thinWorth = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const old = await ctx.db
      .query("stockWorth")
      .withIndex("by_t", (q) => q.lt("t", now - HOURLY_AFTER))
      .collect();
    let bucket = -1;
    for (const row of old) {
      const size = now - row.t > DAILY_AFTER ? 86_400_000 : 3_600_000;
      const b = Math.floor(row.t / size);
      if (b === bucket) await ctx.db.delete(row._id);
      bucket = b;
    }
  },
});

/** The whole game's net worth, for the crew's chart and each player's. */
export const worthHistory = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("stockWorth").withIndex("by_t").collect();
    return rows.map((r) => ({ t: r.t, worths: r.worths }));
  },
});

/** Betting against a friend's position tells them: a short or a sale when they're long, a buy when they're short. */
async function tellTheOtherSide(ctx: MutationCtx, order: Doc<"stockOrders">, symbol: string) {
  const me = await ctx.db.get(order.userId);
  if (!me || me.isTest) return;
  const holders = await ctx.db
    .query("stockPositions")
    .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
    .collect();
  for (const h of holders) {
    if (h.userId === order.userId) continue;
    const against = order.side === "short" || order.side === "sell" ? h.shares > 0 : order.side === "buy" && h.shares < 0;
    if (!against) continue;
    await notify(ctx, h.userId, {
      title: `${me.name ?? "Someone"} ${DID[order.side].toLowerCase()} ${symbol}`,
      body: h.shares > 0 ? "And you own it." : "And you're short it.",
      url: stockPath(symbol),
      tag: `stonks-${symbol}`,
    });
  }
}

const SIDE = v.union(v.literal("buy"), v.literal("sell"), v.literal("short"), v.literal("cover"));

/** Places an order. It waits for the next trade: the price it fills at is one nobody could know at the tap. */
export const order = mutation({
  args: { symbol: v.string(), side: SIDE, dollars: v.optional(v.number()), shares: v.optional(v.number()) },
  handler: async (ctx, { symbol, side, dollars, shares }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    if (!(await quoteOf(ctx, symbol))) throw new Error("You can't trade that.");
    const ask: Ask = { side, symbol, dollars, shares };
    const book = await bookOf(ctx, userId);
    const why = refusal(book, ask);
    if (why) throw new Error(why);
    const waiting = await ctx.db
      .query("stockOrders")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "waiting"))
      .collect();
    // The same tap twice in a moment is one order.
    const now = Date.now();
    const twin = waiting.find((o) => o.symbol === symbol && o.side === side && o.dollars === dollars && o.shares === shares && now - o.at < 3000);
    if (twin) return twin._id;
    if (opens(side)) {
      if (dollars === undefined || !(dollars >= MIN_ORDER)) throw new Error(`The smallest order is ${money(MIN_ORDER)}.`);
      const { usd } = await usdPrices(ctx, book.positions.map((p) => p.symbol));
      const free = buyingPower(book, (s) => usd.get(s)) - waiting.reduce((n, o) => n + (o.dollars ?? 0), 0);
      if (dollars > free + 0.005) throw new Error(`You have ${money(Math.max(0, free))} to invest.`);
    } else if (shares !== undefined && !(shares > 0)) throw new Error("Pick how many.");
    return ctx.db.insert("stockOrders", { userId, symbol, side, dollars, shares, status: "waiting", at: now });
  },
});

export const cancelOrder = mutation({
  args: { id: v.id("stockOrders") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const o = await ctx.db.get(id);
    if (!o || o.userId !== userId) throw new Error("That isn't your order.");
    if (o.status === "waiting") await ctx.db.patch(id, { status: "cancelled" });
  },
});

/** My money: net worth, what's free, positions at live prices, orders waiting and the latest fill. */
export const portfolio = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const book = await bookOf(ctx, userId);
    const { quotes, usd } = await usdPrices(ctx, book.positions.map((p) => p.symbol));
    const price = (s: string) => usd.get(s);
    const waiting = await ctx.db
      .query("stockOrders")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "waiting"))
      .collect();
    const filled = await ctx.db
      .query("stockOrders")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "filled"))
      .order("desc")
      .first();
    const worth = netWorth(book, price);
    return {
      cash: book.cash,
      worth,
      gain: worth - START_CASH,
      start: START_CASH,
      free: buyingPower(book, price) - waiting.reduce((n, o) => n + (o.dollars ?? 0), 0),
      positions: book.positions
        .map((p) => {
          const now = usd.get(p.symbol) ?? p.avg; // all in dollars, so a currency's moves count too
          return { symbol: p.symbol, name: quotes.get(p.symbol)?.name, shares: p.shares, avg: p.avg, price: now, value: p.shares * now, gain: p.shares * (now - p.avg), gainPct: (Math.sign(p.shares) * (now - p.avg)) / p.avg };
        })
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      waiting: await Promise.all(
        waiting.map(async (o) => {
          const q = await quoteOf(ctx, o.symbol);
          return { id: o._id, symbol: o.symbol, side: o.side, dollars: o.dollars, shares: o.shares, at: o.at, quote: q && { type: q.type, exchange: q.exchange, state: q.state, time: q.time, recv: q.recv, periodOpen: q.periodOpen, periodClose: q.periodClose } };
        }),
      ),
      lastFill: filled && { id: filled._id, side: filled.side, symbol: filled.symbol, amount: filled.amount ?? 0, price: filled.price ?? 0, currency: filled.currency },
    };
  },
});

/** Everyone, richest first, at live prices. */
async function standings(ctx: QueryCtx) {
  const users = await ctx.db.query("users").collect();
  const positions = await ctx.db.query("stockPositions").collect();
  const accounts = new Map((await ctx.db.query("stockAccounts").collect()).map((a) => [a.userId, a.cash]));
  const profiles = new Map((await ctx.db.query("profiles").collect()).map((p) => [p.userId, p]));
  const { usd } = await usdPrices(ctx, positions.map((p) => p.symbol));
  return users
    .map((u) => {
      const book = { cash: accounts.get(u._id) ?? START_CASH, positions: positions.filter((p) => p.userId === u._id) };
      const worth = netWorth(book, (s) => usd.get(s));
      const f = profiles.get(u._id);
      return {
        userId: u._id,
        name: u.name ?? "Someone",
        image: u.image,
        joinedAt: u._creationTime,
        frame: f?.frame,
        frameColor: f?.frameColor,
        glow: f?.glow,
        badge: f?.badge,
        worth,
        gain: worth - START_CASH,
        positions: book.positions.length,
        traded: accounts.has(u._id),
      };
    })
    .sort((a, b) => b.worth - a.worth || a.name.localeCompare(b.name));
}

/** The whole crew ranked by net worth, live with every price. */
export const crew = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];
    return (await standings(ctx)).map((c) => ({ ...c, me: c.userId === me }));
  },
});

/** A player's stock profile: their card, money, positions, what they're waiting on, and their record. All public. */
export const player = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const book = await bookOf(ctx, userId);
    const { quotes, usd } = await usdPrices(ctx, book.positions.map((p) => p.symbol));
    const worth = netWorth(book, (s) => usd.get(s));
    const ranks = await standings(ctx);
    const positions = book.positions
      .map((p) => {
        const now = usd.get(p.symbol) ?? p.avg;
        return { symbol: p.symbol, name: quotes.get(p.symbol)?.name, shares: p.shares, avg: p.avg, price: now, value: p.shares * now, gain: p.shares * (now - p.avg), gainPct: (Math.sign(p.shares) * (now - p.avg)) / p.avg };
      })
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const waiting = await ctx.db
      .query("stockOrders")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "waiting"))
      .collect();
    const fills = await ctx.db
      .query("stockOrders")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "filled"))
      .order("desc")
      .collect();
    const closes = fills.filter((o) => o.realized !== undefined && o.realized !== 0);
    const best = closes.reduce<(typeof closes)[number] | null>((m, o) => (!m || o.realized! > m.realized! ? o : m), null);
    const worst = closes.reduce<(typeof closes)[number] | null>((m, o) => (!m || o.realized! < m.realized! ? o : m), null);
    return {
      card: card(user, profile),
      me: userId === me,
      worth,
      gain: worth - START_CASH,
      start: START_CASH,
      // What isn't backing a position: with the positions, this adds up to their net worth.
      idle: Math.max(0, worth - positions.reduce((n, p) => n + Math.abs(p.value), 0)),
      place: ranks.findIndex((r) => r.userId === userId) + 1,
      of: ranks.length,
      positions,
      waiting: await Promise.all(
        waiting.map(async (o) => {
          const q = await quoteOf(ctx, o.symbol);
          return { id: o._id, symbol: o.symbol, side: o.side, dollars: o.dollars, shares: o.shares, at: o.at, quote: q && { type: q.type, exchange: q.exchange, state: q.state, time: q.time, recv: q.recv, periodOpen: q.periodOpen, periodClose: q.periodClose } };
        }),
      ),
      record: {
        trades: fills.length,
        wins: closes.filter((o) => o.realized! > 0).length,
        losses: closes.filter((o) => o.realized! < 0).length,
        realized: closes.reduce((n, o) => n + o.realized!, 0),
        best: best && { symbol: best.symbol, realized: best.realized! },
        worst: worst && { symbol: worst.symbol, realized: worst.realized! },
      },
      history: fills.slice(0, 50).map((o) => ({ id: o._id, side: o.side, symbol: o.symbol, amount: o.amount ?? 0, price: o.price ?? 0, currency: o.currency, at: o.filledAt ?? o.at, realized: o.realized })),
    };
  },
});

/** The crew's latest trades, for all to see. */
export const trades = query({
  args: { symbol: v.optional(v.string()) },
  handler: async (ctx, { symbol }) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    const recent = await ctx.db
      .query("stockOrders")
      .withIndex("by_status_filled", (q) => q.eq("status", "filled"))
      .order("desc")
      .take(symbol ? 200 : 12);
    const rows = (symbol ? recent.filter((o) => o.symbol === symbol) : recent).slice(0, 12);
    return Promise.all(
      rows.map(async (o) => {
        const u = await ctx.db.get(o.userId);
        return { id: o._id, userId: o.userId, name: u?.name ?? "Someone", image: u?.image, side: o.side, symbol: o.symbol, amount: o.amount ?? 0, price: o.price ?? 0, currency: o.currency, at: o.filledAt ?? o.at, realized: o.realized };
      }),
    );
  },
});

/** Who in the crew is in this stock, and which way. */
export const holders = query({
  args: { symbol: v.string() },
  handler: async (ctx, { symbol }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];
    const { usd } = await usdPrices(ctx, [symbol]);
    const price = usd.get(symbol);
    const rows = await ctx.db
      .query("stockPositions")
      .withIndex("by_symbol", (q) => q.eq("symbol", symbol))
      .collect();
    return Promise.all(
      rows.map(async (p) => {
        const u = await ctx.db.get(p.userId);
        const now = price ?? p.avg;
        return { userId: p.userId, me: p.userId === me, name: u?.name ?? "Someone", image: u?.image, shares: p.shares, value: p.shares * now, gainPct: (Math.sign(p.shares) * (now - p.avg)) / p.avg };
      }),
    );
  },
});

/** A company's key stats (and the sidecar's news for it), replacing what's there. Either can come alone. */
export const setProfile = internalMutation({
  args: { symbol: v.string(), stats: v.optional(statsValidator), news: v.optional(v.array(newsItem)) },
  handler: async (ctx, { symbol, stats, news }) => {
    const row = await profileOf(ctx, symbol);
    const now = Date.now();
    const patch = { ...(stats && { stats, statsAt: now }), ...(news && { news, newsAt: now }), at: now };
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
