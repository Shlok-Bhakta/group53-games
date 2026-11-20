import { defineTable } from "convex/server";
import { v } from "convex/values";

export const dailyTables = {
  dailyResults: defineTable({
    userId: v.id("users"),
    game: v.string(),
    day: v.string(),
    puzzle: v.optional(v.number()),
    score: v.number(),
    display: v.string(),
    solved: v.boolean(),
    grid: v.optional(v.string()),
    text: v.string(),
    at: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_user_game", ["userId", "game"]),
};
