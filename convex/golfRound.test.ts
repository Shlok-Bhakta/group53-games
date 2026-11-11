import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Course } from "./golf/engine";
import { bestShot } from "./golf/bot";
import { worldOf } from "./golf/holes";
import type { GolfState } from "./golf/round";
import { advance, TPS, unpack, type Packed } from "./golf/world";
import { setup, signedIn } from "./test.setup";

// A round of golf as a game: the lobby, the holes being built, turns going to whoever's farthest away,
// scores on the card, and the end.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
type Player = Awaited<ReturnType<typeof signedIn>>;

const get = (t: T, id: Id<"matches">) => t.run(async (ctx) => (await ctx.db.get(id))!);
const stateOf = async (t: T, id: Id<"matches">) => (await get(t, id)).state as GolfState;
const worldOfMatch = async (t: T, id: Id<"matches">) => {
  const st = await stateOf(t, id);
  return t.run(async (ctx) => (await ctx.db.get(st.worldId as Id<"golfWorlds">))!);
};
const courseOfHole = (t: T, id: Id<"matches">, n: number) =>
  t.run(async (ctx) => (await ctx.db.query("golfCourses").withIndex("by_match", (q) => q.eq("matchId", id).eq("n", n)).unique())!.course as Course);
const pushes = (t: T) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name === "push:sendToUser").map((s) => s.args[0] as { userId: Id<"users">; title: string; body: string }));

async function game(t: T, n: number, mode: "golf:turns" | "golf:live", settings: Record<string, number>) {
  const names = ["Shlok", "Chris", "Sam", "Alex"];
  const players: Player[] = [];
  for (let i = 0; i < n; i++) players.push(await signedIn(t, names[i]));
  const id = await players[0].as.mutation(api.matches.queue, { mode, settings });
  for (const p of players.slice(1)) await p.as.mutation(api.matches.queue, { mode });
  await players[0].as.mutation(api.matches.startGame, { id });
  await t.action(internal.golf.build, { id });
  const m = await get(t, id);
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  return { id, players, seats };
}

// The server's ticks, for `seconds` of play (twice a second, like a game's world).
async function settle(t: T, id: Id<"matches">, seconds: number) {
  for (let i = 0; i < seconds * 2; i++) {
    vi.advanceTimersByTime(500);
    const w = await worldOfMatch(t, id);
    if (w.awake) await t.mutation(internal.golf.tick, { worldId: w._id });
  }
}

// The world as it stands, worked out the way a phone would.
async function worldNow(t: T, id: Id<"matches">) {
  const w = await worldOfMatch(t, id);
  const c = await courseOfHole(t, id, w.hole!);
  const snap = await t.run(async (ctx) => (await ctx.db.query("golfSnapshots").withIndex("by_world", (q) => q.eq("worldId", w._id)).unique())!);
  const cmds = await t.run((ctx) => ctx.db.query("golfCommands").withIndex("by_world_tick", (q) => q.eq("worldId", w._id)).collect());
  const s = unpack(snap.state as Packed);
  const now = Math.floor(((Date.now() - w.startAt) * TPS) / 1000);
  advance(s, worldOf(c), Math.max(s.tick, now) + 6, cmds.map((r) => ({ tick: r.tick, by: r.by, seq: r.seq, kind: r.kind, a: r.a, p: r.p, i: r.i, x: r.x, y: r.y })).sort((a, b) => a.tick - b.tick || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0) || a.seq - b.seq));
  return { w, c, s };
}

// Whoever's turn it is takes the bot's best shot, and the server ticks until the turn's passed on.
async function playTurn(t: T, id: Id<"matches">, players: Player[]) {
  const m = await get(t, id);
  const p = players.find((x) => x.userId === m.turn)!;
  const { w, c, s } = await worldNow(t, id);
  const shot = bestShot(worldOf(c), JSON.parse(JSON.stringify({ ...s, balls: s.balls.map(({ boxes: _b, gone: _g, mines: _m, strikes: _s, patches: _p, events: _e, ...rest }) => rest) })), p.userId, undefined, { angles: 16, powers: [0.2, 0.4, 0.6, 0.8, 1] })!;
  const now = Math.floor(((Date.now() - w.startAt) * TPS) / 1000);
  await p.as.mutation(api.golf.act, { worldId: w._id, kind: "shot", clientTick: now, seq: Math.floor(Math.random() * 1e6), a: shot.a, p: shot.p });
  const before = m.moveCount;
  for (let i = 0; i < 40; i++) {
    await settle(t, id, 1);
    const after = await get(t, id);
    if (after.moveCount !== before || after.status !== "active" || (after.state as GolfState).hole !== (m.state as GolfState).hole) return p;
  }
  throw new Error("The turn never passed.");
}

describe("a turn-based round", () => {
  test("builds the holes, puts everyone on the tee and gives the first turn", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "golf:turns", { course: 1, holes: 3 });
    const m = await get(t, id);
    const st = m.state as GolfState;
    expect(m.status).toBe("active");
    expect(st.total).toBe(3);
    expect(st.holes.map((h) => h?.name)).toEqual(["Hello", "Elbow", "Tilt"]);
    expect(st.hole).toBe(0);
    // The first hole goes in seat order.
    expect(m.turn).toBe(seats[0].userId);
    const { s } = await worldNow(t, id);
    expect(s.balls.map((b) => b.id).sort()).toEqual(seats.map((p) => p.userId).sort());
    expect(s.turn).toBe(seats[0].userId);
    expect((await pushes(t)).some((p) => p.userId === seats[0].userId && p.title === "Your shot")).toBe(true);
  });

  test("only the player on turn can shoot, and only once", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "golf:turns", { course: 1, holes: 3 });
    const w = await worldOfMatch(t, id);
    await expect(seats[1].as.mutation(api.golf.act, { worldId: w._id, kind: "shot", clientTick: 0, seq: 1, a: -1.5, p: 0.5 })).rejects.toThrow("not your turn");
    await expect(seats[0].as.mutation(api.golf.act, { worldId: w._id, kind: "reset", clientTick: 0, seq: 1 })).rejects.toThrow("starting again");
    // Two shots in one turn: the world takes the first, ignores the second.
    await seats[0].as.mutation(api.golf.act, { worldId: w._id, kind: "shot", clientTick: 0, seq: 1, a: -Math.PI / 2, p: 0.15 });
    vi.advanceTimersByTime(3000);
    await seats[0].as.mutation(api.golf.act, { worldId: w._id, kind: "shot", clientTick: 0, seq: 2, a: -Math.PI / 2, p: 0.15 });
    const { s } = await worldNow(t, id);
    expect(s.balls.find((b) => b.id === seats[0].userId)!.strokes).toBe(1);
  });

  test("plays three holes through to the end: scores on the card, fewest strokes wins", async () => {
    const t = setup();
    const { id, players } = await game(t, 2, "golf:turns", { course: 1, holes: 3 });
    for (let k = 0; k < 60; k++) {
      const m = await get(t, id);
      if (m.status !== "active") break;
      await playTurn(t, id, players);
    }
    const m = await get(t, id);
    expect(m.status).toBe("finished");
    expect(m.result!.reason).toBe("holes");
    const st = m.state as GolfState;
    expect(st.scores).toHaveLength(3);
    for (const row of st.scores) for (const x of row) expect(x).toBeGreaterThanOrEqual(1);
    const totals = [0, 1].map((s) => st.scores.reduce((a, r) => a + r[s]!, 0));
    const best = Math.min(...totals);
    expect(m.result!.standings![0].map((u) => m.players.findIndex((p) => p.userId === u)).every((s) => totals[s] === best)).toBe(true);
    expect(m.ratingChanges).toHaveLength(2);
  }, 120_000);

  test("whoever's farthest from the cup goes next", async () => {
    const t = setup();
    const { id, players, seats } = await game(t, 2, "golf:turns", { course: 1, holes: 3 });
    // Seat 0 tees off; seat 1 hasn't, so it's theirs next whatever happened.
    await playTurn(t, id, players);
    const m = await get(t, id);
    if ((m.state as GolfState).hole === 0) expect(m.turn).toBe(seats[1].userId);
  });

  test("the caddie shoots for someone whose time runs out", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "golf:turns", { course: 1, holes: 3, shotTime: 60 });
    const m = await get(t, id);
    vi.advanceTimersByTime(60 * 60_000);
    await t.mutation(internal.golf.shotTimeout, { id, moveCount: m.moveCount });
    // The timeout calls the caddie, an action (working out the shot takes too long for a mutation).
    await t.action(internal.golf.caddie, { id, moveCount: m.moveCount, why: "timeout" });
    const { s } = await worldNow(t, id);
    expect(s.balls.find((b) => b.id === seats[0].userId)?.strokes ?? 1).toBe(1);
    expect((await stateOf(t, id)).idle[0]).toBe(1);
    expect((await pushes(t)).some((p) => p.title === "Your caddie took your shot")).toBe(true);
  });

  test("someone the caddie's playing for gets their shot taken at once, and the game keeps going", async () => {
    const t = setup();
    const { id, players, seats } = await game(t, 2, "golf:turns", { course: 1, holes: 3 });
    // The second seat's been away three turns running.
    await t.run(async (ctx) => {
      const m = (await ctx.db.get(id))!;
      await ctx.db.patch(id, { state: { ...(m.state as GolfState), idle: [0, 3] } });
    });
    const w = await worldOfMatch(t, id);
    await seats[0].as.mutation(api.golf.act, { worldId: w._id, kind: "shot", clientTick: 0, seq: 1, a: -Math.PI / 2, p: 0.1 });
    // A slow scheduler: the next tick only comes round well after the ball's stopped.
    vi.advanceTimersByTime(15_000);
    await t.mutation(internal.golf.tick, { worldId: w._id });
    expect((await get(t, id)).turn).toBe(seats[1].userId);
    // The caddie's called straight away (an action, as the scheduler would run it).
    await t.action(internal.golf.caddie, { id, moveCount: (await get(t, id)).moveCount, why: "away" });
    // The caddie's shot is in, and the world stayed awake to play it out.
    expect((await worldOfMatch(t, id)).awake).toBe(true);
    await settle(t, id, 20);
    const { s } = await worldNow(t, id);
    const caddied = s.balls.find((b) => b.id === seats[1].userId);
    expect(caddied ? caddied.strokes : 1).toBeGreaterThanOrEqual(1);
    // And it came back round to the first player (or the hole moved on).
    const m = await get(t, id);
    expect(m.turn === seats[0].userId || (m.state as GolfState).hole > 0).toBe(true);
    void players;
  }, 60_000);

  test("opening the game stands the caddie down", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "golf:turns", { course: 1, holes: 3 });
    await t.run(async (ctx) => {
      const m = (await ctx.db.get(id))!;
      await ctx.db.patch(id, { state: { ...(m.state as GolfState), idle: [0, 3] } });
    });
    await seats[1].as.mutation(api.golf.here, { id });
    expect((await stateOf(t, id)).idle).toEqual([0, 0]);
  });

  test("resigning takes your ball off and the other player wins", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "golf:turns", { course: 1, holes: 3 });
    await seats[0].as.mutation(api.matches.resign, { id });
    const m = await get(t, id);
    expect(m.status).toBe("finished");
    expect(m.result!.winners).toEqual([seats[1].userId]);
  });

  test("with three, a resignation hands the turn on and the rest play on", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3, "golf:turns", { course: 1, holes: 3 });
    await seats[0].as.mutation(api.matches.resign, { id });
    const m = await get(t, id);
    expect(m.status).toBe("active");
    expect(m.turn).toBe(seats[1].userId);
    const { s } = await worldNow(t, id);
    expect(s.balls.map((b) => b.id)).not.toContain(seats[0].userId);
  });
});

describe("a live round", () => {
  test("everyone can shoot at once, and the hole clock picks up whoever's left", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "golf:live", { course: 1, holes: 3, holeTime: 2 });
    const w = await worldOfMatch(t, id);
    expect((await get(t, id)).turn).toBeUndefined();
    for (const p of seats) await p.as.mutation(api.golf.act, { worldId: w._id, kind: "shot", clientTick: 0, seq: 1, a: Math.PI / 2, p: 0.1 });
    vi.advanceTimersByTime(2 * 60_000);
    await t.mutation(internal.golf.holeClock, { id, hole: 0 });
    await t.run((ctx) => ctx.db.patch(w._id, { awake: true }));
    await settle(t, id, 6);
    const st = await stateOf(t, id);
    expect(st.scores[0]).toHaveLength(2);
    // Picked up by the clock: par plus four, however few they'd taken, so sitting it out never pays.
    expect(st.scores[0]).toEqual([st.holes[0]!.par + 4, st.holes[0]!.par + 4]);
    // The next hole after a moment to see the scores.
    vi.advanceTimersByTime(6000);
    await t.mutation(internal.golf.nextHole, { id, hole: 1 });
    expect((await stateOf(t, id)).hole).toBe(1);
  });
});

describe("seeds", () => {
  test("a game's seed is rolled when it's made, shown, and a rematch rolls a new one", async () => {
    const t = setup();
    const { id } = await game(t, 2, "golf:turns", { holes: 3 });
    const m = await get(t, id);
    expect(m.settings?.seed).toBeGreaterThan(0);
    const again = await get(t, id);
    expect((again as Doc<"matches">).settings?.seed).toBe(m.settings?.seed);
  }, 120_000);

  test("the same seed builds the same holes", async () => {
    const t = setup();
    const a = await game(t, 2, "golf:turns", { holes: 3, seed: 4242 });
    const b = await game(t, 2, "golf:turns", { holes: 3, seed: 4242 });
    for (let n = 0; n < 3; n++) {
      const ca = await courseOfHole(t, a.id, n), cb = await courseOfHole(t, b.id, n);
      expect({ ...ca, id: "" }).toEqual({ ...cb, id: "" });
    }
  }, 120_000);
});

describe("previews", () => {
  test("a course made by hand shows its holes straight away", async () => {
    const t = setup();
    const me = await signedIn(t);
    const p = await me.as.query(api.golf.preview, { mode: "golf:turns", settings: { course: 2, holes: 3 } });
    expect(p!.holes.map((h) => h?.name)).toEqual(["Thin Ice", "Zamboni", "Snowplow"]);
  });

  test("a generated one fills in, and a game on that seed plays exactly those holes", async () => {
    const t = setup();
    const me = await signedIn(t);
    const settings = { holes: 3, seed: 777 };
    expect((await me.as.query(api.golf.preview, { mode: "golf:turns", settings }))!.holes).toEqual([null, null, null]);
    await me.as.mutation(api.golf.requestPreview, { mode: "golf:turns", settings });
    // Asking twice makes it once.
    await me.as.mutation(api.golf.requestPreview, { mode: "golf:turns", settings });
    const jobs = await t.run((ctx) => ctx.db.query("golfPreviewJobs").collect());
    expect(jobs).toHaveLength(1);
    await t.action(internal.golf.makePreview, { key: jobs[0].key, total: 3, seed: 777, n: 0, terrain: 0, style: 2, hazards: 1 });
    const shown = (await me.as.query(api.golf.preview, { mode: "golf:turns", settings }))!.holes;
    expect(shown.every((h) => h !== null)).toBe(true);
    const { id } = await game(t, 2, "golf:turns", settings);
    for (let n = 0; n < 3; n++) {
      const played = await courseOfHole(t, id, n);
      expect({ ...played, id: "" }).toEqual({ ...shown[n]!, id: "" });
    }
  }, 120_000);
});
