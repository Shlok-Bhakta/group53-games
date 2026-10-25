import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ONLINE_WINDOW_MS } from "./presenceConfig";

export type Push = { title: string; body: string; url: string; tag?: string };

// Sends a push unless the player is looking at that exact screen right now (they'll see it live).
export async function notify(ctx: MutationCtx, userId: Id<"users">, push: Push) {
  if ((await ctx.db.get(userId))?.isTest) return;
  const presence = await ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const watching = presence && presence.online && Date.now() - presence.lastSeen < ONLINE_WINDOW_MS && presence.path === push.url;
  if (watching) return;
  await ctx.scheduler.runAfter(0, internal.push.sendToUser, { userId, ...push });
}

export async function displayName(ctx: MutationCtx, userId: Id<"users">) {
  return (await ctx.db.get(userId))?.name ?? "Someone";
}

export async function isTestUser(ctx: MutationCtx, userId: Id<"users">) {
  return (await ctx.db.get(userId))?.isTest === true;
}
