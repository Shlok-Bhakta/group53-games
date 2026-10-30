import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_LAG } from "./golf";
import { compile } from "./golf/engine";
import { SANDBOX } from "./golf/sandbox";
import { advance, cmdOrder, newWorld, pack, TPS, unpack, type Packed } from "./golf/world";
import { setup, signedIn } from "./test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
const W = compile(SANDBOX);
const world = (t: T) => t.run(async (ctx) => (await ctx.db.query("golfWorlds").collect())[0]);
const commands = (t: T) => t.run((ctx) => ctx.db.query("golfCommands").collect());
const snapshot = (t: T) => t.run(async (ctx) => (await ctx.db.query("golfSnapshots").collect())[0] ?? null);
const tickNow = async (t: T) => Math.floor(((Date.now() - (await world(t))!.startAt) * TPS) / 1000);
// Lets the server tick run, the way the scheduler would, for `seconds`.
async function settle(t: T, seconds: number) {
  for (let i = 0; i < seconds; i++) {
    vi.advanceTimersByTime(1000);
    const w = await world(t);
    if (w?.awake) await t.mutation(internal.golf.tick, { worldId: w._id });
  }
}

describe("golf's open world", () => {
  test("the first player makes the world; joining twice is one ball", async () => {
    const t = setup();
    const ann = await signedIn(t, "Ann");
    const id = await ann.as.mutation(api.golf.join, {});
    expect(await ann.as.mutation(api.golf.join, {})).toBe(id);
    const cmds = await commands(t);
    expect(cmds.map((c) => c.kind)).toEqual(["join"]);
    const view = await ann.as.query(api.golf.world, {});
    expect(view?.players.map((p) => p.name)).toEqual(["Ann"]);
    expect(view?.collide).toBe(true);
  });

  test("signed-out phones see nothing and can't play", async () => {
    const t = setup();
    expect(await t.query(api.golf.world, {})).toBeNull();
    await expect(t.mutation(api.golf.join, {})).rejects.toThrow("Sign in");
  });

  test("a shot keeps the tick the player saw, within the lag window", async () => {
    const t = setup();
    const ann = await signedIn(t, "Ann");
    const worldId = await ann.as.mutation(api.golf.join, {});
    vi.advanceTimersByTime(10_000);
    const now = await tickNow(t);
    // (convex-test's clock inside a mutation can run a millisecond ahead, so a tick either way.)
    expect(await ann.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: now - 20, seq: 1, a: -1.5, p: 0.5 })).toBe(now - 20);
    const pulled = await ann.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: now - 5000, seq: 2, a: -1.5, p: 0.5 });
    expect(pulled - (now - MAX_LAG)).toBeGreaterThanOrEqual(0);
    expect(pulled - (now - MAX_LAG)).toBeLessThanOrEqual(1);
    expect(await ann.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: now + 5000, seq: 3, a: -1.5, p: 2 })).toBeLessThanOrEqual(now + 1 + TPS / 20);
    // Power is capped, and junk is refused.
    expect((await commands(t)).find((c) => c.seq === 3)?.p).toBe(1);
    await expect(ann.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: now, seq: 4, a: NaN, p: 0.5 })).rejects.toThrow("number");
  });

  test("shooting only ever inserts a command, so two players at once never collide", async () => {
    const t = setup();
    const ann = await signedIn(t, "Ann");
    const bo = await signedIn(t, "Bo");
    const worldId = await ann.as.mutation(api.golf.join, {});
    await bo.as.mutation(api.golf.join, {});
    // Awake (someone's just joined). Waking a sleeping world is the one write a command makes.
    expect((await world(t))!.awake).toBe(true);
    const before = await world(t);
    const now = await tickNow(t);
    await Promise.all([
      ann.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: now, seq: 1, a: -1.5, p: 0.5 }),
      bo.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: now, seq: 1, a: -1.6, p: 0.5 }),
    ]);
    expect(await world(t)).toEqual(before);
    expect((await commands(t)).filter((c) => c.kind === "shot")).toHaveLength(2);
  });

  test("the server settles the world, matches what phones work out, and sleeps once it's still", async () => {
    const t = setup();
    const ann = await signedIn(t, "Ann");
    const bo = await signedIn(t, "Bo");
    const worldId = await ann.as.mutation(api.golf.join, {});
    await bo.as.mutation(api.golf.join, {});
    vi.advanceTimersByTime(500);
    // East along the plaza, short of the speed pad, so it stays on the grass.
    await ann.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: await tickNow(t), seq: 1, a: 0, p: 0.3 });
    expect((await world(t))!.awake).toBe(true);
    await settle(t, 1);
    // Mid-shot: still awake.
    expect((await world(t))!.awake).toBe(true);
    await settle(t, 15);
    const w = (await world(t))!;
    expect(w.awake).toBe(false);
    const snap = (await snapshot(t))!;
    const s = unpack(snap.state as Packed);
    const ball = s.balls.find((b) => b.id === ann.userId)!;
    expect(ball.mode).toBe("aim");
    expect(ball.x).toBeGreaterThan(SANDBOX.tee.x + 4);
    // A phone starting from nothing, with every command, comes to exactly the same world.
    const phone = newWorld(SANDBOX);
    const cmds = (await commands(t)).map(({ tick, by, seq, kind, a, p, i, x, y }) => ({ tick, by, seq, kind, a, p, i, x, y })).sort(cmdOrder);
    advance(phone, W, snap.tick, cmds);
    phone.events.length = 0;
    expect(pack(phone)).toEqual(snap.state);
  });

  test("a command wakes a sleeping world", async () => {
    const t = setup();
    const ann = await signedIn(t, "Ann");
    const worldId = await ann.as.mutation(api.golf.join, {});
    await settle(t, 3);
    expect((await world(t))!.awake).toBe(false);
    await ann.as.mutation(api.golf.act, { worldId, kind: "reset", clientTick: await tickNow(t), seq: 1 });
    expect((await world(t))!.awake).toBe(true);
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((j) => j.name === "golf:tick" && j.state.kind === "pending")).toHaveLength(1);
  });

  test("phones get the commands from the snapshot on", async () => {
    const t = setup();
    const ann = await signedIn(t, "Ann");
    const worldId = await ann.as.mutation(api.golf.join, {});
    vi.advanceTimersByTime(2000);
    await ann.as.mutation(api.golf.act, { worldId, kind: "shot", clientTick: await tickNow(t), seq: 1, a: 0, p: 0.3 });
    const all = await ann.as.query(api.golf.commands, { worldId, from: 0 });
    expect(all.map((c) => c.kind)).toEqual(["join", "shot"]);
    const later = await ann.as.query(api.golf.commands, { worldId, from: all[1].tick });
    expect(later.map((c) => c.kind)).toEqual(["shot"]);
    expect(later[0].by).toBe(ann.userId as Id<"users">);
  });
});
