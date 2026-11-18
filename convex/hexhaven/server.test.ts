import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { setup, signedIn } from "../test.setup";
import { REMIND_MS } from "../hexhaven";
import { geometryOf, noHand } from "./board";
import { actor, roadSpots, villageSpots, type Dev, type Game, type Held, type HexState } from "./engine";
import { botMove, nextBotSeat } from "./bot";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
type Player = Awaited<ReturnType<typeof signedIn>>;

const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pushes = async (t: T) =>
  (await scheduled(t))
    .filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending")
    .map((s) => s.args[0] as { userId: Id<"users">; title: string; body: string });
const clearPushes = (t: T) =>
  t.run(async (ctx) => {
    for (const s of await ctx.db.system.query("_scheduled_functions").collect())
      if (s.name === "push:sendToUser" && s.state.kind === "pending") await ctx.scheduler.cancel(s._id);
  });
const get = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.get(id));
const stateOf = async (t: T, id: Id<"matches">) => (await get(t, id))!.state as HexState;
const patchState = (t: T, id: Id<"matches">, f: (s: HexState) => void) =>
  t.run(async (ctx) => {
    const s = (await ctx.db.get(id))!.state as HexState;
    f(s);
    await ctx.db.patch(id, { state: s });
  });

async function game(t: T, n = 2, settings?: Record<string, number>) {
  const names = ["Shlok", "Chris", "Sam", "Alex", "Boiler", "Jump"];
  const players: Player[] = [];
  for (let i = 0; i < n; i++) players.push(await signedIn(t, names[i]));
  const id = await players[0].as.mutation(api.matches.queue, { mode: "hexhaven:classic", settings });
  for (const p of players.slice(1)) await p.as.mutation(api.matches.queue, { mode: "hexhaven:classic" });
  await players[0].as.mutation(api.matches.startGame, { id });
  const m = (await get(t, id))!;
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  return { id, players, seats };
}

async function loadGame(t: T, id: Id<"matches">): Promise<Game> {
  return await t.run(async (ctx) => {
    const m = (await ctx.db.get(id))!;
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_match_user", (q) => q.eq("matchId", id))
      .collect();
    const deck = (rows.find((r) => r.userId === undefined)?.data as Dev[] | undefined) ?? [];
    const held = m.players.map((p) => (rows.find((r) => r.userId === p.userId)?.data as Held[] | undefined) ?? []);
    return { s: m.state as HexState, deck, held, events: [] };
  });
}

async function botsUntil(t: T, id: Id<"matches">, seats: Player[], done: (s: HexState) => boolean, cap = 4000) {
  for (let i = 0; i < cap; i++) {
    const m = (await get(t, id))!;
    if (m.status !== "active") return;
    const g = await loadGame(t, id);
    if (done(g.s)) return;
    const who = nextBotSeat(g.s, () => false)!;
    const a = botMove(g, who, Math.random)!;
    await seats[who].as.mutation(api.hexhaven.move, { id, action: a as never });
  }
}

const spotOf = (s: HexState, seat: number) => villageSpots(s, seat, true)[0];

describe("a game of Hexhaven", () => {
  test("starts in setup with the first player pushed, and the deck kept secret", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3, { points: 12 });
    const m = (await get(t, id))!;
    const s = m.state as HexState;
    expect(m.status).toBe("active");
    expect(s.phase).toEqual({ k: "setup", i: 0, at: -1 });
    expect(s.rules.points).toBe(12);
    expect(m.turn).toBe(seats[0].userId);
    expect(JSON.stringify(s), "the deck order never goes in the public state").not.toContain("plenty");
    const deck = (await loadGame(t, id)).deck;
    expect(deck).toHaveLength(25);
    const p = (await pushes(t)).filter((x) => x.title === "Hexhaven is on");
    expect(p.find((x) => x.userId === seats[0].userId)?.body).toBe("You place first.");
    expect(p.find((x) => x.userId === seats[1].userId)?.body).toMatch(/places first/);
  });

  test("setup snakes round, only the player up can place, and the next one hears it's theirs", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    let s = await stateOf(t, id);
    await expect(seats[1].as.mutation(api.hexhaven.move, { id, action: { k: "village", at: spotOf(s, 1) } })).rejects.toThrow(
      "not your turn",
    );
    await clearPushes(t);
    const v = spotOf(s, 0);
    await seats[0].as.mutation(api.hexhaven.move, { id, action: { k: "village", at: v } });
    expect(await pushes(t), "placing the village alone passes nothing on").toEqual([]);
    await seats[0].as.mutation(api.hexhaven.move, { id, action: { k: "road", at: geometryOf(s.layout).verts[v].edges[0] } });
    expect((await get(t, id))!.turn).toBe(seats[1].userId);
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: seats[1].userId, title: "Your turn to settle" })]);
    s = await stateOf(t, id);
    expect(actor(s)).toBe(1);
  });

  test("bought cards are only in the buyer's secret, and the cards query returns only mine", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await botsUntil(t, id, seats, (s) => s.phase.k === "main");
    const s = await stateOf(t, id);
    const up = s.current;
    await patchState(t, id, (x) => (x.players[up].res = [0, 0, 1, 1, 1]));
    await seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "buy" }, seen: s.seq });
    const mine = await seats[up].as.query(api.hexhaven.cards, { id });
    const theirs = await seats[1 - up].as.query(api.hexhaven.cards, { id });
    expect(mine).toHaveLength(1);
    expect(theirs).toEqual([]);
    const after = await stateOf(t, id);
    expect(after.players[up].devs).toBe(1);
    expect(after.deckLeft).toBe(24);
    expect(JSON.stringify(after)).not.toContain(`"c":"${mine![0].c}"`);
  });

  test("a stale buy or bank trade is refused", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await botsUntil(t, id, seats, (s) => s.phase.k === "main");
    const s = await stateOf(t, id);
    const up = s.current;
    await patchState(t, id, (x) => (x.players[up].res = [8, 0, 2, 2, 2]));
    await seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "buy" }, seen: s.seq });
    await expect(seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "buy" }, seen: s.seq })).rejects.toThrow("changed");
    const now = await stateOf(t, id);
    await seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "bank", give: 0, get: 4 }, seen: now.seq });
    await expect(seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "bank", give: 0, get: 4 }, seen: now.seq })).rejects.toThrow(
      "changed",
    );
  });

  test("a free-road tap seen before the free roads ended isn't charged as a paid road", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await botsUntil(t, id, seats, (s) => s.phase.k === "main");
    const up = (await stateOf(t, id)).current;
    await patchState(t, id, (x) => {
      x.phase = { k: "roads", left: 2, then: "main" };
      x.players[up].res = [1, 1, 0, 0, 0];
    });
    const s = await stateOf(t, id);
    const at = roadSpots(s, up)[0];
    await seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "doneRoads" }, seen: s.seq });
    await expect(seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "road", at }, seen: s.seq })).rejects.toThrow("changed");
    expect((await stateOf(t, id)).players[up].res).toEqual([1, 1, 0, 0, 0]);
  });

  test("a 7 pushes everyone who has to give cards back, and being robbed is pushed too", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    await botsUntil(t, id, seats, (s) => s.phase.k === "roll");
    const s = await stateOf(t, id);
    const up = s.current;
    const other = (up + 1) % 3;
    await patchState(t, id, (x) => {
      x.players.forEach((p) => (p.res = noHand()));
      x.players[other].res = [3, 3, 3, 0, 0];
    });
    await clearPushes(t);
    let rolled: HexState | null = null;
    for (let tries = 0; tries < 200 && !rolled; tries++) {
      await t.run(async (ctx) => {
        const m = (await ctx.db.get(id))!;
        const x = m.state as HexState;
        x.players.forEach((p) => (p.res = noHand()));
        x.players[other].res = [3, 3, 3, 0, 0];
        await ctx.db.patch(id, { state: { ...x, phase: { k: "roll" }, dice: null } });
      });
      await seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "roll" } });
      const after = await stateOf(t, id);
      if (after.phase.k === "discard") rolled = after;
      else await clearPushes(t);
    }
    expect(rolled!.phase).toEqual({ k: "discard", owe: [0, 1, 2].map((i) => (i === other ? 4 : 0)) });
    expect(await pushes(t)).toEqual([
      expect.objectContaining({ userId: seats[other].userId, title: expect.stringMatching(/rolled a 7/), body: "Give back 4 cards." }),
    ]);
    await seats[other].as.mutation(api.hexhaven.move, { id, action: { k: "discard", res: [2, 2, 0, 0, 0] } });
    const b = await stateOf(t, id);
    expect(b.phase).toEqual({ k: "bandit", then: "main" });
    expect((await get(t, id))!.turn).toBe(seats[up].userId);
    const geo = geometryOf(b.layout);
    const hex = geo.hexes.findIndex((_, h) => h !== b.bandit && geo.hexVerts[h].some((v) => b.spots[v]?.seat === other));
    await clearPushes(t);
    await seats[up].as.mutation(api.hexhaven.move, { id, action: { k: "bandit", hex, from: other } });
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: seats[other].userId, title: expect.stringMatching(/robbed you/) })]);
  });

  test("a trade offer pushes who it's to, and taking it pushes who made it", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await botsUntil(t, id, seats, (s) => s.phase.k === "main");
    const s = await stateOf(t, id);
    const up = s.current;
    const other = 1 - up;
    await patchState(t, id, (x) => {
      x.players[up].res = [1, 0, 0, 0, 0];
      x.players[other].res = [0, 0, 0, 0, 1];
    });
    await clearPushes(t);
    await seats[up].as.mutation(api.hexhaven.move, {
      id,
      action: { k: "offer", to: other, give: [1, 0, 0, 0, 0], get: [0, 0, 0, 0, 1] },
    });
    expect(await pushes(t)).toEqual([
      expect.objectContaining({ userId: seats[other].userId, title: expect.stringMatching(/wants to trade/) }),
    ]);
    await clearPushes(t);
    const offer = (await stateOf(t, id)).offers[0];
    await seats[other].as.mutation(api.hexhaven.move, { id, action: { k: "accept", id: offer.id } });
    expect(await pushes(t)).toEqual([
      expect.objectContaining({ userId: seats[up].userId, title: expect.stringMatching(/took your trade/) }),
    ]);
    const after = await stateOf(t, id);
    expect(after.players[up].res).toEqual([0, 0, 0, 0, 1]);
    expect(after.players[other].res).toEqual([1, 0, 0, 0, 0]);
  });

  test("whoever it's waiting on is nudged every few hours, until they move", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await clearPushes(t);
    vi.advanceTimersByTime(REMIND_MS + 1000);
    await t.finishInProgressScheduledFunctions();
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: seats[0].userId, title: "Still your move" })]);
    const s = await stateOf(t, id);
    await seats[0].as.mutation(api.hexhaven.move, { id, action: { k: "village", at: spotOf(s, 0) } });
    await seats[0].as.mutation(api.hexhaven.move, {
      id,
      action: { k: "road", at: geometryOf(s.layout).verts[spotOf(s, 0)].edges[0] },
    });
    await clearPushes(t);
    await t.run((ctx) => ctx.runMutation(internal.hexhaven.remind, { id, moveCount: 0 }));
    expect(await pushes(t), "a nudge for a move already made fizzles").toEqual([]);
  });

  test("resigning in a two-player game ends it", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await seats[1].as.mutation(api.matches.resign, { id });
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result?.winners).toEqual([seats[0].userId]);
    expect(m.result?.reason).toBe("resign");
  });

  test("the link preview shows the board but never the cards", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await botsUntil(t, id, seats, (s) => s.phase.k === "main");
    const p = await t.query(internal.previews.match, { id });
    expect(p).toMatchObject({ mode: "hexhaven:classic", status: "active" });
    const hex = (p as unknown as { hexhaven: { hexes: unknown[]; points: number[] } }).hexhaven;
    expect(hex.hexes).toHaveLength(19);
    expect(hex.points).toEqual([2, 2]);
    expect(JSON.stringify(p)).not.toContain("plenty");
  });

  test("bots play a whole game through the server to the points", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3, { points: 8 });
    await botsUntil(t, id, seats, () => false);
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result?.reason).toBe("points");
    expect(m.result?.standings?.flat()).toHaveLength(3);
    const s = m.state as HexState;
    expect(s.phase.k).toBe("over");
    expect(
      s.players.every((p) => typeof p.points === "number"),
      "everyone's hidden points are shown at the end",
    ).toBe(true);
  }, 180_000);
});
