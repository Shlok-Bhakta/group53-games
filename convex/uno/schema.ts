import { defineTable } from "convex/server";
import { v } from "convex/values";

export const unoTables = {
  unoLog: defineTable({
    matchId: v.id("matches"),
    seq: v.number(),
    by: v.number(),
    state: v.any(),
    at: v.number(),
  }).index("by_match", ["matchId", "seq"]),
};
