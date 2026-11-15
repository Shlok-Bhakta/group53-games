import type { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { INDEX, RANGES, type Range } from "../../../convex/stonks/market";

const until = new Map<string, number>();

function warm<Q extends FunctionReference<"query">>(convex: ConvexReactClient, query: Q, args: Q["_args"], ms = 90_000) {
  const key = `${getFunctionName(query)}:${JSON.stringify(args)}`;
  const now = Date.now();
  if ((until.get(key) ?? 0) > now + ms / 2) return;
  until.set(key, now + ms);
  convex.prewarmQuery({ query, args, extendSubscriptionFor: ms });
  ((globalThis as { __stonksWarmed?: string[] }).__stonksWarmed ??= []).push(key);
}

export const savedRange = (): Range => {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem("stonks-range");
  return (RANGES as readonly string[]).includes(saved ?? "") ? (saved as Range) : "1D";
};

export function warmBoard(convex: ConvexReactClient, ms = 120_000) {
  warm(convex, api.stonks.board, {}, ms);
  warm(convex, api.stonks.sparks, {}, ms);
  warm(convex, api.stonks.portfolio, {}, ms);
  warm(convex, api.stonks.crew, {}, ms);
  warm(convex, api.stonks.trades, {}, ms);
  warm(convex, api.stonks.worthHistory, {}, ms);
  warm(convex, api.stonks.quote, { symbol: INDEX }, ms);
  warm(convex, api.stonks.profile, { symbol: INDEX }, ms);
  warm(convex, api.stonks.chart, { symbol: INDEX, range: savedRange() }, ms);
}

const reported = new Map<string, number>();
let queue: Record<Level, Set<string>> = { seen: new Set(), open: new Set() };
let flushing: ReturnType<typeof setTimeout> | null = null;
type Level = "seen" | "open";

export function report(convex: ConvexReactClient, symbol: string, level: Level) {
  if (typeof document !== "undefined" && document.hidden) return;
  const key = `${level}:${symbol}`;
  const now = Date.now();
  if ((reported.get(key) ?? 0) > now - 40_000) return;
  reported.set(key, now);
  queue[level].add(symbol);
  flushing ??= setTimeout(() => {
    const { seen, open } = queue;
    queue = { seen: new Set(), open: new Set() };
    flushing = null;
    if (open.size) void convex.mutation(api.stonks.watching, { symbols: [...open], level: "open" }).catch(() => {});
    if (seen.size) void convex.mutation(api.stonks.watching, { symbols: [...seen], level: "seen" }).catch(() => {});
  }, 60);
}

export const stockPath = (symbol: string) => `/stonks/${encodeURIComponent(symbol)}`;

export function warmStock(convex: ConvexReactClient, symbol: string, level: Level = "seen") {
  report(convex, symbol, level);
  warm(convex, api.stonks.quote, { symbol });
  warm(convex, api.stonks.profile, { symbol });
  warm(convex, api.stonks.holders, { symbol });
  warm(convex, api.stonks.trades, { symbol });
  warm(convex, api.stonks.chart, { symbol, range: savedRange() });
  warm(convex, api.stonks.chart, { symbol, range: "1D" });
}

export const playerPath = (userId: string) => `/stonks/u/${userId}`;

export function warmPlayer(convex: ConvexReactClient, userId: string) {
  warm(convex, api.stonks.player, { userId: userId as Id<"users"> });
}

export function warmRanges(convex: ConvexReactClient, symbol: string) {
  for (const range of RANGES) warm(convex, api.stonks.chart, { symbol, range }, 120_000);
}
