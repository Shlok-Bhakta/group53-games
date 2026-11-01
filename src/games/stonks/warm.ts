import type { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { INDEX, RANGES, type Range } from "../../../convex/stonks/market";

// Stonks never makes you wait on a tap: whatever you can tap next is already subscribed, so its screen
// renders from the client's cache in the same frame. Convex's prewarm holds a subscription for a while
// and drops it after; `warm` renews it while it's still wanted and never doubles one up.
//
// What's warm: from the Games card, the board itself; on the board, each row you can see (its price and
// chart in the range you last used); on a stock, its other ranges. Not all 25 stocks: only what's on
// screen, so it stays light however long the list gets.

const until = new Map<string, number>();

function warm<Q extends FunctionReference<"query">>(convex: ConvexReactClient, query: Q, args: Q["_args"], ms = 90_000) {
  const key = `${getFunctionName(query)}:${JSON.stringify(args)}`;
  const now = Date.now();
  if ((until.get(key) ?? 0) > now + ms / 2) return;
  until.set(key, now + ms);
  convex.prewarmQuery({ query, args, extendSubscriptionFor: ms });
  // e2e/stonks.spec.ts reads what's been warmed.
  ((globalThis as { __stonksWarmed?: string[] }).__stonksWarmed ??= []).push(key);
}

export const savedRange = (): Range => {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem("stonks-range");
  return (RANGES as readonly string[]).includes(saved ?? "") ? (saved as Range) : "1D";
};

/** The board: prices, sparklines, and the index's chart in your range. */
export function warmBoard(convex: ConvexReactClient, ms = 120_000) {
  warm(convex, api.stonks.board, {}, ms);
  warm(convex, api.stonks.sparks, {}, ms);
  warm(convex, api.stonks.portfolio, {}, ms);
  warm(convex, api.stonks.crew, {}, ms);
  warm(convex, api.stonks.trades, {}, ms);
  warm(convex, api.stonks.quote, { symbol: INDEX }, ms);
  warm(convex, api.stonks.profile, { symbol: INDEX }, ms);
  warm(convex, api.stonks.chart, { symbol: INDEX, range: savedRange() }, ms);
}

/** One stock's page as it'll open: its price and stats, and its chart in your range. */
export function warmStock(convex: ConvexReactClient, symbol: string) {
  warm(convex, api.stonks.quote, { symbol });
  warm(convex, api.stonks.profile, { symbol });
  warm(convex, api.stonks.holders, { symbol });
  warm(convex, api.stonks.trades, { symbol });
  warm(convex, api.stonks.chart, { symbol, range: savedRange() });
  // The open (and the after-hours line) comes from the day's chart whatever the range.
  warm(convex, api.stonks.chart, { symbol, range: "1D" });
}

/** Every range of one chart, so switching ranges is instant. */
export function warmRanges(convex: ConvexReactClient, symbol: string) {
  for (const range of RANGES) warm(convex, api.stonks.chart, { symbol, range }, 120_000);
}
