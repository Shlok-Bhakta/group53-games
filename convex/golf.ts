import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser, seatOf, SEAT_COLORS } from "./lib/seats";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { courseOf, holeOf, worldOf } from "./golf/holes";
import { SANDBOX } from "./golf/sandbox";
import type { Course, Power } from "./golf/engine";
import { advance, applyCmd, carryOf, cmdOrder, newWorld, pack, quiet, TPS, unpack, type Cmd, type Packed, type Rules, type WorldState } from "./golf/world";
import { buildHole, genKey, genOpts, holeCount, holeKey } from "./golf/build";
import { generateHole } from "./golf/gen";
import { bestShot } from "./golf/bot";
import { distanceField } from "./golf/distance";
import { activeSeats, capOf, honors, IDLE_OUT, MARK_R, newRound, nextUp, standings, type GolfState } from "./golf/round";
import { ONLINE_WINDOW_MS } from "./presenceConfig";
import { isMode, settingsOf, type ModeKey } from "./modes";
import type { GameHooks } from "./games";
import { finish, finishBySeats } from "./matches";
import { notifyMatch } from "./notify";
import { displayName } from "./lib/people";
import { passTurn, startPushes } from "./lib/turns";

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
// How late a command can land and still count from when it was taken. Generous, for phones on bad
// connections: past this, the shot's moved later and the ball on their screen has to be corrected.
export const MAX_LAG = TPS * 2;
export const SLACK = TPS / 4; // how far ahead of the server a phone's clock may be
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
const toCmd = (r: Doc<"golfCommands">): Cmd => ({ tick: r.tick, by: r.by, seq: r.seq, kind: r.kind, a: r.a, p: r.p, i: r.i, x: r.x, y: r.y, ...(r.bag ? { bag: r.bag as Power[] } : {}) });

// A game's worlds tick twice as often, so the next player's turn comes round soon after the last ball stops.
const tickMs = (w: Doc<"golfWorlds">) => (w.matchId ? TICK_MS / 2 : TICK_MS);

async function wake(ctx: MutationCtx, world: Doc<"golfWorlds">) {
  if (world.awake) return;
  await ctx.db.patch(world._id, { awake: true });
  await ctx.scheduler.runAfter(tickMs(world), internal.golf.tick, { worldId: world._id });
}

// What a world's played on: a game's hole from its table, or one of the holes and the open world in code.
async function courseFor(ctx: QueryCtx, w: Doc<"golfWorlds">): Promise<Course | null> {
  if (!w.matchId) return courseOf(w.key);
  const row = await ctx.db
    .query("golfCourses")
    .withIndex("by_match", (q) => q.eq("matchId", w.matchId!).eq("n", w.hole ?? 0))
    .unique();
  return (row?.course as Course | undefined) ?? null;
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
    return { worldId: w._id, startAt: w.startAt, collide: w.collide, course: w.key, matchId: w.matchId ?? null, hole: w.hole ?? null, snapshot: (snap?.state as Packed | undefined) ?? null, players };
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

// A game's hole from the start: how it began and every command since, so a phone coming back can play
// what it missed. Null for a hole from before starts were kept.
export const history = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const w = await worldByKey(ctx, key);
    const start = w && (await ctx.db.query("golfStarts").withIndex("by_world", (q) => q.eq("worldId", w._id)).unique());
    if (!w || !start) return null;
    return { start: start.state as Packed, cmds: await commandsFrom(ctx, w._id, 0) };
  },
});

// Into a world: a ball on a free tee. Makes the world the first time anyone plays it. Coming back to a
// ball you're still on (the app reloaded) changes nothing: joining with a ball is ignored.
export const join = mutation({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, { key = KEY }) => {
    const userId = await requireUser(ctx);
    let w = await worldByKey(ctx, key);
    // A game's hole: everyone's ball was put on the tee when it started, and stays there.
    if (w?.matchId) return w._id;
    const course = courseOf(key);
    if (!course) throw new Error("There's no such hole.");
    const now = Date.now();
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
      const bag = course.open ? undefined : await bagForHole(ctx, key, userId);
      await ctx.db.insert("golfCommands", { worldId: w._id, tick: tickAt(w, now), by: userId, seq: now % 1_000_000_000, kind: "join", ...(bag?.length ? { bag } : {}) });
      await wake(ctx, w);
    }
    return w._id;
  },
});

async function bagRow(ctx: QueryCtx, course: string, userId: Id<"users">) {
  return ctx.db
    .query("golfBags")
    .withIndex("by_course_user", (q) => q.eq("course", course).eq("userId", userId))
    .unique();
}

// What a player brings onto a hole: what they finished the last one holding. The first hole of a
// course starts a new run, empty-handed.
async function bagForHole(ctx: MutationCtx, key: string, userId: Id<"users">) {
  const hole = holeOf(key);
  if (!hole) return undefined;
  const row = await bagRow(ctx, hole.course, userId);
  if (hole.number === 1) {
    if (row) await ctx.db.delete(row._id);
    return undefined;
  }
  return row?.bag;
}

// Off a hole: your ball goes with you, and if you finished it, what you were holding goes on to the
// next. The hole's run right up to now, so a sink that hasn't settled yet still counts.
export const leave = mutation({
  args: { worldId: v.id("golfWorlds") },
  handler: async (ctx, { worldId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const w = await ctx.db.get(worldId);
    // A game's ball stays put however often you leave.
    const course = w && !w.matchId && courseOf(w.key);
    if (!w || !course || course.open) return;
    const now = Date.now();
    const snap = await snapshotOf(ctx, worldId);
    const state = snap ? unpack(snap.state as Packed) : newWorld(course, { collide: w.collide });
    advance(state, worldOf(course), Math.max(state.tick, tickAt(w, now)), await commandsFrom(ctx, worldId, state.tick));
    const ball = state.balls.find((b) => b.id === userId);
    const carry = ball && carryOf(ball);
    const hole = holeOf(w.key);
    if (carry && hole) {
      const row = await bagRow(ctx, hole.course, userId);
      if (row) await ctx.db.patch(row._id, { bag: carry, at: now });
      else await ctx.db.insert("golfBags", { course: hole.course, userId, bag: carry, at: now });
    }
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
    const userId = await requireUser(ctx);
    const w = await ctx.db.get(worldId);
    if (!w) throw new Error("That world's gone.");
    for (const n of [clientTick, seq, a, p, i, x, y]) if (n !== undefined && !Number.isFinite(n)) throw new Error("That's not a number.");
    const serverTick = tickAt(w, Date.now());
    // Honour the tick the player saw, within reason.
    let tick = Math.min(serverTick + SLACK, Math.max(serverTick - MAX_LAG, Math.floor(clientTick)));
    if (w.matchId) {
      const match = await ctx.db.get(w.matchId);
      const st = match?.state as GolfState | null;
      if (!match || match.status !== "active" || !st || st.hole !== w.hole) throw new Error("That hole's over.");
      const seat = seatOf(match, userId);
      if (seat < 0 || st.out.includes(seat)) throw new Error("You're not playing in this game.");
      if (kind === "reset") throw new Error("There's no starting again in a game.");
      if (isTurns(match) && kind !== "hop" && kind !== "brake" && match.turn !== userId) throw new Error("It's not your turn.");
      // Nothing from before this turn started, nor on its very tick (the "turn" command might sort after it).
      tick = Math.max(tick, st.turnTick + 1);
      // Back from being away: the caddie stands down.
      if (st.idle[seat] > 0) await ctx.db.patch(match._id, { state: { ...st, idle: st.idle.map((n, k) => (k === seat ? 0 : n)) } });
    }
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
    const now = Date.now();
    const settled = settledAt(tickAt(w, now));
    const course = await courseFor(ctx, w);
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
    // A game's hole: hand the turn on, and finish the hole once everyone's done.
    const ended = w.matchId ? await roundTick(ctx, w, course, state, now) : false;
    // The round may have just put in a command (the next turn, a caddie's shot): then it isn't still.
    const queued = w.matchId && !ended && still && !!(await ctx.db.query("golfCommands").withIndex("by_world_tick", (q) => q.eq("worldId", worldId).gte("tick", settled)).first());
    if ((still && !queued) || ended) await ctx.db.patch(worldId, { awake: false });
    else await ctx.scheduler.runAfter(tickMs(w), internal.golf.tick, { worldId });
  },
});

// --- Games: a round on a course, through the shared match framework (convex/matches.ts) ---
//
// Each hole of a game is its own world (the same netcode as above), made when the hole starts with every
// player's ball already on the tee. Turn-based ("golf:turns"): one ball at a time, whoever's farthest from
// the cup next (round.ts), told to the world with a "turn" command so every phone enforces it. Live
// ("golf:live"): everyone at once against a hole clock. A ball that's in, or out of strokes, is done; once
// every ball is, the scores go on the card and the next hole starts.

const isTurns = (m: Doc<"matches">) => m.mode === "golf:turns";
const nameOf = async (ctx: QueryCtx, id: Id<"users">) => (await displayName(ctx, id)).split(" ")[0];
// A world's state right now: the settled one run on through every command since.
async function stateNow(ctx: QueryCtx, w: Doc<"golfWorlds">, course: Course, settled: WorldState, now: number) {
  const s = unpack(pack(settled));
  advance(s, worldOf(course), Math.max(s.tick, tickAt(w, now)), await commandsFrom(ctx, w._id, s.tick));
  s.events.length = 0;
  return s;
}
async function insertCmd(ctx: MutationCtx, w: Doc<"golfWorlds">, cmd: Omit<Cmd, "seq"> & { by: Id<"users"> }) {
  await ctx.db.insert("golfCommands", { worldId: w._id, seq: (Date.now() % 1_000_000_000) + Math.floor(Math.random() * 1000), ...cmd, bag: cmd.bag });
  // As it is now, not as the caller read it: it may have gone to sleep since.
  await wake(ctx, (await ctx.db.get(w._id))!);
}

async function roundTick(ctx: MutationCtx, w: Doc<"golfWorlds">, course: Course, settled: WorldState, now: number) {
  const match = await ctx.db.get(w.matchId!);
  if (!match || match.status !== "active") return true;
  const st = match.state as GolfState;
  if (st.hole !== w.hole) return true;
  const active = activeSeats(st, match.players.length).map((i) => match.players[i].userId as string);
  // Everyone's done, in the settled world: nothing can change that now.
  const done = settled.done ?? [];
  if (active.every((id) => done.some((d) => d.id === id))) {
    await endHole(ctx, match, st, course, settled);
    return true;
  }
  if (!isTurns(match)) return false;
  const s = await stateNow(ctx, w, course, settled, now);
  const turnBall = s.balls.find((b) => b.id === match.turn);
  // The turn's over once its ball has gone (in, or picked up) or has shot and everything's stopped.
  const over = !turnBall || ((turnBall.turnShots ?? 0) > 0 && quiet(s, course));
  if (!over || !match.turn) return false;
  await knockPushes(ctx, match, st, s);
  await giveTurn(ctx, w, match, st, course, s, now);
  return false;
}

// Anyone the last turn moved, a ball or an item knocking them off where they sat, hears who did it.
async function knockPushes(ctx: MutationCtx, match: Doc<"matches">, st: GolfState, s: WorldState) {
  if (!match.turn) return;
  const by = await nameOf(ctx, match.turn);
  for (const [id, [x, y]] of Object.entries(st.spots)) {
    if (id === match.turn) continue;
    const b = s.balls.find((o) => o.id === id);
    const sunk = s.done?.find((d) => d.id === id && d.how === "sunk" && d.tick >= st.turnTick);
    if (sunk) await notifyMatch(ctx, id as Id<"users">, match, { title: `${by} knocked you in`, body: "Lucky. That counts." });
    else if (b && Math.hypot(b.x - x, b.y - y) > 1.5) await notifyMatch(ctx, id as Id<"users">, match, { title: `${by} knocked your ball`, body: "It's not where you left it." });
  }
}

// Whoever's away gets the turn: a "turn" command for every phone, a push and their clock. Someone the
// caddie's been playing for (IDLE_OUT turns in a row) just gets their shot taken for them.
async function giveTurn(ctx: MutationCtx, w: Doc<"golfWorlds">, match: Doc<"matches">, st: GolfState, course: Course, s: WorldState, now: number) {
  const seatOfId = (id: string) => match.players.findIndex((p) => p.userId === id);
  const field = distanceField(course, worldOf(course));
  const next = nextUp(s, field, seatOfId, st.order) as Id<"users"> | null;
  if (!next) {
    if (match.turn) await ctx.db.patch(match._id, { turn: undefined });
    return;
  }
  const tick = Math.max(s.tick, tickAt(w, now));
  await insertCmd(ctx, w, { tick, by: next, kind: "turn" });
  const spots = Object.fromEntries(s.balls.map((b) => [b.id, [b.x, b.y] as [number, number]]));
  const b = s.balls.find((o) => o.id === next)!;
  const n = st.hole;
  // No limit (the default): the turn waits as long as it takes, with the usual reminders, and no caddie.
  const shotTime = settingsOf(match.mode, match.settings).shotTime ?? 0;
  // Someone who's been away a while: the caddie plays for them straight off, unless they're looking at the
  // game right now. Then there's no "Your shot" push: it'd be gone before they could tap it.
  const away = st.idle[seatOfId(next)] >= IDLE_OUT && !(await onGame(ctx, next, match));
  const { match: after } = await passTurn(ctx, match, {
    state: { ...st, turnTick: tick, spots },
    turn: next,
    by: null,
    push: away ? undefined : { title: "Your shot", body: b.strokes === 0 ? `Hole ${n + 1}, par ${course.par}. You're on the tee.` : `Hole ${n + 1}, par ${course.par}. You're on ${b.strokes}.` },
    timer: shotTime > 0 ? { at: now + shotTime * 60_000, fn: internal.golf.shotTimeout } : undefined,
  });
  if (away) await callCaddie(ctx, after, "away");
}

async function onGame(ctx: QueryCtx, userId: Id<"users">, match: Doc<"matches">) {
  const p = await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  return !!p && Date.now() - p.lastSeen < ONLINE_WINDOW_MS && p.path.includes(match._id);
}

// The caddie: the best of a fan of shots, for someone who's out of time (or away). Working it out can take a
// second or more, too long for a mutation, so it's an action: it reads the world as it stands, picks the shot,
// and puts it in only if it's still that player's turn and their ball hasn't moved (`caddieShoot`).
const callCaddie = (ctx: MutationCtx, match: Doc<"matches">, why: "timeout" | "away") =>
  ctx.scheduler.runAfter(0, internal.golf.caddie, { id: match._id, moveCount: match.moveCount, why });

export const caddieInfo = internalQuery({
  args: { id: v.id("matches"), moveCount: v.number() },
  handler: async (ctx, { id, moveCount }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount || !match.turn) return null;
    const st = match.state as GolfState;
    const w = st.worldId ? await ctx.db.get(st.worldId as Id<"golfWorlds">) : null;
    const course = w && (await courseFor(ctx, w));
    const snap = w && (await snapshotOf(ctx, w._id));
    if (!w || !course || !snap) return null;
    return { turn: match.turn, startAt: w.startAt, course, snapshot: snap.state as Packed, cmds: await commandsFrom(ctx, w._id, snap.tick) };
  },
});

export const caddie = internalAction({
  args: { id: v.id("matches"), moveCount: v.number(), why: v.union(v.literal("timeout"), v.literal("away")) },
  handler: async (ctx, { id, moveCount, why }) => {
    const info = await ctx.runQuery(internal.golf.caddieInfo, { id, moveCount });
    if (!info) return;
    const s = unpack(info.snapshot);
    const w = worldOf(info.course);
    const tick = Math.max(s.tick, Math.floor(((Date.now() - info.startAt) * TPS) / 1000));
    advance(s, w, tick, info.cmds);
    s.events.length = 0;
    const b = s.balls.find((o) => o.id === info.turn);
    // Already shot (still rolling, or about to pass the turn), or off the hole: nothing to do.
    if (!b || b.mode !== "aim" || (b.turnShots ?? 0) > 0) return;
    // Sitting out must never pay: the caddie only goes for the cup from a short putt away (so never a hole in
    // one), and its hands shake like anyone's.
    const shot = bestShot(w, pack(s), info.turn, undefined, { angles: 24, powers: [0.15, 0.3, 0.45, 0.6, 0.8, 1], sinkWithin: CADDIE_SINK });
    if (!shot) return;
    const a = shot.a + (Math.random() - 0.5) * 0.12, p = Math.min(1, Math.max(0.05, shot.p * (1 + (Math.random() - 0.5) * 0.16)));
    await ctx.runMutation(internal.golf.caddieShoot, { id, moveCount, a, p, x: b.x, y: b.y, why });
  },
});

export const caddieShoot = internalMutation({
  args: { id: v.id("matches"), moveCount: v.number(), a: v.number(), p: v.number(), x: v.number(), y: v.number(), why: v.union(v.literal("timeout"), v.literal("away")) },
  handler: async (ctx, { id, moveCount, a, p, x, y, why }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount || !match.turn) return;
    const st = match.state as GolfState;
    const w = st.worldId ? await ctx.db.get(st.worldId as Id<"golfWorlds">) : null;
    const course = w && (await courseFor(ctx, w));
    const snap = w && (await snapshotOf(ctx, w._id));
    if (!w || !course || !snap) return;
    const s = await stateNow(ctx, w, course, unpack(snap.state as Packed), Date.now());
    const b = s.balls.find((o) => o.id === match.turn);
    // The shot was worked out for the ball where it sat; if they've played since, or it's moved, leave it.
    if (!b || b.mode !== "aim" || (b.turnShots ?? 0) > 0 || Math.hypot(b.x - x, b.y - y) > 0.01) return;
    const seat = seatOf(match, match.turn);
    // They came back while the caddie was thinking: it's theirs to take.
    if (why === "away" && st.idle[seat] < IDLE_OUT) return;
    const tick = Math.max(s.tick, tickAt(w, Date.now()), st.turnTick + 1);
    await insertCmd(ctx, w, { tick, by: match.turn, kind: "shot", a, p });
    await ctx.db.patch(match._id, { state: { ...st, idle: st.idle.map((n, k) => (k === seat ? n + 1 : n)) } });
    if (why === "timeout")
      await notifyMatch(ctx, match.turn, match, {
        title: "Your caddie took your shot",
        body: st.idle[seat] + 1 >= IDLE_OUT ? `That's ${IDLE_OUT} in a row, so they'll play for you till you open the game.` : "You ran out of time, so they had a go for you.",
      });
  },
});

export const shotTimeout = internalMutation({
  args: { id: v.id("matches"), moveCount: v.number() },
  handler: async (ctx, { id, moveCount }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount || !match.turn) return;
    await callCaddie(ctx, match, "timeout");
    // If the caddie can't take it (it failed, or the ball was moving), try again in a while: a turn never
    // waits forever on someone who isn't there.
    await ctx.scheduler.runAfter(RETRY_MS, internal.golf.shotTimeout, { id, moveCount });
  },
});
const RETRY_MS = 10 * 60_000;
// How close to the cup the caddie has to be before it tries to hole out.
const CADDIE_SINK = 4;

// The player's opened the game: the caddie stands down, and a course that stopped being built (a restart
// mid-build) starts again.
export const here = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || !match.mode.startsWith("golf:")) return;
    const st = match.state as GolfState;
    const seat = seatOf(match, userId);
    if (seat >= 0 && st.idle[seat] > 0) await ctx.db.patch(id, { state: { ...st, idle: st.idle.map((n, k) => (k === seat ? 0 : n)) } });
    // A hole whose world says it's awake but hasn't settled anything in a good while has lost its ticks (a
    // tick that failed): start them again.
    const w = st.worldId ? await ctx.db.get(st.worldId as Id<"golfWorlds">) : null;
    if (w?.awake) {
      const snap = await snapshotOf(ctx, w._id);
      if (!snap || tickAt(w, Date.now()) - snap.tick > STALE_TICKS) await ctx.scheduler.runAfter(0, internal.golf.tick, { worldId: w._id });
    }
    const built = st.holes.filter(Boolean).length;
    const stalled = built < st.total && Date.now() - (st.builtAt ?? match.startedAt ?? 0) > BUILD_STALL_MS;
    if (stalled) {
      await ctx.db.patch(id, { state: { ...((await ctx.db.get(id))!.state as GolfState), builtAt: Date.now() } });
      await ctx.scheduler.runAfter(0, internal.golf.build, { id });
    }
  },
});
const BUILD_STALL_MS = 90_000;
// Well past how far behind a busy world's snapshot ever gets (it's rewritten every few seconds).
const STALE_TICKS = SNAPSHOT_EVERY + MAX_LAG + 10 * TPS;

// A live hole's clock running out: everyone still out there picks up.
export const holeClock = internalMutation({
  args: { id: v.id("matches"), hole: v.number() },
  handler: async (ctx, { id, hole }) => {
    const match = await ctx.db.get(id);
    const st = match?.state as GolfState | undefined;
    if (!match || match.status !== "active" || !st || st.hole !== hole || !st.worldId) return;
    const w = await ctx.db.get(st.worldId as Id<"golfWorlds">);
    const course = w && (await courseFor(ctx, w));
    const snap = w && (await snapshotOf(ctx, w._id));
    if (!w || !course || !snap) return;
    const s = await stateNow(ctx, w, course, unpack(snap.state as Packed), Date.now());
    const tick = Math.max(s.tick, tickAt(w, Date.now()));
    for (const b of s.balls) await insertCmd(ctx, w, { tick, by: b.id as Id<"users">, kind: "pickup" });
  },
});

// Every ball's done: the scores go on the card, and on to the next hole or the end of the round.
async function endHole(ctx: MutationCtx, match: Doc<"matches">, st: GolfState, course: Course, s: WorldState) {
  const n = st.hole;
  const seats = match.players.length;
  const row: (number | null)[] = Array.from({ length: seats }, () => null);
  const sunk: boolean[] = Array.from({ length: seats }, () => false);
  const bags = st.bags.map((b) => [...b]);
  for (const d of s.done ?? []) {
    const seat = match.players.findIndex((p) => p.userId === d.id);
    if (seat < 0 || st.out.includes(seat)) continue;
    row[seat] = d.strokes;
    sunk[seat] = d.how === "sunk";
    bags[seat] = d.bag;
  }
  const scores = [...st.scores];
  scores[n] = row;
  const sunks = [...st.sunk];
  sunks[n] = sunk;
  const best = Math.min(...row.filter((x): x is number => x !== null));
  const leaders = row.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0);
  const last = `Hole ${n + 1}: ${(await Promise.all(leaders.map((i) => nameOf(ctx, match.players[i].userId)))).join(" and ")} ${best}`;
  const next: GolfState = { ...st, scores, sunk: sunks, bags, spots: {}, last, waiting: false, clockAt: undefined };
  if (n + 1 >= st.total) {
    await ctx.db.patch(match._id, { state: next, turn: undefined, lastActivityAt: Date.now() });
    await finishBySeats(ctx, { ...match, state: next }, standings(next, seats), "holes");
    return;
  }
  const ready = !!next.holes[n + 1];
  const live = !isTurns(match);
  await ctx.db.patch(match._id, { state: { ...next, waiting: !ready, nextAt: live && ready ? Date.now() + NEXT_HOLE_MS : undefined }, turn: undefined, lastActivityAt: Date.now() });
  // Live games get a moment to see the scores before everyone's off again.
  if (ready && live) await ctx.scheduler.runAfter(NEXT_HOLE_MS, internal.golf.nextHole, { id: match._id, hole: n + 1 });
  else if (ready) await startHole(ctx, (await ctx.db.get(match._id))!, n + 1);
}
const NEXT_HOLE_MS = 6000;

export const nextHole = internalMutation({
  args: { id: v.id("matches"), hole: v.number() },
  handler: async (ctx, { id, hole }) => {
    const match = await ctx.db.get(id);
    const st = match?.state as GolfState | undefined;
    if (!match || match.status !== "active" || !st || st.hole !== hole - 1 || !st.holes[hole]) return;
    await startHole(ctx, match, hole);
  },
});

// A hole starts: its world, with everyone's ball on the tee holding what they carried over, then the
// first turn (or the clock).
async function startHole(ctx: MutationCtx, match: Doc<"matches">, n: number) {
  const st = match.state as GolfState;
  const settings = settingsOf(match.mode, match.settings);
  const row = await ctx.db
    .query("golfCourses")
    .withIndex("by_match", (q) => q.eq("matchId", match._id).eq("n", n))
    .unique();
  if (!row) return;
  const course = row.course as Course;
  const now = Date.now();
  const collide = settings.collide !== 0;
  const turns = isTurns(match);
  const rules: Rules = { cap: capOf(course.par), turns, knockFree: true, markR: collide && settings.mark !== 0 ? MARK_R : 0 };
  const key = holeKey(match._id, n);
  const worldId = await ctx.db.insert("golfWorlds", { key, startAt: now, awake: false, collide, matchId: match._id, hole: n });
  const order = honors(st, n, match.players.length);
  const s = newWorld(course, { collide, rules, seed: (now % 100000) + n });
  order.forEach((seat, k) => {
    const p = match.players[seat];
    applyCmd(s, course, { tick: 0, by: p.userId, seq: k, kind: "join", i: seat, bag: st.bags[seat] ?? [] });
    // Every ball's in the world from the start, whether its phone's looking or not.
  });
  await ctx.db.insert("golfSnapshots", { worldId, tick: 0, state: pack(s) });
  await ctx.db.insert("golfStarts", { worldId, state: pack(s) });
  for (const seat of order) await ctx.db.insert("golfPlayers", { worldId, userId: match.players[seat].userId, joinedAt: now });
  const w = (await ctx.db.get(worldId))!;
  const next: GolfState = { ...st, hole: n, worldId, order, turnTick: 0, spots: {}, waiting: false, nextAt: undefined };
  if (turns) {
    await ctx.db.patch(match._id, { state: next });
    await giveTurn(ctx, w, { ...match, state: next }, next, course, s, now);
  } else {
    const minutes = settings.holeTime ?? 3;
    await ctx.db.patch(match._id, { state: { ...next, clockAt: now + minutes * 60_000 }, lastActivityAt: now });
    await ctx.scheduler.runAfter(minutes * 60_000, internal.golf.holeClock, { id: match._id, hole: n });
    if (n > 0) for (const seat of order) await notifyMatch(ctx, match.players[seat].userId, match, { title: `Hole ${n + 1} is on`, body: `${course.name}, par ${course.par}. Go.` });
  }
}

// Builds the game's holes, first to last, each going in as soon as it's ready: the first hole can start
// while the rest are still being made.
export const build = internalAction({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const info = await ctx.runQuery(internal.golf.buildInfo, { id });
    if (!info) return;
    for (let n = info.built; n < info.total; n++) {
      // A hole already made for the mode page's preview is used as it is.
      const made = info.settings.course === 0 ? ((await ctx.runQuery(internal.golf.previewHole, { key: genKey(info.settings), n })) ?? undefined) : undefined;
      const course = buildHole(info.settings, n, holeKey(id, n), made);
      if (!(await ctx.runMutation(internal.golf.addHole, { id, n, course }))) return;
    }
  },
});

export const buildInfo = internalQuery({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active") return null;
    const st = match.state as GolfState;
    return { settings: settingsOf(match.mode, match.settings), total: st.total, built: st.holes.filter(Boolean).length };
  },
});

// One hole built. Returns whether to keep going (the game might have ended meanwhile).
export const addHole = internalMutation({
  args: { id: v.id("matches"), n: v.number(), course: v.any() },
  handler: async (ctx, { id, n, course }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active") return false;
    const st = match.state as GolfState;
    if (st.holes[n]) return true;
    const c = course as Course;
    await ctx.db.insert("golfCourses", { matchId: id, n, course: c });
    const holes = [...st.holes];
    holes[n] = { name: c.name, par: c.par, theme: c.theme, open: !!c.greens.every((g) => g.rim === false) };
    const next = { ...st, holes, builtAt: Date.now() };
    await ctx.db.patch(id, { state: next });
    const updated = { ...match, state: next };
    if (n === 0 && st.hole < 0) await startHole(ctx, updated, 0);
    // The hole before finished while this one was still being built.
    else if (st.waiting && st.hole === n - 1) {
      if (isTurns(match)) await startHole(ctx, updated, n);
      else {
        await ctx.db.patch(id, { state: { ...next, nextAt: Date.now() + NEXT_HOLE_MS } });
        await ctx.scheduler.runAfter(NEXT_HOLE_MS, internal.golf.nextHole, { id, hole: n });
      }
    }
    return true;
  },
});

// A game's holes, built so far: what phones draw and play on. Never changes once a hole's in.
export const holes = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    const rows = await ctx.db
      .query("golfCourses")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    return rows.map((r) => r.course as Course);
  },
});

export const golfHooks: GameHooks = {
  seats: (_mode, n) => SEAT_COLORS.slice(0, n),
  start: async (ctx, match) => {
    const settings = settingsOf(match.mode as ModeKey, match.settings);
    const st = newRound(holeCount(settings), match.players.length);
    await ctx.db.patch(match._id, { state: st, turn: undefined });
    await ctx.scheduler.runAfter(0, internal.golf.build, { id: match._id });
    const live = match.mode === "golf:live";
    await startPushes(ctx, match, () => ({ title: live ? "Golf is on" : "Your round of golf is on", body: live ? `${st.total} holes, everyone at once. Get on the course.` : `${st.total} holes. We'll ping you when it's your shot.` }));
  },
  // Your ball comes off the hole and you place last; everyone else plays on.
  resign: async (ctx, match, userId) => {
    const st = match.state as GolfState;
    const seat = seatOf(match, userId);
    if (seat < 0 || st.out.includes(seat)) return;
    const next: GolfState = { ...st, out: [...st.out, seat] };
    const left = activeSeats(next, match.players.length);
    const w = st.worldId ? await ctx.db.get(st.worldId as Id<"golfWorlds">) : null;
    if (left.length <= 1) {
      await ctx.db.patch(match._id, { state: next });
      const updated = { ...match, state: next };
      if (left.length === 1 && match.players.length === 2) await finish(ctx, updated, { winners: [match.players[left[0]].userId], draw: false, reason: "resign" });
      else await finishBySeats(ctx, updated, standings(next, match.players.length), left.length === 1 ? "last_player" : "resign");
      return;
    }
    await ctx.db.patch(match._id, { state: next, ...(match.turn === userId ? { turn: undefined } : {}) });
    if (w) {
      await insertCmd(ctx, w, { tick: tickAt(w, Date.now()), by: userId, kind: "leave" });
      // It was their turn: the next one goes to whoever's away now.
      if (match.turn === userId && isTurns(match)) {
        const course = await courseFor(ctx, w);
        const snap = await snapshotOf(ctx, w._id);
        if (course && snap) {
          const s = await stateNow(ctx, w, course, unpack(snap.state as Packed), Date.now());
          s.balls = s.balls.filter((b) => b.id !== userId);
          await giveTurn(ctx, w, { ...match, state: next, turn: userId }, next, course, s, Date.now());
        }
      }
    }
  },
  // Not used: a turn-based game's clock is its own (shotTimeout), and the caddie takes the shot.
  timeout: async () => {},
  timeoutWarning: "or your caddie takes the shot",
};

// --- Previews: a course's holes on the mode page, before anyone starts a game ---
//
// A course made by hand is drawn straight from its holes. A generated one is made on the server, a hole at
// a time (it takes a few seconds each), into golfPreviews: the phone asks for it (`requestPreview`), watches
// the holes arrive (`preview`), and a game started on that seed uses them rather than making them again.

const PREVIEW_KEEP_MS = 2 * 24 * 60 * 60 * 1000;
const golfSettings = (mode: string, raw: Record<string, number>) => (isMode(mode) && mode.startsWith("golf:") ? settingsOf(mode, raw) : null);

export const preview = query({
  args: { mode: v.string(), settings: v.record(v.string(), v.number()) },
  handler: async (ctx, { mode, settings }) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const s = golfSettings(mode, settings);
    if (!s) return null;
    const total = holeCount(s);
    if (s.course !== 0) return { total, holes: Array.from({ length: total }, (_, n) => buildHole(s, n, `preview-${s.course}-${n}`)) };
    if (!s.seed) return { total, holes: Array.from({ length: total }, () => null) };
    const key = genKey(s);
    const rows = await ctx.db
      .query("golfPreviews")
      .withIndex("by_key", (q) => q.eq("key", key))
      .collect();
    const made = new Map(rows.map((r) => [r.n, r.course as Course]));
    return { total, holes: Array.from({ length: total }, (_, n) => (made.has(n) ? buildHole(s, n, `preview-${key}-${n}`, made.get(n)) : null)) };
  },
});

export const requestPreview = mutation({
  args: { mode: v.string(), settings: v.record(v.string(), v.number()) },
  handler: async (ctx, { mode, settings }) => {
    await requireUser(ctx);
    const s = golfSettings(mode, settings);
    if (!s || s.course !== 0 || !s.seed) return;
    const key = genKey(s);
    const total = holeCount(s);
    const now = Date.now();
    const job = await ctx.db
      .query("golfPreviewJobs")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    // Already being made (or made) this far: nothing to do. A job that's gone quiet is started again.
    if (job && job.total >= total && now - job.at < 3 * 60_000) return;
    if (job) await ctx.db.patch(job._id, { total: Math.max(total, job.total), at: now });
    else await ctx.db.insert("golfPreviewJobs", { key, total, at: now });
    await ctx.scheduler.runAfter(0, internal.golf.makePreview, { key, total, ...genOpts(s, 0) });
  },
});

export const makePreview = internalAction({
  args: { key: v.string(), total: v.number(), seed: v.number(), n: v.number(), terrain: v.number(), style: v.number(), hazards: v.number() },
  handler: async (ctx, { key, total, seed, terrain, style, hazards }) => {
    for (let n = 0; n < total; n++) {
      if (await ctx.runQuery(internal.golf.previewHole, { key, n })) continue;
      const course = generateHole({ seed, n, terrain, style, hazards });
      await ctx.runMutation(internal.golf.savePreview, { key, n, course });
    }
  },
});

export const previewHole = internalQuery({
  args: { key: v.string(), n: v.number() },
  handler: async (ctx, { key, n }) => {
    const row = await ctx.db
      .query("golfPreviews")
      .withIndex("by_key", (q) => q.eq("key", key).eq("n", n))
      .unique();
    return (row?.course as Course | undefined) ?? null;
  },
});

export const savePreview = internalMutation({
  args: { key: v.string(), n: v.number(), course: v.any() },
  handler: async (ctx, { key, n, course }) => {
    const now = Date.now();
    const had = await ctx.db
      .query("golfPreviews")
      .withIndex("by_key", (q) => q.eq("key", key).eq("n", n))
      .unique();
    if (!had) await ctx.db.insert("golfPreviews", { key, n, course, at: now });
    const job = await ctx.db
      .query("golfPreviewJobs")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (job) await ctx.db.patch(job._id, { at: now });
    // Old previews go, found through their jobs (small rows) so the holes themselves are never read.
    if (n === 0)
      for (const j of await ctx.db.query("golfPreviewJobs").collect()) {
        if (now - j.at < PREVIEW_KEEP_MS) continue;
        for (const r of await ctx.db.query("golfPreviews").withIndex("by_key", (q) => q.eq("key", j.key)).collect()) await ctx.db.delete(r._id);
        await ctx.db.delete(j._id);
      }
  },
});
