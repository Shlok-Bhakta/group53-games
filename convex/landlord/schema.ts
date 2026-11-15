import { defineTable } from "convex/server";
import { v } from "convex/values";

export const landlordTables = {
  landlordLog: defineTable({
    matchId: v.id("matches"),
    seq: v.number(),
    by: v.number(),
    events: v.any(),
    state: v.any(),
    at: v.number(),
  }).index("by_match", ["matchId", "seq"]),
};
