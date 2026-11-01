import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { courseOf, worldOf } from "./golf/holes";
import { SANDBOX } from "./golf/sandbox";
import { advance, cmdOrder, newWorld, pack, quiet, TPS, unpack, type Cmd, type Packed } from "./golf/world";
import { ONLINE_WINDOW_MS } from "./presenceConfig";

// Golf, played live: the open world, and each of the holes (convex/golf/holes.ts), every one its own
// world with whoever's on it right now.
//
// The same netcode as real-time chess: whatever a player does is one insert into golfCommands, stamped
// with the tick they did it on (up to MAX_LAG back, for lag). It never touches anything another player
// writes, so players acting at once never conflict. The server doesn't simulate on a move: every phone
// runs the world from the settled snapshot plus the commands (convex/golf/world.ts, the same physics,
// bit for bit, on every engine), so the only traffic is the commands. golf:tick settles the snapshot
// once a second while anything's happening, and goes to sleep when every ball is still; the next
// command wakes it.

export const KEY = SANDBOX.id;
export const MAX_LAG = TPS / 2; // half a second
const SLACK = TPS / 20; // how far ahead of the server a phone's clock may be
const TICK_MS = 1000;
// The snapshot is only rewritten this often (or when the world goes quiet), since every write is sent
// to every phone.
const SNAPSHOT_EVERY = 4 * TPS;
// The settled part: nothing can be stamped this far back any more.
const settledAt = (serverTick: number) => serverTick - MAX_LAG - 2;

export const tickAt = (world: Doc<"golfWorlds">, now: number) => Math.floor(((now - world.startAt) * TPS) / 1000);

async function worldByKey(ctx: QueryCtx, key: string) {
  return ctx.db
    .query("golfWorlds")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

async function snapshotOf(ctx: QueryCtx, worldId: Id<"golfWorlds">) {
  return ctx.db
    .query("golfSnapshots")
    .withIndex("by_world", (q) => q.eq("worldId", worldId))
    .unique();
}

async function commandsFrom(ctx: QueryCtx, worldId: Id<"golfWorlds">, from: number, before?: number): Promise<Cmd[]> {
  const rows = await ctx.db
    .query("golfCommands")
    .withIndex("by_world_tick", (q) => (before === undefined ? q.eq("worldId", worldId).gte("tick", from) : q.eq("worldId", worldId).gte("tick", from).lt("tick", before)))
    .collect();
  return rows.map(toCmd).sort(cmdOrder);
}
const toCmd = (r: Doc<"golfCommands">): Cmd => ({ tick: r.tick, by: r.by, seq: r.seq, kind: r.kind, a: r.a, p: r.p, i: r.i, x: r.x, y: r.y });

async function wake(ctx: MutationCtx, world: Doc<"golfWorlds">) {
  if (world.awake) return;
  await ctx.db.patch(world._id, { awake: true });
  await ctx.scheduler.runAfter(TICK_MS, internal.golf.tick, { worldId: world._id });
}

// The world, its settled snapshot and everyone who's played in it. Changes only when the snapshot
// does (every few seconds while it's busy) or someone new turns up.
export const world = query({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key = KEY }) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const w = await worldByKey(ctx, key);
    if (!w) return null;
    const snap = await snapshotOf(ctx, w._id);
    const rows = await ctx.db
      .query("golfPlayers")
      .withIndex("by_world", (q) => q.eq("worldId", w._id))
      .collect();
    const players = await Promise.all(
      rows.map(async (r) => {
        const u = await ctx.db.get(r.userId);
        return { id: r.userId, name: u?.name ?? "Someone", image: u?.image ?? null };
      }),
    );
    return { worldId: w._id, startAt: w.startAt, collide: w.collide, course: w.key, snapshot: (snap?.state as Packed | undefined) ?? null, players };
  },
});

// Every command from the snapshot on. Phones subscribe with the snapshot's tick.
export const commands = query({
  args: { worldId: v.id("golfWorlds"), from: v.number() },
  handler: async (ctx, { worldId, from }) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    return commandsFrom(ctx, worldId, from);
  },
});

// Into a world: a ball on a free tee. Makes the world the first time anyone plays it. Coming back to a
// ball you're still on (the app reloaded) changes nothing: joining with a ball is ignored.
export const join = mutation({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key = KEY }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const course = courseOf(key);
    if (!course) throw new Error("There's no such hole.");
    const now = Date.now();
    let w = await worldByKey(ctx, key);
    if (!w) {
      const id = await ctx.db.insert("golfWorlds", { key, startAt: now, awake: false, collide: true });
      w = (await ctx.db.get(id))!;
    }
    // On a hole, balls whose players have wandered off without leaving (the phone was locked, the app
    // killed) are cleared away when someone turns up, so nobody tees off round old balls.
    if (!course.open) await sweep(ctx, w, userId, now);
    const players = await ctx.db
      .query("golfPlayers")
      .withIndex("by_world", (q) => q.eq("worldId", w._id))
      .collect();
    const known = players.some((p) => p.userId === userId);
    if (!known) await ctx.db.insert("golfPlayers", { worldId: w._id, userId, joinedAt: now });
    // The open world keeps your ball for good, so one join is all it ever needs. A hole's ball goes when
    // you leave, so every visit joins.
    if (!known || !course.open) {
      await ctx.db.insert("golfCommands", { worldId: w._id, tick: tickAt(w, now), by: userId, seq: now % 1_000_000_000, kind: "join" });
      await wake(ctx, w);
    }
    return w._id;
  },
});

// Off a hole: your ball goes with you.
export const leave = mutation({
  args: { worldId: v.id("golfWorlds") },
  handler: async (ctx, { worldId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const w = await ctx.db.get(worldId);
    if (!w || courseOf(w.key)?.open) return;
    const now = Date.now();
    await ctx.db.insert("golfCommands", { worldId, tick: tickAt(w, now), by: userId, seq: now % 1_000_000_000, kind: "leave" });
    await wake(ctx, w);
  },
});

// How long someone's ball stays on a hole after their last command, however absent they look.
const SWEEP_AFTER_TICKS = 30 * TPS;
async function sweep(ctx: MutationCtx, w: Doc<"golfWorlds">, me: Id<"users">, now: number) {
  const snap = await snapshotOf(ctx, w._id);
  const ids = ((snap?.state as Packed | undefined)?.balls ?? []).map((b) => b.id).filter((id) => id !== me);
  if (ids.length === 0) return;
  const tick = tickAt(w, now);
  const recent = await commandsFrom(ctx, w._id, tick - SWEEP_AFTER_TICKS);
  for (const id of ids) {
    if (recent.some((c) => c.by === id)) continue;
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", id as Id<"users">))
      .unique();
    const here = presence && now - presence.lastSeen < ONLINE_WINDOW_MS && presence.path.endsWith(`/${w.key.replace("-", "/")}`);
    if (here) continue;
    await ctx.db.insert("golfCommands", { worldId: w._id, tick, by: id as Id<"users">, seq: now % 1_000_000_000, kind: "leave" });
  }
}

// Everyone's scores on every hole. Changes when someone sinks one.
export const scores = query({
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    const rows = await ctx.db.query("golfScores").collect();
    const names = new Map<string, { name: string; image: string | null }>();
    for (const r of rows)
      if (!names.has(r.userId)) {
        const u = await ctx.db.get(r.userId);
        names.set(r.userId, { name: u?.name ?? "Someone", image: u?.image ?? null });
      }
    return rows.map((r) => ({ hole: r.hole, userId: r.userId, best: r.best, last: r.last, plays: r.plays, ...names.get(r.userId)! }));
  },
});

async function recordScore(ctx: MutationCtx, hole: string, userId: Id<"users">, strokes: number, at: number) {
  const row = await ctx.db
    .query("golfScores")
    .withIndex("by_hole_user", (q) => q.eq("hole", hole).eq("userId", userId))
    .unique();
  if (row) await ctx.db.patch(row._id, { best: Math.min(row.best, strokes), last: strokes, plays: row.plays + 1, at });
  else await ctx.db.insert("golfScores", { hole, userId, best: strokes, last: strokes, plays: 1, at });
}

// A shot, an item, a hop, a brake, or back to a tee. `clientTick` is the tick the player saw.
export const act = mutation({
  args: {
    worldId: v.id("golfWorlds"),
    kind: v.union(v.literal("shot"), v.literal("use"), v.literal("fire"), v.literal("hop"), v.literal("brake"), v.literal("reset")),
    clientTick: v.number(),
    seq: v.number(),
    a: v.optional(v.number()),
    p: v.optional(v.number()),
    i: v.optional(v.number()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
  },
  handler: async (ctx, { worldId, kind, clientTick, seq, a, p, i, x, y }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const w = await ctx.db.get(worldId);
    if (!w) throw new Error("That world's gone.");
    for (const n of [clientTick, seq, a, p, i, x, y]) if (n !== undefined && !Number.isFinite(n)) throw new Error("That's not a number.");
    const serverTick = tickAt(w, Date.now());
    // Honour the tick the player saw, within reason.
    const tick = Math.min(serverTick + SLACK, Math.max(serverTick - MAX_LAG, Math.floor(clientTick)));
    await ctx.db.insert("golfCommands", {
      worldId,
      tick,
      by: userId,
      seq: Math.floor(seq),
      kind,
      a,
      p: p === undefined ? undefined : Math.max(0, Math.min(1, p)),
      i: i === undefined ? undefined : Math.floor(i),
      x,
      y,
    });
    await wake(ctx, w);
    return tick;
  },
});

// Settles the world up to where nothing can change it any more, and sleeps once everything's still.
export const tick = internalMutation({
  args: { worldId: v.id("golfWorlds") },
  handler: async (ctx, { worldId }) => {
    const w = await ctx.db.get(worldId);
    if (!w || !w.awake) return;
    const settled = settledAt(tickAt(w, Date.now()));
    const course = courseOf(w.key);
    if (!course) return;
    const snap = await snapshotOf(ctx, worldId);
    const state = snap ? unpack(snap.state as Packed) : newWorld(course, { collide: w.collide });
    const from = state.tick;
    // Only the settled range: new commands land after it, so this never conflicts with them.
    if (settled > from) advance(state, worldOf(course), settled, await commandsFrom(ctx, worldId, from, settled));
    // Still, and nobody's done anything since: nothing left to settle. (Reading past the settled
    // range can conflict with a command landing right now; Convex just runs one of them again.) A world
    // that isn't quiet stays awake, so its snapshot never falls far behind for phones to step through.
    const still =
      quiet(state, course) &&
      !(await ctx.db
        .query("golfCommands")
        .withIndex("by_world_tick", (q) => q.eq("worldId", worldId).gte("tick", settled))
        .first());
    if (still || state.tick - (snap?.tick ?? -Infinity) >= SNAPSHOT_EVERY) {
      if (snap) await ctx.db.patch(snap._id, { tick: state.tick, state: pack(state) });
      else await ctx.db.insert("golfSnapshots", { worldId, tick: state.tick, state: pack(state) });
      // Each run goes from the last snapshot written, so the sinks in a run that writes one are the
      // ones not counted yet: each is seen here exactly once.
      if (!course.open)
        for (const e of state.events)
          if (e.ev.type === "sink" && e.strokes !== undefined) await recordScore(ctx, w.key, e.id as Id<"users">, e.strokes, Date.now());
    }
    if (still) await ctx.db.patch(worldId, { awake: false });
    else await ctx.scheduler.runAfter(TICK_MS, internal.golf.tick, { worldId });
  },
});
