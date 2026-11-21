import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ONLINE_WINDOW_MS } from "./presenceConfig";
import { canonicalGamePath, matchPath, pushGamePath } from "./modes";
import { awaits } from "./lib/seats";

export type Push = { title: string; body: string; url: string; tag?: string };

const onTestBackend = () => process.env.ALLOW_TEST_HELPERS === "1";

async function isLookingAt(ctx: MutationCtx, userId: Id<"users">, url: string) {
  const presence = await ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return (
    !!presence &&
    presence.online &&
    Date.now() - presence.lastSeen < ONLINE_WINDOW_MS &&
    canonicalGamePath(presence.path) === canonicalGamePath(url)
  );
}

export async function notify(ctx: MutationCtx, userId: Id<"users">, push: Push) {
  const testPlayer = (await ctx.db.get(userId))?.isTest;
  if (testPlayer && !onTestBackend()) return;
  if (await isLookingAt(ctx, userId, push.url)) return;
  const badge = await badgeCount(ctx, userId);
  const url = pushGamePath(push.url);
  if (testPlayer) await ctx.db.insert("testPushes", { userId, title: push.title, body: push.body, url, tag: push.tag, badge });
  else await ctx.scheduler.runAfter(0, internal.push.sendToUser, { userId, ...push, url, badge });
}

export async function badgeCount(ctx: MutationCtx, userId: Id<"users">) {
  const active = await ctx.db
    .query("matches")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .collect();
  const waiting = await ctx.db
    .query("matches")
    .withIndex("by_status", (q) => q.eq("status", "waiting"))
    .collect();
  const myTurn = active.filter((m) => awaits(m, userId)).length;
  const invites = waiting.filter((m) => m.invited.includes(userId) && !m.players.some((p) => p.userId === userId)).length;
  return myTurn + invites;
}

export const matchTag = (match: { _id: string }) => `match:${match._id}`;

export async function notifyMatch(
  ctx: MutationCtx,
  userId: Id<"users">,
  match: { _id: string; mode: string },
  push: { title: string; body: string; url?: string },
) {
  await notify(ctx, userId, { title: push.title, body: push.body, url: push.url ?? matchPath(match), tag: matchTag(match) });
}

export async function isTestUser(ctx: MutationCtx, userId: Id<"users">) {
  return (await ctx.db.get(userId))?.isTest === true;
}
