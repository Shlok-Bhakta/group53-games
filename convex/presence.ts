import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function row(ctx: MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// Skip writes that change nothing meaningful, so frequent heartbeats don't churn every subscriber.
const REFRESH_MS = 5_000;

export const heartbeat = mutation({
  args: { path: v.string(), online: v.boolean() },
  handler: async (ctx, { path, online }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const existing = await row(ctx, userId);
    const fields = { online, path: path.slice(0, 100), lastSeen: Date.now() };
    if (existing && existing.online === online && existing.path === fields.path && fields.lastSeen - existing.lastSeen < REFRESH_MS) return;
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("presence", { userId, ...fields });
  },
});

// x is a fraction of the viewport width; y is page pixels from the top, so taps land on the same content.
export const tap = mutation({
  args: { x: v.number(), y: v.number(), path: v.string() },
  handler: async (ctx, { x, y, path }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const existing = await ctx.db
      .query("taps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const tap = { x: Math.min(1, Math.max(0, x)), y: Math.max(0, y), path: path.slice(0, 100), seq: (existing?.seq ?? 0) + 1 };
    if (existing) await ctx.db.patch(existing._id, tap);
    else await ctx.db.insert("taps", { userId, ...tap });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    const rows = await ctx.db.query("presence").collect();
    const taps = new Map((await ctx.db.query("taps").collect()).map((t) => [t.userId, t]));
    return rows.map((r) => {
      const t = taps.get(r.userId);
      return { userId: r.userId, online: r.online, lastSeen: r.lastSeen, path: r.path, tap: t ? { x: t.x, y: t.y, path: t.path, seq: t.seq } : null };
    });
  },
});
