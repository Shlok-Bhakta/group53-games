import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// A player's plan for their next move, in the `drafts` table: private to them, but `count` (how much they've
// planned) is for everyone, so others can see that someone is planning.

async function draftRow(ctx: QueryCtx, matchId: Id<"matches">, userId: Id<"users">) {
  return await ctx.db
    .query("drafts")
    .withIndex("by_match_user", (q) => q.eq("matchId", matchId).eq("userId", userId))
    .unique();
}

export async function readDraft<T>(ctx: QueryCtx, matchId: Id<"matches">, userId: Id<"users">): Promise<T | null> {
  return ((await draftRow(ctx, matchId, userId))?.data as T | undefined) ?? null;
}

export async function writeDraft<T>(ctx: MutationCtx, matchId: Id<"matches">, userId: Id<"users">, data: T, count: number) {
  const row = await draftRow(ctx, matchId, userId);
  if (row) await ctx.db.patch(row._id, { data, count, at: Date.now() });
  else await ctx.db.insert("drafts", { matchId, userId, data, count, at: Date.now() });
}

export async function clearDraft(ctx: MutationCtx, matchId: Id<"matches">, userId: Id<"users">) {
  const row = await draftRow(ctx, matchId, userId);
  if (row) await ctx.db.delete(row._id);
}

// Everyone's drafts in one game.
export async function draftsOf(ctx: QueryCtx, matchId: Id<"matches">) {
  return await ctx.db
    .query("drafts")
    .withIndex("by_match_user", (q) => q.eq("matchId", matchId))
    .collect();
}

// The signed-in player's own draft, for a query.
export async function myDraft<T>(ctx: QueryCtx, matchId: Id<"matches">): Promise<T | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await readDraft<T>(ctx, matchId, userId);
}
