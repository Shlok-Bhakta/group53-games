import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ONLINE_WINDOW_MS } from "./presenceConfig";
import { matchPath } from "./modes";

export type Push = { title: string; body: string; url: string; tag?: string };

// Sends a push unless the player is looking at that exact screen right now (they'll see it live).
export async function notify(ctx: MutationCtx, userId: Id<"users">, push: Push) {
  const test = (await ctx.db.get(userId))?.isTest;
  // Test players never get a real push. Off the test backend that's the end of it, before any reads.
  if (test && process.env.ALLOW_TEST_HELPERS !== "1") return;
  const presence = await ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const watching = presence && presence.online && Date.now() - presence.lastSeen < ONLINE_WINDOW_MS && presence.path === push.url;
  if (watching) return;
  const badge = await badgeCount(ctx, userId);
  // On the test backend, what a test player would have been sent is kept for the e2e suite to check.
  if (test) await ctx.db.insert("testPushes", { userId, title: push.title, body: push.body, url: push.url, tag: push.tag, badge });
  else await ctx.scheduler.runAfter(0, internal.push.sendToUser, { userId, ...push, badge });
}

// The number on the app icon: games where it's my move plus challenges waiting for an answer. Pushes carry
// it so the icon updates while the app is closed; the open app keeps it current from matches.attention.
export async function badgeCount(ctx: MutationCtx, userId: Id<"users">) {
  const active = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "active")).collect();
  const waiting = await ctx.db.query("matches").withIndex("by_status", (q) => q.eq("status", "waiting")).collect();
  const myTurn = active.filter((m) => m.turn === userId).length;
  const invites = waiting.filter((m) => m.invited.includes(userId) && !m.players.some((p) => p.userId === userId)).length;
  return myTurn + invites;
}

// Every push about a game carries its tag, so a newer one replaces the last on the phone.
export const matchTag = (match: { _id: string }) => `match:${match._id}`;

// A push about a game, opening it (or `url`).
export async function notifyMatch(ctx: MutationCtx, userId: Id<"users">, match: { _id: string; mode: string }, push: { title: string; body: string; url?: string }) {
  await notify(ctx, userId, { title: push.title, body: push.body, url: push.url ?? matchPath(match), tag: matchTag(match) });
}

export async function isTestUser(ctx: MutationCtx, userId: Id<"users">) {
  return (await ctx.db.get(userId))?.isTest === true;
}
