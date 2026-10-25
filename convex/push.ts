"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// web-push needs Node built-ins, so this file runs in the Node runtime and reaches the database through notifications.ts.
export const sendToUser = internalAction({
  args: { userId: v.id("users"), title: v.string(), body: v.string(), url: v.optional(v.string()), tag: v.optional(v.string()), badge: v.optional(v.number()) },
  handler: async (ctx, { userId, title, body, url, tag, badge }) => {
    const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.error("VAPID env vars are not set");
      return;
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const subs = await ctx.runQuery(internal.notifications.subscriptionsFor, { userId });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url: url ?? "/", tag: tag ?? "group53", badge }),
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The device dropped this subscription.
          await ctx.runMutation(internal.notifications.removeSubscription, { id: sub._id });
        } else {
          console.error("Push send failed:", status, (err as Error).message);
        }
      }
    }
  },
});
