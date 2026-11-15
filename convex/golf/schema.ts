import { defineTable } from "convex/server";
import { v } from "convex/values";

export const golfTables = {
  golfWorlds: defineTable({
    key: v.string(),
    startAt: v.number(),
    awake: v.boolean(),
    collide: v.boolean(),
    matchId: v.optional(v.id("matches")),
    hole: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_match", ["matchId"]),
  golfCourses: defineTable({ matchId: v.id("matches"), n: v.number(), course: v.any() }).index("by_match", ["matchId", "n"]),
  golfPreviews: defineTable({ key: v.string(), n: v.number(), course: v.any(), at: v.number() }).index("by_key", ["key", "n"]),
  golfPreviewJobs: defineTable({ key: v.string(), total: v.number(), at: v.number() }).index("by_key", ["key"]),
  golfPlayers: defineTable({ worldId: v.id("golfWorlds"), userId: v.id("users"), joinedAt: v.number() }).index("by_world", ["worldId"]),
  golfCommands: defineTable({
    worldId: v.id("golfWorlds"),
    tick: v.number(),
    by: v.id("users"),
    seq: v.number(),
    kind: v.union(
      v.literal("join"),
      v.literal("leave"),
      v.literal("shot"),
      v.literal("use"),
      v.literal("fire"),
      v.literal("hop"),
      v.literal("brake"),
      v.literal("reset"),
      v.literal("turn"),
      v.literal("pickup"),
    ),
    a: v.optional(v.number()),
    p: v.optional(v.number()),
    i: v.optional(v.number()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    bag: v.optional(v.array(v.string())),
  }).index("by_world_tick", ["worldId", "tick"]),
  golfSnapshots: defineTable({ worldId: v.id("golfWorlds"), tick: v.number(), state: v.any() }).index("by_world", ["worldId"]),
  golfStarts: defineTable({ worldId: v.id("golfWorlds"), state: v.any() }).index("by_world", ["worldId"]),
  golfBags: defineTable({ course: v.string(), userId: v.id("users"), bag: v.array(v.string()), at: v.number() }).index("by_course_user", [
    "course",
    "userId",
  ]),
  golfScores: defineTable({
    hole: v.string(),
    userId: v.id("users"),
    best: v.number(),
    last: v.number(),
    plays: v.number(),
    at: v.number(),
  }).index("by_hole_user", ["hole", "userId"]),
};
