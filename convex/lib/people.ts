import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// A player's name in a sentence ("Chris played e4"), or "Someone" if they're gone.
export async function displayName(ctx: QueryCtx, userId: Id<"users">) {
  return (await ctx.db.get(userId))?.name ?? "Someone";
}
export const namesOf = (ctx: QueryCtx, ids: Id<"users">[]) => Promise.all(ids.map((id) => displayName(ctx, id)));

// A player's name and picture, to show them.
export async function person(ctx: QueryCtx, userId: Id<"users">) {
  const u = await ctx.db.get(userId);
  return { _id: userId, name: u?.name ?? "Player", image: u?.image ?? null };
}
