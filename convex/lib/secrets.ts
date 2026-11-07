import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// State players mustn't see, in the `secrets` table: one row per player (a rack, a hand) and one for the game
// itself (no userId: the bag, the deck). Only ever returned to its owner.

async function secretRow(ctx: QueryCtx, matchId: Id<"matches">, userId?: Id<"users">) {
  return await ctx.db
    .query("secrets")
    .withIndex("by_match_user", (q) => q.eq("matchId", matchId).eq("userId", userId))
    .unique();
}

export async function readSecret<T>(ctx: QueryCtx, matchId: Id<"matches">, userId: Id<"users"> | undefined, fallback: T): Promise<T> {
  return ((await secretRow(ctx, matchId, userId))?.data as T | undefined) ?? fallback;
}

export async function writeSecret<T>(ctx: MutationCtx, matchId: Id<"matches">, userId: Id<"users"> | undefined, data: T) {
  const row = await secretRow(ctx, matchId, userId);
  if (row) await ctx.db.patch(row._id, { data });
  else await ctx.db.insert("secrets", { matchId, userId, data });
}

// The signed-in player's own secret, for a query: null when signed out or there's none.
export async function mySecret<T>(ctx: QueryCtx, matchId: Id<"matches">): Promise<T | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await readSecret<T | null>(ctx, matchId, userId, null);
}
