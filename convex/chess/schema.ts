import { defineTable } from "convex/server";
import { v } from "convex/values";

export const chessTables = {
  rtCommands: defineTable({
    matchId: v.id("matches"),
    tick: v.number(),
    color: v.string(),
    pieceId: v.number(),
    toX: v.number(),
    toY: v.number(),
    kind: v.optional(v.union(v.literal("move"), v.literal("cancel"), v.literal("resign"))),
  }).index("by_match_tick", ["matchId", "tick"]),
  rtSnapshots: defineTable({ matchId: v.id("matches"), state: v.any() }).index("by_match", ["matchId"]),
};
