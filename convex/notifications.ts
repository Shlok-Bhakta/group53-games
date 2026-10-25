import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const vapidPublicKey = query({
  args: {},
  handler: async () => process.env.VAPID_PUBLIC_KEY ?? null,
});

// Whether the server holds this device's subscription. The client compares its own endpoint against this.
export const hasEndpoint = query({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return false;
    const sub = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    return sub?.userId === userId;
  },
});

export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, sub) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", sub.endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { userId, p256dh: sub.p256dh, auth: sub.auth });
    } else {
      await ctx.db.insert("pushSubscriptions", { userId, ...sub });
    }
    await ctx.scheduler.runAfter(0, internal.push.sendToUser, {
      userId,
      title: "Notifications are on",
      body: "This is what it looks like when someone comes for you.",
      url: "/",
    });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    if (existing?.userId === userId) await ctx.db.delete(existing._id);
  },
});

export const sendTest = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await ctx.scheduler.runAfter(0, internal.push.sendToUser, {
      userId,
      title: "Test notification",
      body: "If you can read this, you're reachable.",
      url: "/settings",
    });
  },
});

export const subscriptionsFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
});

export const removeSubscription = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
