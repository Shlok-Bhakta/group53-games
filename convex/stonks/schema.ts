import { defineTable } from "convex/server";
import { v } from "convex/values";
import { newsItem, profileStats } from "./profile";

export const stonksTables = {
  stockQuotes: defineTable({
    symbol: v.string(),
    name: v.optional(v.string()),
    price: v.number(),
    time: v.number(),
    recv: v.number(),
    source: v.string(),
    session: v.optional(v.string()),
    prevClose: v.optional(v.number()),
    regularPrice: v.optional(v.number()),
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
    periodOpen: v.optional(v.number()),
    periodClose: v.optional(v.number()),
    minute: v.optional(v.number()),
    minuteClose: v.optional(v.number()),
  }).index("by_symbol", ["symbol"]),
  stockSeries: defineTable({ symbol: v.string(), range: v.string(), points: v.array(v.array(v.number())), at: v.number() })
    .index("by_symbol_range", ["symbol", "range"])
    .index("by_at", ["at"]),
  stockDayHours: defineTable({ symbol: v.string(), hour: v.number(), points: v.array(v.array(v.number())), at: v.number() })
    .index("by_symbol_hour", ["symbol", "hour"])
    .index("by_at", ["at"]),
  stockIndex: defineTable({
    key: v.string(),
    asOf: v.string(),
    at: v.number(),
    holdings: v.array(v.object({ symbol: v.string(), name: v.string(), weight: v.number(), base: v.optional(v.number()) })),
    indexBase: v.optional(v.number()),
  }).index("by_key", ["key"]),
  stockProfiles: defineTable({
    symbol: v.string(),
    stats: v.optional(v.object(profileStats)),
    news: v.optional(v.array(newsItem)),
    at: v.number(),
    statsAt: v.optional(v.number()),
    newsAt: v.optional(v.number()),
  }).index("by_symbol", ["symbol"]),
  stockAccounts: defineTable({ userId: v.id("users"), cash: v.number() }).index("by_user", ["userId"]),
  stockPositions: defineTable({ userId: v.id("users"), symbol: v.string(), shares: v.number(), avg: v.number() })
    .index("by_user", ["userId"])
    .index("by_symbol", ["symbol"]),
  stockOrders: defineTable({
    userId: v.id("users"),
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell"), v.literal("short"), v.literal("cover")),
    dollars: v.optional(v.number()),
    shares: v.optional(v.number()),
    status: v.union(v.literal("waiting"), v.literal("filled"), v.literal("cancelled"), v.literal("refused")),
    at: v.number(),
    filledAt: v.optional(v.number()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    filledShares: v.optional(v.number()),
    amount: v.optional(v.number()),
    realized: v.optional(v.number()),
    reason: v.optional(v.string()),
  })
    .index("by_symbol_status", ["symbol", "status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_status_filled", ["status", "filledAt"]),
  stockSymbols: defineTable({
    symbol: v.string(),
    name: v.string(),
    type: v.optional(v.string()),
    exchange: v.optional(v.string()),
    search: v.string(),
  })
    .index("by_symbol", ["symbol"])
    .searchIndex("search_text", { searchField: "search" }),
  stockLookups: defineTable({ q: v.string(), done: v.boolean(), at: v.number(), symbols: v.optional(v.array(v.string())) })
    .index("by_q", ["q"])
    .index("by_done", ["done"]),
  stockViews: defineTable({ symbol: v.string(), level: v.string(), until: v.number() }).index("by_symbol", ["symbol"]),
  stockWorth: defineTable({ t: v.number(), worths: v.array(v.object({ u: v.id("users"), w: v.number() })) }).index("by_t", ["t"]),
  stockFeeds: defineTable({ source: v.string(), state: v.string(), detail: v.optional(v.string()), at: v.number() }).index("by_source", [
    "source",
  ]),
};
