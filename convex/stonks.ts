import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { notify } from "./notify";
import { buyingPower, fill, MIN_ORDER, netWorth, opens, refusal, START_CASH, type Ask, type Book, type Side } from "./stonks/trade";
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
    // Anything someone holds or has an order on keeps streaming, even if it drops out of the top.
    const held = (await ctx.db.query("stockPositions").collect()).map((p) => p.symbol);
    const waiting = (await ctx.db.query("stockOrders").withIndex("by_status_filled", (q) => q.eq("status", "waiting")).collect()).map((o) => o.symbol);
    return [...new Set([INDEX, ...(idx?.holdings.map((h) => h.symbol) ?? []), ...held, ...waiting])];
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
  for (const order of orders) {
    if (order.at >= time) continue;
    const book = await bookOf(ctx, order.userId);
    const prices = await pricesOf(ctx, book.positions.map((p) => p.symbol));
    const power = buyingPower(book, (s) => (s === symbol ? price : prices.get(s)?.price));
    const done = fill(book, askOf(order), price, power);
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
    await ctx.db.patch(order._id, { status: "filled", filledAt: time, price, filledShares: done.shares, amount: done.amount, realized: done.realized });

    // An order that sat waiting (overnight, say) reports back; one that filled in a second was watched.
    if (time - order.at > 30_000) await notify(ctx, order.userId, { title: `${DID[order.side]} ${symbol}`, body: `${money(done.amount)} at ${money(price)}`, url: stockPath(symbol), tag: `stonks-${symbol}` });
    await tellTheOtherSide(ctx, order, symbol);
  }
}

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
    if (!(await quoteOf(ctx, symbol)) || symbol === INDEX) throw new Error("You can't trade that.");
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
      const prices = await pricesOf(ctx, book.positions.map((p) => p.symbol));
      const free = buyingPower(book, (s) => prices.get(s)?.price) - waiting.reduce((n, o) => n + (o.dollars ?? 0), 0);
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
    const quotes = await pricesOf(ctx, book.positions.map((p) => p.symbol));
    const price = (s: string) => quotes.get(s)?.price;
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
          const q = quotes.get(p.symbol);
          const now = q?.price ?? p.avg;
          return { symbol: p.symbol, name: q?.name, shares: p.shares, avg: p.avg, price: now, value: p.shares * now, gain: p.shares * (now - p.avg), gainPct: (Math.sign(p.shares) * (now - p.avg)) / p.avg };
        })
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      waiting: waiting.map((o) => ({ id: o._id, symbol: o.symbol, side: o.side, dollars: o.dollars, shares: o.shares, at: o.at })),
      lastFill: filled && { id: filled._id, side: filled.side, symbol: filled.symbol, amount: filled.amount ?? 0, price: filled.price ?? 0 },
    };
  },
});

/** The whole crew ranked by net worth, live with every price. */
export const crew = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];
    const users = await ctx.db.query("users").collect();
    const positions = await ctx.db.query("stockPositions").collect();
    const accounts = new Map((await ctx.db.query("stockAccounts").collect()).map((a) => [a.userId, a.cash]));
    const profiles = new Map((await ctx.db.query("profiles").collect()).map((p) => [p.userId, p]));
    const quotes = await pricesOf(ctx, positions.map((p) => p.symbol));
    return users
      .map((u) => {
        const book = { cash: accounts.get(u._id) ?? START_CASH, positions: positions.filter((p) => p.userId === u._id) };
        const worth = netWorth(book, (s) => quotes.get(s)?.price);
        const f = profiles.get(u._id);
        return { userId: u._id, me: u._id === me, name: u.name ?? "Someone", image: u.image, frame: f?.frame, frameColor: f?.frameColor, glow: f?.glow, badge: f?.badge, worth, gain: worth - START_CASH, positions: book.positions.length };
      })
      .sort((a, b) => b.worth - a.worth || a.name.localeCompare(b.name));
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
        return { id: o._id, name: u?.name ?? "Someone", image: u?.image, side: o.side, symbol: o.symbol, amount: o.amount ?? 0, price: o.price ?? 0, at: o.filledAt ?? o.at, realized: o.realized };
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
    const price = (await quoteOf(ctx, symbol))?.price;
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
