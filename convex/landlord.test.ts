import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { setup, signedIn } from "./test.setup";
import { actor, type MonoState } from "./landlord/engine";
import { botMove } from "./landlord/bot";
import { REMIND_MS } from "./landlord";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
type Player = Awaited<ReturnType<typeof signedIn>>;

const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pushes = async (t: T) =>
  (await scheduled(t)).filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending").map((s) => s.args[0] as { userId: Id<"users">; title: string; body: string });
const clearPushes = (t: T) =>
  t.run(async (ctx) => {
    for (const s of await ctx.db.system.query("_scheduled_functions").collect()) if (s.name === "push:sendToUser" && s.state.kind === "pending") await ctx.scheduler.cancel(s._id);
  });
const get = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.get(id));
const stateOf = async (t: T, id: Id<"matches">) => (await get(t, id))!.state as MonoState;

async function game(t: T, n = 2, settings?: Record<string, number>) {
  const names = ["Shlok", "Chris", "Sam", "Alex"];
  const players: Player[] = [];
  for (let i = 0; i < n; i++) players.push(await signedIn(t, names[i]));
  const id = await players[0].as.mutation(api.matches.queue, { mode: "landlord:classic", settings });
  for (const p of players.slice(1)) await p.as.mutation(api.matches.queue, { mode: "landlord:classic" });
  await players[0].as.mutation(api.matches.startGame, { id });
  const m = (await get(t, id))!;
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  return { id, players, seats };
}

describe("a game of Landlord", () => {
  test("starts with everyone on Start, the decks secret, and the first player pushed", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3, { cash: 2000 });
    const m = (await get(t, id))!;
    const s = m.state as MonoState;
    expect(m.status).toBe("active");
    expect(s.players.map((p) => [p.cash, p.pos])).toEqual([
      [2000, 0],
      [2000, 0],
      [2000, 0],
    ]);
    expect(m.turn).toBe(seats[0].userId);
    // The decks' order isn't in the public state, only in the game's secret.
    expect(JSON.stringify(s)).not.toContain("decks");
    const secret = await t.run((ctx) => ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", undefined)).unique());
    expect((secret!.data as { chance: number[] }).chance).toHaveLength(16);
    const p = (await pushes(t)).filter((x) => x.title === "Landlord is on");
    expect(p.find((x) => x.userId === seats[0].userId)?.body).toBe("You roll first.");
    expect(p.find((x) => x.userId === seats[1].userId)?.body).toMatch(/rolls first/);
  });

  test("only the player on turn can roll, and the next one hears it's their turn", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await expect(seats[1].as.mutation(api.landlord.move, { id, action: { k: "roll" } })).rejects.toThrow("not your roll");
    await clearPushes(t);
    await seats[0].as.mutation(api.landlord.move, { id, action: { k: "roll" } });
    let s = await stateOf(t, id);
    // Play it out until the turn passes (a buy, doubles, a card...).
    for (let i = 0; i < 20 && s.current === 0; i++) {
      const who = actor(s);
      const a = botMove(s, who, Math.random)!;
      if (a.k === "resign") break;
      await seats[who].as.mutation(api.landlord.move, { id, action: a as never });
      s = await stateOf(t, id);
    }
    expect(s.current).toBe(1);
    expect((await get(t, id))!.turn).toBe(seats[1].userId);
    expect((await pushes(t)).some((p) => p.userId === seats[1].userId && p.title === "Your turn")).toBe(true);
  });

  test("the log plays back from where a phone last looked, or from my own last move", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await seats[0].as.mutation(api.landlord.move, { id, action: { k: "roll" } });
    const all = await seats[1].as.query(api.landlord.log, { id, from: 0 });
    expect(all!.start.seq).toBeGreaterThan(0);
    expect(all!.moves.length).toBeGreaterThanOrEqual(1);
    expect(all!.moves[0].events[0]).toMatchObject({ t: "roll", seat: 0 });
    const s = await stateOf(t, id);
    const now = await seats[1].as.query(api.landlord.log, { id, from: s.seq });
    expect(now!.moves).toEqual([]);
    expect(now!.start.state.seq).toBe(s.seq);
    // Never looked: everything since my own last move, which for the roller is nothing.
    const mine = await seats[0].as.query(api.landlord.log, { id });
    expect(mine!.moves).toEqual([]);
  });

  test("whoever it's waiting on is nudged every few hours, until they move", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await clearPushes(t);
    vi.advanceTimersByTime(REMIND_MS + 1000);
    await t.finishInProgressScheduledFunctions();
    const p = await pushes(t);
    expect(p).toEqual([expect.objectContaining({ userId: seats[0].userId, title: "Still your move" })]);
    await seats[0].as.mutation(api.landlord.move, { id, action: { k: "roll" } });
    await clearPushes(t);
    // The old nudge fizzles: it was for a move that's been made.
    const stale = (await scheduled(t)).filter((s) => s.name === "landlord:remind" && s.state.kind === "pending");
    expect(stale.length).toBeGreaterThan(0);
    await t.run((ctx) => ctx.runMutation(internal.landlord.remind, { id, moveCount: 0 }));
    expect(await pushes(t)).toEqual([]);
  });

  test("an auction pings everyone in it, and a bid pings the rest", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    await t.run(async (ctx) => {
      const m = (await ctx.db.get(id))!;
      const s = m.state as MonoState;
      s.phase = { k: "buy", pos: 39 };
      s.players[0].pos = 39;
      await ctx.db.patch(id, { state: s });
    });
    await clearPushes(t);
    await seats[0].as.mutation(api.landlord.move, { id, action: { k: "decline" } });
    let p = await pushes(t);
    expect(p.filter((x) => x.title.startsWith("Auction")).map((x) => x.userId).sort()).toEqual([seats[1].userId, seats[2].userId].sort());
    await clearPushes(t);
    await seats[1].as.mutation(api.landlord.move, { id, action: { k: "bid", amount: 150 } });
    p = await pushes(t);
    expect(p.map((x) => x.userId).sort()).toEqual([seats[0].userId, seats[2].userId].sort());
    expect((await get(t, id))!.turn).toBe(seats[2].userId);
    await seats[0].as.mutation(api.landlord.move, { id, action: { k: "fold" } });
    await seats[2].as.mutation(api.landlord.move, { id, action: { k: "fold" } });
    const s = await stateOf(t, id);
    expect(s.props[39]!.owner).toBe(1);
    expect(s.players[1].cash).toBe(1350);
  });

  test("a trade offer pushes who it's to, and answering it pushes who made it", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await t.run(async (ctx) => {
      const s = (await ctx.db.get(id))!.state as MonoState;
      s.props[1]!.owner = 0;
      await ctx.db.patch(id, { state: s });
    });
    await clearPushes(t);
    await seats[0].as.mutation(api.landlord.move, { id, action: { k: "offer", to: 1, give: { cash: 0, props: [1], free: [] }, get: { cash: 100, props: [], free: [] } } });
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: seats[1].userId, title: expect.stringMatching(/sent you a trade/) })]);
    await clearPushes(t);
    await seats[1].as.mutation(api.landlord.move, { id, action: { k: "accept", id: 1 } });
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: seats[0].userId, title: expect.stringMatching(/took your trade/) })]);
    const s = await stateOf(t, id);
    expect(s.props[1]!.owner).toBe(1);
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

  test("bots play a whole game through the server", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3, { game: 1 });
    for (let i = 0; i < 3000; i++) {
      const m = (await get(t, id))!;
      if (m.status !== "active") break;
      const s = m.state as MonoState;
      const who = actor(s);
      const a = botMove(s, who, Math.random);
      expect(a).not.toBeNull();
      await seats[who].as.mutation(api.landlord.move, { id, action: a as never });
    }
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result?.reason).toBe("richest");
    expect(m.result?.standings).toHaveLength(3);
    // The log holds every event, in order, with no gaps.
    const rows = await t.run((ctx) => ctx.db.query("landlordLog").withIndex("by_match", (q) => q.eq("matchId", id)).collect());
    let seq = 0;
    for (const r of rows) {
      expect(r.seq).toBe(seq);
      seq += (r.events as unknown[]).length;
    }
    expect(seq).toBe((m.state as MonoState).seq);
  }, 120_000);
});
