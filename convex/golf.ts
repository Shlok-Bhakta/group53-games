import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { compile } from "./golf/engine";
import { SANDBOX } from "./golf/sandbox";
import { advance, cmdOrder, newWorld, pack, TPS, unpack, type Cmd, type Packed } from "./golf/world";

// Golf's open world, played live by everyone at once (the sandbox, for now).
//
// The same netcode as real-time chess: whatever a player does is one insert into golfCommands, stamped
// with the tick they did it on (up to MAX_LAG back, for lag). It never touches anything another player
// writes, so players acting at once never conflict. The server doesn't simulate on a move: every phone
// runs the world from the settled snapshot plus the commands (convex/golf/world.ts, the same physics,
// bit for bit, on every engine), so the only traffic is the commands. golf:tick settles the snapshot
// once a second while anything's happening, and goes to sleep when every ball is still; the next
// command wakes it.

export const KEY = "sandbox";
export const MAX_LAG = TPS / 2; // half a second
const SLACK = TPS / 20; // how far ahead of the server a phone's clock may be
const TICK_MS = 1000;
// The snapshot is only rewritten this often (or when the world goes quiet), since every write is sent
// to every phone.
const SNAPSHOT_EVERY = 4 * TPS;
// The settled part: nothing can be stamped this far back any more.
const settledAt = (serverTick: number) => serverTick - MAX_LAG - 2;

const COURSE = SANDBOX;
const WORLD = compile(COURSE);

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
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const w = await worldByKey(ctx, KEY);
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
    return { worldId: w._id, startAt: w.startAt, collide: w.collide, course: COURSE.id, snapshot: (snap?.state as Packed | undefined) ?? null, players };
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

// Into the world: a ball on a free tee. Makes the world the first time anyone plays.
export const join = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const now = Date.now();
    let w = await worldByKey(ctx, KEY);
    if (!w) {
      const id = await ctx.db.insert("golfWorlds", { key: KEY, startAt: now, awake: false, collide: true });
      w = (await ctx.db.get(id))!;
    }
    const players = await ctx.db
      .query("golfPlayers")
      .withIndex("by_world", (q) => q.eq("worldId", w._id))
      .collect();
    if (!players.some((p) => p.userId === userId)) {
      await ctx.db.insert("golfPlayers", { worldId: w._id, userId, joinedAt: now });
      await ctx.db.insert("golfCommands", { worldId: w._id, tick: tickAt(w, now), by: userId, seq: 0, kind: "join" });
      await wake(ctx, w);
    }
    return w._id;
  },
});

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
    const snap = await snapshotOf(ctx, worldId);
    const state = snap ? unpack(snap.state as Packed) : newWorld(COURSE, { collide: w.collide });
    const from = state.tick;
    // Only the settled range: new commands land after it, so this never conflicts with them.
    if (settled > from) advance(state, WORLD, settled, await commandsFrom(ctx, worldId, from, settled));
    state.events.length = 0;
    // Still, and nobody's done anything since: nothing left to settle. (Reading past the settled
    // range can conflict with a command landing right now; Convex just runs one of them again.)
    const still =
      state.balls.every((b) => b.mode === "aim") &&
      state.strikes.length === 0 &&
      !(await ctx.db
        .query("golfCommands")
        .withIndex("by_world_tick", (q) => q.eq("worldId", worldId).gte("tick", settled))
        .first());
    if (still || state.tick - (snap?.tick ?? -Infinity) >= SNAPSHOT_EVERY) {
      if (snap) await ctx.db.patch(snap._id, { tick: state.tick, state: pack(state) });
      else await ctx.db.insert("golfSnapshots", { worldId, tick: state.tick, state: pack(state) });
    }
    if (still) await ctx.db.patch(worldId, { awake: false });
    else await ctx.scheduler.runAfter(TICK_MS, internal.golf.tick, { worldId });
  },
});
