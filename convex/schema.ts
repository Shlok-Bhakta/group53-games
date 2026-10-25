import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  // Convex Auth rewrites name, image, and discordUsername from Discord on every sign-in.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    discordUsername: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  // Cosmetics live apart from users so a Discord sync never clobbers them.
  profiles: defineTable({
    userId: v.id("users"),
    frame: v.string(),
    frameColor: v.string(),
    glow: v.boolean(),
    effect: v.string(),
    badge: v.string(),
    tagline: v.string(),
  }).index("by_user", ["userId"]),
  // One row per player: heartbeat for the online dot, plus their latest tap so others can see it.
  presence: defineTable({
    userId: v.id("users"),
    online: v.boolean(),
    lastSeen: v.number(),
    path: v.string(),
    tap: v.optional(v.object({ x: v.number(), y: v.number(), path: v.string(), seq: v.number() })),
  }).index("by_user", ["userId"]),
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),
});
