import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { BADGES, DEFAULT_PROFILE, EFFECTS, FRAMES, TAGLINE_MAX, isHexColor } from "./profileOptions";

function card(user: Doc<"users">, profile: Doc<"profiles"> | null) {
  return {
    _id: user._id,
    name: user.name ?? "Player",
    username: user.discordUsername,
    image: user.image,
    joinedAt: user._creationTime,
    frame: profile?.frame ?? DEFAULT_PROFILE.frame,
    frameColor: profile?.frameColor ?? DEFAULT_PROFILE.frameColor,
    glow: profile?.glow ?? DEFAULT_PROFILE.glow,
    effect: profile?.effect ?? DEFAULT_PROFILE.effect,
    badge: profile?.badge ?? DEFAULT_PROFILE.badge,
    tagline: profile?.tagline ?? DEFAULT_PROFILE.tagline,
  };
}

export type PlayerCard = ReturnType<typeof card>;

export const crew = query({
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    const users = await ctx.db.query("users").collect();
    const profiles = await ctx.db.query("profiles").collect();
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    return users.map((u) => card(u, byUser.get(u._id) ?? null));
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return card(user, profile);
  },
});

const oneOf = (list: readonly string[], value: string | undefined, what: string) => {
  if (value !== undefined && !list.includes(value)) throw new Error(`Unknown ${what}.`);
};

export const update = mutation({
  args: {
    frame: v.optional(v.string()),
    frameColor: v.optional(v.string()),
    glow: v.optional(v.boolean()),
    effect: v.optional(v.string()),
    badge: v.optional(v.string()),
    tagline: v.optional(v.string()),
  },
  handler: async (ctx, changes) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    oneOf(FRAMES, changes.frame, "frame");
    oneOf(EFFECTS, changes.effect, "effect");
    oneOf(BADGES, changes.badge, "badge");
    if (changes.frameColor !== undefined && !isHexColor(changes.frameColor)) throw new Error("Frame color must be a hex color.");
    if (changes.tagline !== undefined) changes.tagline = changes.tagline.replace(/\s+/g, " ").trim().slice(0, TAGLINE_MAX);
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, changes);
    else await ctx.db.insert("profiles", { userId, ...DEFAULT_PROFILE, ...changes });
  },
});
