// Helpers for end-to-end tests and screenshots. Internal (admin key only), and they refuse to run
// unless the deployment sets ALLOW_TEST_HELPERS=1, which only the throwaway test backend does.
import { v } from "convex/values";
import { SignJWT, importPKCS8 } from "jose";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { DEFAULT_PROFILE } from "./profileOptions";

function assertTestDeployment() {
  if (process.env.ALLOW_TEST_HELPERS !== "1") throw new Error("Test helpers are disabled on this deployment.");
}

const profileArgs = {
  frame: v.optional(v.string()),
  frameColor: v.optional(v.string()),
  glow: v.optional(v.boolean()),
  effect: v.optional(v.string()),
  badge: v.optional(v.string()),
  tagline: v.optional(v.string()),
};

export const insertPlayer = internalMutation({
  args: { name: v.string(), username: v.optional(v.string()), image: v.optional(v.string()), ...profileArgs },
  handler: async (ctx, { name, username, image, ...profile }) => {
    assertTestDeployment();
    const userId = await ctx.db.insert("users", { name, discordUsername: username, image });
    await ctx.db.insert("profiles", { userId, ...DEFAULT_PROFILE, ...profile });
    const hour = Date.now() + 3600_000;
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: hour });
    const refreshId = await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: hour });
    return { userId, sessionId, refreshToken: `${refreshId}|${sessionId}` };
  },
});

// Creates a player and signs a session token for them, the same way Convex Auth does.
export const createPlayer = internalAction({
  args: { name: v.string(), username: v.optional(v.string()), image: v.optional(v.string()), ...profileArgs },
  handler: async (ctx, args): Promise<{ userId: string; token: string; refreshToken: string }> => {
    assertTestDeployment();
    const { userId, sessionId, refreshToken } = await ctx.runMutation(internal.testing.insertPlayer, args);
    const key = await importPKCS8(process.env.JWT_PRIVATE_KEY!, "RS256");
    const token = await new SignJWT({ sub: `${userId}|${sessionId}` })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt()
      .setIssuer(process.env.CONVEX_SITE_URL!)
      .setAudience("convex")
      .setExpirationTime("1h")
      .sign(key);
    return { userId, token, refreshToken };
  },
});

const TABLES = ["presence", "pushSubscriptions", "profiles", "authRefreshTokens", "authSessions", "authAccounts", "users"] as const;

export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertTestDeployment();
    for (const table of TABLES) for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
  },
});
