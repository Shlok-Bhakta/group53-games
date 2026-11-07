// Helpers for end-to-end tests and screenshots. Internal (admin key only), and they refuse to run
// unless the deployment sets ALLOW_TEST_HELPERS=1, which only the throwaway test backend does.
import { v } from "convex/values";
import { initialFour } from "./chess/four/classic";
import { playTiles } from "./scrabble";
import { SignJWT, importPKCS8 } from "jose";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { DEFAULT_PROFILE } from "./profileOptions";
import schema from "./schema";
import type { Id, TableNames } from "./_generated/dataModel";

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
    const userId = await ctx.db.insert("users", { name, discordUsername: username, image, isTest: true });
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

export const getMatch = internalQuery({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    assertTestDeployment();
    return await ctx.db.get(id);
  },
});

export const profileOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    assertTestDeployment();
    return await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  },
});

// Push already on for a player's phone, without the tap: the subscription the fake push service in
// e2e/fixtures.ts hands out, saved the way notifications:subscribe saves it.
export const seedPush = internalMutation({
  args: { userId: v.id("users"), endpoint: v.string() },
  handler: async (ctx, { userId, endpoint }) => {
    assertTestDeployment();
    await ctx.db.insert("pushSubscriptions", { userId, endpoint, p256dh: "AQID", auth: "AQID" });
  },
});

// A golf world as the server has it: whether it's still ticking, and the snapshot phones start from.
// The pushes a test player would have got, oldest first (see notify).
export const pushesOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    assertTestDeployment();
    return (await ctx.db.query("testPushes").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).map(({ title, body, url, tag, badge }) => ({ title, body, url, tag, badge }));
  },
});

export const golfWorld = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    assertTestDeployment();
    const w = await ctx.db.query("golfWorlds").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!w) return null;
    const snap = await ctx.db.query("golfSnapshots").withIndex("by_world", (q) => q.eq("worldId", w._id)).unique();
    return { awake: w.awake, snapshotTick: snap?.tick ?? null };
  },
});

export const rtCommands = internalQuery({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    assertTestDeployment();
    return await ctx.db.query("rtCommands").withIndex("by_match_tick", (q) => q.eq("matchId", id)).collect();
  },
});

export const allMatches = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertTestDeployment();
    return await ctx.db.query("matches").collect();
  },
});

// The mode's settings a test game is played with (only what differs from the defaults, like a lobby's).
const settingsArg = v.optional(v.record(v.string(), v.number()));

// Seats two players straight into an active game, the same way a joined lobby would.
export const startMatch = internalAction({
  args: { mode: v.string(), a: v.id("users"), b: v.id("users"), settings: settingsArg },
  handler: async (ctx, args): Promise<string> => ctx.runMutation(internal.testing.insertActive, args),
});
export const insertActive = internalMutation({
  args: { mode: v.string(), a: v.id("users"), b: v.id("users"), settings: settingsArg },
  handler: async (ctx, { mode, a, b, settings }) => {
    if (mode !== "chess:classic" && mode !== "chess:realtime") throw new Error(`startMatch builds two-player chess only, not ${mode}: open a lobby for other games.`);
    assertTestDeployment();
    const now = Date.now();
    const state = mode === "chess:realtime" ? { kind: "realtime", ready: [], startAt: null } : { kind: "classic", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", moves: [] };
    return await ctx.db.insert("matches", {
      mode, status: "active", createdBy: a, players: [{ userId: a, color: "w" }, { userId: b, color: "b" }], invited: [], state, ...(settings ? { settings } : {}),
      turn: mode === "chess:classic" ? a : undefined, moveCount: 0, startedAt: now, lastActivityAt: now,
    });
  },
});

// A four-player game already under way, seats in color order (red, blue, yellow, green).
export const startFour = internalAction({
  args: { mode: v.string(), players: v.array(v.id("users")), settings: settingsArg },
  handler: async (ctx, args): Promise<string> => ctx.runMutation(internal.testing.insertFour, args),
});
export const insertFour = internalMutation({
  args: { mode: v.string(), players: v.array(v.id("users")), settings: settingsArg },
  handler: async (ctx, { mode, players, settings }) => {
    if (mode !== "chess:four" && mode !== "chess:realtime4") throw new Error(`startFour builds four-player chess only, not ${mode}: open a lobby for other games.`);
    assertTestDeployment();
    const now = Date.now();
    const colors = ["red", "blue", "yellow", "green"];
    const state = mode === "chess:realtime4" ? { kind: "realtime", ready: [], startAt: null } : initialFour();
    return await ctx.db.insert("matches", {
      mode, status: "active", createdBy: players[0], players: players.map((userId, i) => ({ userId, color: colors[i] })), invited: [], state, ...(settings ? { settings } : {}),
      turn: mode === "chess:four" ? players[0] : undefined, moveCount: 0, startedAt: now, lastActivityAt: now,
    });
  },
});

// Sets a player's Scrabble rack, so tests know what they can spell.
export const setRack = internalMutation({
  args: { id: v.id("matches"), userId: v.id("users"), letters: v.string() },
  handler: async (ctx, { id, userId, letters }) => {
    assertTestDeployment();
    const rack = [...letters].map((letter, i) => ({ id: 1000 + i + Math.floor(Math.random() * 1e6) * 100, letter }));
    const row = await ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", userId)).unique();
    if (row) await ctx.db.patch(row._id, { data: { rack } });
    else await ctx.db.insert("secrets", { matchId: id, userId, data: { rack } });
    return rack;
  },
});

export const rackOf = internalQuery({
  args: { id: v.id("matches"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    assertTestDeployment();
    const row = await ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", userId)).unique();
    return row?.data.rack ?? [];
  },
});

// Plays a word for a player, for screenshots that need a board with something on it.
export const playAs = internalMutation({
  args: { id: v.id("matches"), userId: v.id("users"), tiles: v.array(v.object({ id: v.number(), x: v.number(), y: v.number(), letter: v.optional(v.string()) })) },
  handler: async (ctx, { id, userId, tiles }) => {
    assertTestDeployment();
    return await playTiles(ctx, id, tiles, userId);
  },
});

// Every table in the schema, so a new one is never left holding the last test's rows.
const TABLES = Object.keys(schema.tables) as TableNames[];
// Rows deleted per call. A big table (stockSymbols, seeded with thousands of listings) takes a few calls,
// so one transaction never runs into Convex's write limits; call it until it says it's done.
const BUDGET = 4000;

// Wipes everything. Refuses if any real (non-test) player exists, so it can't touch prod data.
export const reset = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ done: boolean }> => {
    assertTestDeployment();
    const users = await ctx.db.query("users").collect();
    if (users.some((u) => !u.isTest)) throw new Error("Refusing to reset: real players exist. Use removeTestData.");
    // Whatever the last test left scheduled (real-time and golf ticks, turn timers, reminders, pushes)
    // would otherwise run against the next test's data.
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    for (const f of await ctx.db.query("hostedFiles").collect()) await ctx.storage.delete(f.storageId);
    let left = BUDGET;
    for (const table of TABLES) {
      const docs = await ctx.db.query(table).take(left);
      for (const doc of docs) await ctx.db.delete(doc._id);
      left -= docs.length;
      if (left <= 0) return { done: false };
    }
    return { done: true };
  },
});

// Removes test players and everything that involves them, leaving real players' data alone.
export const removeTestData = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertTestDeployment();
    const testIds = new Set((await ctx.db.query("users").collect()).filter((u) => u.isTest).map((u) => u._id as string));
    let removed = 0;
    for (const m of await ctx.db.query("matches").collect()) {
      if (!m.players.some((p) => testIds.has(p.userId)) && !testIds.has(m.createdBy)) continue;
      for (const c of await ctx.db.query("rtCommands").withIndex("by_match_tick", (q) => q.eq("matchId", m._id)).collect()) await ctx.db.delete(c._id);
      for (const s of await ctx.db.query("rtSnapshots").withIndex("by_match", (q) => q.eq("matchId", m._id)).collect()) await ctx.db.delete(s._id);
      for (const s of await ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", m._id)).collect()) await ctx.db.delete(s._id);
      for (const d of await ctx.db.query("drafts").withIndex("by_match_user", (q) => q.eq("matchId", m._id)).collect()) await ctx.db.delete(d._id);
      await ctx.db.delete(m._id);
      removed++;
    }
    // Golf's open world: their balls and everything they did. The snapshot goes too, so the world is
    // worked out again from the real players' commands alone.
    let golf = false;
    for (const table of ["golfCommands", "golfPlayers"] as const)
      for (const doc of await ctx.db.query(table).collect())
        if (testIds.has("by" in doc ? doc.by : doc.userId)) {
          await ctx.db.delete(doc._id);
          golf = true;
        }
    if (golf) for (const s of await ctx.db.query("golfSnapshots").collect()) await ctx.db.delete(s._id);
    for (const table of ["golfScores", "golfBags"] as const) for (const r of await ctx.db.query(table).collect()) if (testIds.has(r.userId)) await ctx.db.delete(r._id);
    for (const table of ["ratings", "presence", "taps", "profiles", "pushSubscriptions", "handoffs", "stockAccounts", "stockPositions", "stockOrders"] as const) {
      for (const doc of await ctx.db.query(table).collect()) if (testIds.has(doc.userId)) await ctx.db.delete(doc._id);
    }
    for (const row of await ctx.db.query("stockWorth").collect()) {
      const worths = row.worths.filter((x) => !testIds.has(x.u));
      if (worths.length !== row.worths.length) await ctx.db.patch(row._id, { worths });
    }
    for (const s of await ctx.db.query("authSessions").collect()) {
      if (!testIds.has(s.userId)) continue;
      for (const r of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect()) await ctx.db.delete(r._id);
      await ctx.db.delete(s._id);
    }
    for (const id of testIds) await ctx.db.delete(id as Id<"users">);
    return { players: testIds.size, matches: removed };
  },
});
