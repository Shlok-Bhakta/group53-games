import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { chessTables } from "./chess/schema";
import { golfTables } from "./golf/schema";
import { landlordTables } from "./landlord/schema";
import { stonksTables } from "./stonks/schema";

export default defineSchema({
  ...authTables,
  ...chessTables,
  ...golfTables,
  ...landlordTables,
  ...stonksTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    discordUsername: v.optional(v.string()),
    isTest: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  profiles: defineTable({
    userId: v.id("users"),
    frame: v.string(),
    frameColor: v.string(),
    glow: v.boolean(),
    effect: v.string(),
    badge: v.string(),
    tagline: v.string(),
  }).index("by_user", ["userId"]),
  presence: defineTable({
    userId: v.id("users"),
    online: v.boolean(),
    lastSeen: v.number(),
    path: v.string(),
    tap: v.optional(v.object({ x: v.number(), y: v.number(), path: v.string(), seq: v.number() })),
  }).index("by_user", ["userId"]),
  taps: defineTable({ userId: v.id("users"), x: v.number(), y: v.number(), path: v.string(), seq: v.number() }).index("by_user", [
    "userId",
  ]),
  matches: defineTable({
    mode: v.string(),
    status: v.union(v.literal("waiting"), v.literal("active"), v.literal("finished"), v.literal("cancelled")),
    createdBy: v.id("users"),
    players: v.array(v.object({ userId: v.id("users"), color: v.optional(v.string()) })),
    invited: v.array(v.id("users")),
    openSeats: v.optional(v.boolean()),
    settings: v.optional(v.record(v.string(), v.number())),
    state: v.any(),
    turn: v.optional(v.id("users")),
    moveCount: v.number(),
    drawOffer: v.optional(v.id("users")),
    result: v.optional(
      v.object({
        winners: v.array(v.id("users")),
        draw: v.boolean(),
        reason: v.string(),
        standings: v.optional(v.array(v.array(v.id("users")))),
      }),
    ),
    ratingChanges: v.optional(v.array(v.object({ userId: v.id("users"), before: v.number(), after: v.number() }))),
    rematchOf: v.optional(v.id("matches")),
    rematch: v.optional(
      v.object({
        by: v.id("users"),
        yes: v.optional(v.array(v.id("users"))),
        at: v.number(),
        status: v.union(v.literal("pending"), v.literal("declined"), v.literal("accepted")),
        matchId: v.optional(v.id("matches")),
      }),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    lastActivityAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_mode_status", ["mode", "status"])
    .index("by_creator_status", ["createdBy", "status"]),
  secrets: defineTable({ matchId: v.id("matches"), userId: v.optional(v.id("users")), data: v.any() }).index("by_match_user", [
    "matchId",
    "userId",
  ]),
  drafts: defineTable({ matchId: v.id("matches"), userId: v.id("users"), data: v.any(), count: v.number(), at: v.number() }).index(
    "by_match_user",
    ["matchId", "userId"],
  ),
  handoffs: defineTable({ userId: v.id("users"), matchId: v.id("matches"), at: v.number() }).index("by_user", ["userId"]),
  ratings: defineTable({
    userId: v.id("users"),
    mode: v.string(),
    rating: v.number(),
    games: v.number(),
    wins: v.number(),
    losses: v.number(),
    draws: v.number(),
  })
    .index("by_mode", ["mode"])
    .index("by_user_mode", ["userId", "mode"]),
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  testPushes: defineTable({
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    tag: v.optional(v.string()),
    badge: v.number(),
  }).index("by_user", ["userId"]),
  hostedGames: defineTable({ game: v.string(), build: v.string(), previous: v.optional(v.string()) }).index("by_game", ["game"]),
  hostedFiles: defineTable({
    game: v.string(),
    build: v.string(),
    path: v.string(),
    storageId: v.id("_storage"),
    type: v.string(),
    gzip: v.boolean(),
  }).index("by_path", ["game", "build", "path"]),
});
