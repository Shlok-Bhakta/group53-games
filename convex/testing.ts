import { v } from "convex/values";
import { DEFAULT_POSITION } from "chess.js";
import { COLORS4 } from "./chess/four/board";
import { initialFour } from "./chess/four/classic";
import { playTiles } from "./scrabble";
import { play as landlordPlay } from "./landlord";
import { load as hexhavenLoad, play as hexhavenPlay } from "./hexhaven";
import { botMove as hexhavenBot, nextBotSeat as hexhavenNext } from "./hexhaven/bot";
import type { HexState } from "./hexhaven/engine";
import { addPlayer } from "./matches";
import { postResult } from "./daily";
import { botMove, nextBotSeat } from "./landlord/bot";
import type { MonoState } from "./landlord/engine";
import { SignJWT, importPKCS8 } from "jose";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
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
    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const seedPush = internalMutation({
  args: { userId: v.id("users"), endpoint: v.string() },
  handler: async (ctx, { userId, endpoint }) => {
    assertTestDeployment();
    await ctx.db.insert("pushSubscriptions", { userId, endpoint, p256dh: "AQID", auth: "AQID" });
  },
});

export const pushesOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    assertTestDeployment();
    return (
      await ctx.db
        .query("testPushes")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).map(({ title, body, url, tag, badge }) => ({ title, body, url, tag, badge }));
  },
});

export const golfWorld = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    assertTestDeployment();
    const w = await ctx.db
      .query("golfWorlds")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!w) return null;
    const snap = await ctx.db
      .query("golfSnapshots")
      .withIndex("by_world", (q) => q.eq("worldId", w._id))
      .unique();
    return { awake: w.awake, snapshotTick: snap?.tick ?? null };
  },
});

export const rtCommands = internalQuery({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    assertTestDeployment();
    return await ctx.db
      .query("rtCommands")
      .withIndex("by_match_tick", (q) => q.eq("matchId", id))
      .collect();
  },
});

export const allMatches = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertTestDeployment();
    return await ctx.db.query("matches").collect();
  },
});

const changedSettingsArg = v.optional(v.record(v.string(), v.number()));

export const startMatch = internalAction({
  args: { mode: v.string(), a: v.id("users"), b: v.id("users"), settings: changedSettingsArg },
  handler: async (ctx, args): Promise<string> => ctx.runMutation(internal.testing.insertActive, args),
});
export const insertActive = internalMutation({
  args: { mode: v.string(), a: v.id("users"), b: v.id("users"), settings: changedSettingsArg },
  handler: async (ctx, { mode, a, b, settings }) => {
    if (mode !== "chess:classic" && mode !== "chess:realtime")
      throw new Error(`startMatch builds two-player chess only, not ${mode}: open a lobby for other games.`);
    assertTestDeployment();
    const now = Date.now();
    const state =
      mode === "chess:realtime" ? { kind: "realtime", ready: [], startAt: null } : { kind: "classic", fen: DEFAULT_POSITION, moves: [] };
    return await ctx.db.insert("matches", {
      mode,
      status: "active",
      createdBy: a,
      players: [
        { userId: a, color: "w" },
        { userId: b, color: "b" },
      ],
      invited: [],
      state,
      ...(settings ? { settings } : {}),
      turn: mode === "chess:classic" ? a : undefined,
      moveCount: 0,
      startedAt: now,
      lastActivityAt: now,
    });
  },
});

export const startFour = internalAction({
  args: { mode: v.string(), players: v.array(v.id("users")), settings: changedSettingsArg },
  handler: async (ctx, args): Promise<string> => ctx.runMutation(internal.testing.insertFour, args),
});
export const insertFour = internalMutation({
  args: { mode: v.string(), players: v.array(v.id("users")), settings: changedSettingsArg },
  handler: async (ctx, { mode, players, settings }) => {
    if (mode !== "chess:four" && mode !== "chess:realtime4")
      throw new Error(`startFour builds four-player chess only, not ${mode}: open a lobby for other games.`);
    assertTestDeployment();
    const now = Date.now();
    const state = mode === "chess:realtime4" ? { kind: "realtime", ready: [], startAt: null } : initialFour();
    return await ctx.db.insert("matches", {
      mode,
      status: "active",
      createdBy: players[0],
      players: players.map((userId, i) => ({ userId, color: COLORS4[i] })),
      invited: [],
      state,
      ...(settings ? { settings } : {}),
      turn: mode === "chess:four" ? players[0] : undefined,
      moveCount: 0,
      startedAt: now,
      lastActivityAt: now,
    });
  },
});

export const setRack = internalMutation({
  args: { id: v.id("matches"), userId: v.id("users"), letters: v.string() },
  handler: async (ctx, { id, userId, letters }) => {
    assertTestDeployment();
    const rack = [...letters].map((letter, i) => ({ id: 1000 + i + Math.floor(Math.random() * 1e6) * 100, letter }));
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { data: { rack } });
    else await ctx.db.insert("secrets", { matchId: id, userId, data: { rack } });
    return rack;
  },
});

export const rackOf = internalQuery({
  args: { id: v.id("matches"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    assertTestDeployment();
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", userId))
      .unique();
    return row?.data.rack ?? [];
  },
});

export const playAs = internalMutation({
  args: {
    id: v.id("matches"),
    userId: v.id("users"),
    tiles: v.array(v.object({ id: v.number(), x: v.number(), y: v.number(), letter: v.optional(v.string()) })),
  },
  handler: async (ctx, { id, userId, tiles }) => {
    assertTestDeployment();
    return await playTiles(ctx, id, tiles, userId);
  },
});

export const joinAs = internalMutation({
  args: { id: v.id("matches"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    assertTestDeployment();
    const match = (await ctx.db.get(id))!;
    if (match.status === "waiting" && !match.players.some((p) => p.userId === userId)) await addPlayer(ctx, match, userId);
  },
});

export const dailyAs = internalMutation({
  args: { userId: v.id("users"), text: v.string(), day: v.string() },
  handler: async (ctx, { userId, text, day }) => {
    assertTestDeployment();
    return await postResult(ctx, userId, text, day);
  },
});

export const landlordBots = internalMutation({
  args: { id: v.id("matches"), human: v.optional(v.id("users")), steps: v.optional(v.number()) },
  handler: async (ctx, { id, human, steps = 200 }) => {
    assertTestDeployment();
    let made = 0;
    for (; made < steps; made++) {
      const m = (await ctx.db.get(id))!;
      if (m.status !== "active") break;
      const s = m.state as MonoState;
      const seat = nextBotSeat(s, (i) => m.players[i].userId === human);
      if (seat === null) break;
      const a = botMove(s, seat, Math.random);
      if (!a) break;
      await landlordPlay(ctx, id, a, m.players[seat].userId);
    }
    return made;
  },
});

export const landlordPatch = internalMutation({
  args: { id: v.id("matches"), state: v.any() },
  handler: async (ctx, { id, state }) => {
    assertTestDeployment();
    const m = (await ctx.db.get(id))!;
    await ctx.db.patch(id, { state: { ...(m.state as MonoState), ...state } });
  },
});

export const hexhavenBots = internalMutation({
  args: { id: v.id("matches"), human: v.optional(v.id("users")), steps: v.optional(v.number()) },
  handler: async (ctx, { id, human, steps = 400 }) => {
    assertTestDeployment();
    let made = 0;
    for (; made < steps; made++) {
      const m = (await ctx.db.get(id))!;
      if (m.status !== "active") break;
      const g = await hexhavenLoad(ctx, m);
      const seat = hexhavenNext(g.s, (i) => m.players[i].userId === human);
      if (seat === null) break;
      const a = hexhavenBot(g, seat, Math.random);
      if (!a) break;
      await hexhavenPlay(ctx, id, a, m.players[seat].userId);
    }
    return made;
  },
});

export const hexhavenPatch = internalMutation({
  args: { id: v.id("matches"), state: v.any() },
  handler: async (ctx, { id, state }) => {
    assertTestDeployment();
    const m = (await ctx.db.get(id))!;
    await ctx.db.patch(id, { state: { ...(m.state as HexState), ...state } });
  },
});

const EVERY_TABLE = Object.keys(schema.tables) as TableNames[];
// platform: Convex caps the writes in one transaction, so reset deletes at most this many rows and is called until it returns done.
const ROWS_DELETED_PER_CALL = 4000;

async function cancelEverythingScheduled(ctx: MutationCtx) {
  for (const job of await ctx.db.system.query("_scheduled_functions").collect())
    if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
}

async function replayGolfWorldsFromCommands(ctx: MutationCtx) {
  for (const s of await ctx.db.query("golfSnapshots").collect()) await ctx.db.delete(s._id);
}

export const reset = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ done: boolean }> => {
    assertTestDeployment();
    const users = await ctx.db.query("users").collect();
    if (users.some((u) => !u.isTest)) throw new Error("Refusing to reset: real players exist. Use removeTestData.");
    await cancelEverythingScheduled(ctx);
    for (const f of await ctx.db.query("hostedFiles").collect()) await ctx.storage.delete(f.storageId);
    let left = ROWS_DELETED_PER_CALL;
    for (const table of EVERY_TABLE) {
      const docs = await ctx.db.query(table).take(left);
      for (const doc of docs) await ctx.db.delete(doc._id);
      left -= docs.length;
      if (left <= 0) return { done: false };
    }
    return { done: true };
  },
});

export const removeTestData = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertTestDeployment();
    const testIds = new Set((await ctx.db.query("users").collect()).filter((u) => u.isTest).map((u) => u._id as string));
    let removed = 0;
    for (const m of await ctx.db.query("matches").collect()) {
      if (!m.players.some((p) => testIds.has(p.userId)) && !testIds.has(m.createdBy)) continue;
      for (const c of await ctx.db
        .query("rtCommands")
        .withIndex("by_match_tick", (q) => q.eq("matchId", m._id))
        .collect())
        await ctx.db.delete(c._id);
      for (const s of await ctx.db
        .query("rtSnapshots")
        .withIndex("by_match", (q) => q.eq("matchId", m._id))
        .collect())
        await ctx.db.delete(s._id);
      for (const s of await ctx.db
        .query("secrets")
        .withIndex("by_match_user", (q) => q.eq("matchId", m._id))
        .collect())
        await ctx.db.delete(s._id);
      for (const d of await ctx.db
        .query("drafts")
        .withIndex("by_match_user", (q) => q.eq("matchId", m._id))
        .collect())
        await ctx.db.delete(d._id);
      await ctx.db.delete(m._id);
      removed++;
    }
    let touchedGolfWorlds = false;
    for (const table of ["golfCommands", "golfPlayers"] as const)
      for (const doc of await ctx.db.query(table).collect())
        if (testIds.has("by" in doc ? doc.by : doc.userId)) {
          await ctx.db.delete(doc._id);
          touchedGolfWorlds = true;
        }
    if (touchedGolfWorlds) await replayGolfWorldsFromCommands(ctx);
    for (const table of ["golfScores", "golfBags"] as const)
      for (const r of await ctx.db.query(table).collect()) if (testIds.has(r.userId)) await ctx.db.delete(r._id);
    for (const table of [
      "ratings",
      "presence",
      "taps",
      "profiles",
      "pushSubscriptions",
      "handoffs",
      "stockAccounts",
      "stockPositions",
      "stockOrders",
      "dailyResults",
    ] as const) {
      for (const doc of await ctx.db.query(table).collect()) if (testIds.has(doc.userId)) await ctx.db.delete(doc._id);
    }
    for (const row of await ctx.db.query("stockWorth").collect()) {
      const worths = row.worths.filter((x) => !testIds.has(x.u));
      if (worths.length !== row.worths.length) await ctx.db.patch(row._id, { worths });
    }
    for (const s of await ctx.db.query("authSessions").collect()) {
      if (!testIds.has(s.userId)) continue;
      for (const r of await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect())
        await ctx.db.delete(r._id);
      await ctx.db.delete(s._id);
    }
    for (const id of testIds) await ctx.db.delete(id as Id<"users">);
    return { players: testIds.size, matches: removed };
  },
});
