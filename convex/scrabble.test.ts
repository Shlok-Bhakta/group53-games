import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { REMINDER_MS } from "./modes";
import { setup, signedIn } from "./test.setup";
import type { ScrabbleState } from "./scrabble/engine";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
type Player = Awaited<ReturnType<typeof signedIn>>;

const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pushes = async (t: T) =>
  (await scheduled(t)).filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending").map((s) => s.args[0] as { userId: Id<"users">; title: string; body: string; url: string });
const clearPushes = (t: T) =>
  t.run(async (ctx) => {
    for (const s of await ctx.db.system.query("_scheduled_functions").collect()) if (s.name === "push:sendToUser" && s.state.kind === "pending") await ctx.scheduler.cancel(s._id);
  });
const get = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.get(id));
const stateOf = async (t: T, id: Id<"matches">) => (await get(t, id))!.state as ScrabbleState;

async function crew(t: T, n: number) {
  const names = ["Shlok", "Chris", "Sam", "Alex", "Jo", "Kai", "Lee", "Max", "Ned"];
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await signedIn(t, names[i]));
  return out;
}

// Gives a player exactly these tiles (ids 0, 1, 2... in order).
async function setRack(t: T, id: Id<"matches">, userId: Id<"users">, letters: string) {
  await t.run(async (ctx) => {
    const row = await ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", userId)).unique();
    await ctx.db.patch(row!._id, { data: { rack: [...letters].map((letter, i) => ({ id: i, letter })) } });
  });
}
const lay = (word: string, x: number, y: number, down = false) => [...word].map((_, i) => ({ id: i, x: down ? x : x + i, y: down ? y + i : y }));

// A started game, seats in turn order.
async function game(t: T, n = 2, mode: "scrabble:classic" | "scrabble:live" = "scrabble:classic", settings?: Record<string, number>) {
  const players = await crew(t, n);
  const id = await players[0].as.mutation(api.matches.queue, { mode, settings });
  for (const p of players.slice(1)) await p.as.mutation(api.matches.queue, { mode });
  if (n < 8) await players[0].as.mutation(api.matches.startGame, { id });
  const m = (await get(t, id))!;
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  return { id, players, seats };
}

describe("lobby with a flexible seat count", () => {
  test("players queue into one lobby that waits for the host to start it", async () => {
    const t = setup();
    const [a, b, c] = await crew(t, 3);
    const id = await a.as.mutation(api.matches.queue, { mode: "scrabble:classic" });
    expect((await pushes(t)).map((p) => [p.title, p.url])).toEqual([
      ["Shlok wants Scrabble", `/scrabble/${id}?accept=1`],
      ["Shlok wants Scrabble", `/scrabble/${id}?accept=1`],
    ]);
    await clearPushes(t);
    await expect(a.as.mutation(api.matches.startGame, { id })).rejects.toThrow("at least 2");
    expect(await b.as.mutation(api.matches.queue, { mode: "scrabble:classic" })).toBe(id);
    expect((await pushes(t)).map((p) => [p.title, p.body])).toEqual([["Chris joined", "2 in. Start whenever you're ready."]]);
    expect((await get(t, id))!.status).toBe("waiting");
    await c.as.mutation(api.matches.join, { id });
    await expect(b.as.mutation(api.matches.startGame, { id })).rejects.toThrow("Only the host");
    await clearPushes(t);
    await a.as.mutation(api.matches.startGame, { id });
    const m = (await get(t, id))!;
    expect(m.status).toBe("active");
    expect(m.players.map((p) => p.color)).toEqual(["red", "blue", "yellow"]);
    expect(m.turn).toBe(m.players[0].userId);
    const s = m.state as ScrabbleState;
    expect(s).toMatchObject({ kind: "scrabble", size: 15, racks: [7, 7, 7], bag: 79, turn: 0, round: 1, tiles: [] });
    expect((await pushes(t)).map((p) => [p.userId, p.title])).toEqual(m.players.map((p, i) => [p.userId, i === 0 ? "You go first" : "Classic Scrabble is on"]));
  });

  test("the eighth player starts it on their own", async () => {
    const t = setup();
    const { id } = await game(t, 8);
    expect((await get(t, id))!.status).toBe("active");
    expect((await stateOf(t, id)).racks).toHaveLength(8);
  });

  test("challenges leave the other seats open without pinging the crew", async () => {
    const t = setup();
    const [a, b, c, d] = await crew(t, 4);
    const id = await a.as.mutation(api.matches.challenge, { mode: "scrabble:classic", opponents: [b.userId, c.userId] });
    expect((await pushes(t)).map((p) => p.userId).sort()).toEqual([b.userId, c.userId].sort());
    expect((await pushes(t)).map((p) => p.body).sort()).toEqual(["Scrabble with Chris. Tap to accept.", "Scrabble with Sam. Tap to accept."]);
    await clearPushes(t);
    // Someone not invited can still take a seat.
    await d.as.mutation(api.matches.join, { id });
    await c.as.mutation(api.matches.decline, { id });
    expect((await pushes(t)).map((p) => p.title)).toContain("Sam declined");
    expect((await get(t, id))!.status).toBe("waiting");
    // Start without waiting on Chris: he misses this one.
    await a.as.mutation(api.matches.startGame, { id });
    expect((await get(t, id))!.players.map((p) => p.userId).sort()).toEqual([a.userId, d.userId].sort());
  });
});

describe("settings", () => {
  test("only changes from the defaults are stored, and the host can change them in the lobby", async () => {
    const t = setup();
    const [a, b] = await crew(t, 2);
    const id = await a.as.mutation(api.matches.queue, { mode: "scrabble:classic", settings: { rack: 7, board: 21, bogus: 3, bag: 42 } });
    expect((await get(t, id))!.settings).toEqual({ board: 21 });
    await a.as.mutation(api.matches.configure, { id, settings: { rack: 5 } });
    expect((await get(t, id))!.settings).toEqual({ board: 21, rack: 5 });
    await expect(b.as.mutation(api.matches.configure, { id, settings: { rack: 9 } })).rejects.toThrow("Only the host");
    await b.as.mutation(api.matches.join, { id });
    await a.as.mutation(api.matches.startGame, { id });
    expect(await stateOf(t, id)).toMatchObject({ size: 21, racks: [5, 5] });
  });

  test("a smaller bag deals from fewer tiles", async () => {
    const t = setup();
    const { id } = await game(t, 2, "scrabble:classic", { bag: 50 });
    const s = await stateOf(t, id);
    expect(s.bag + 14).toBeLessThan(60);
  });
});

describe("racks are secret", () => {
  test("each player reads only their own rack, and the public state has no letters", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    const mine = await seats[0].as.query(api.scrabble.rack, { id });
    expect(mine).toHaveLength(7);
    const theirs = await seats[1].as.query(api.scrabble.rack, { id });
    expect(theirs).toHaveLength(7);
    expect(JSON.stringify(await seats[1].as.query(api.matches.get, { id }))).not.toContain("secrets");
    const view = await seats[1].as.query(api.matches.get, { id });
    expect(Object.keys(view!.state)).not.toContain("bagLetters");
    expect(JSON.stringify(view!.state)).not.toMatch(/"letter"/);
  });
});

describe("playing", () => {
  test("a word scores, refills the rack, passes the turn, and pushes the next player", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "CATSXYZ");
    await clearPushes(t);
    await expect(seats[1].as.mutation(api.scrabble.play, { id, tiles: lay("CAT", 6, 7) })).rejects.toThrow("not your turn");
    expect(await seats[0].as.mutation(api.scrabble.play, { id, tiles: lay("CAT", 6, 7) })).toBe(10);
    const s = await stateOf(t, id);
    expect(s).toMatchObject({ turn: 1, scores: [10, 0], racks: [7, 7], bag: 83, round: 1 });
    expect(s.tiles.map((x) => x.letter).join("")).toBe("CAT");
    expect(s.moves.at(-1)).toMatchObject({ seat: 0, kind: "play", score: 10, words: [{ word: "CAT", score: 10 }] });
    const rack = await seats[0].as.query(api.scrabble.rack, { id });
    expect(rack!.map((x) => x.letter).slice(0, 4).join("")).toBe("SXYZ");
    const name = (await t.run((ctx) => ctx.db.get(seats[0].userId)))!.name;
    expect((await pushes(t)).map((p) => [p.userId, p.title, p.body])).toEqual([[seats[1].userId, `${name} played CAT for 10`, "Your move."]]);
    expect((await get(t, id))!.turn).toBe(seats[1].userId);
  });

  test("words not in the dictionary are refused and nothing changes", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "ZORPABC");
    await expect(seats[0].as.mutation(api.scrabble.play, { id, tiles: lay("ZORP", 5, 7) })).rejects.toThrow("ZORP isn't in the dictionary.");
    expect((await stateOf(t, id)).tiles).toEqual([]);
  });

  test("a full round moves the round counter, and a round limit ends the game", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "scrabble:classic", { rounds: 5 });
    await seats[0].as.mutation(api.scrabble.pass, { id });
    expect(await stateOf(t, id)).toMatchObject({ round: 1, turn: 1 });
    await seats[1].as.mutation(api.scrabble.pass, { id });
    expect(await stateOf(t, id)).toMatchObject({ round: 2, turn: 0, scoreless: 2 });
    await t.run(async (ctx) => {
      const m = (await ctx.db.get(id))!;
      await ctx.db.patch(id, { state: { ...m.state, round: 5, turn: 1, scoreless: 0 }, turn: seats[1].userId });
    });
    await seats[1].as.mutation(api.scrabble.pass, { id });
    expect((await get(t, id))!.result).toMatchObject({ reason: "rounds" });
  });

  test("two scoreless turns from everyone end it, with leftover tiles counted against each player", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "QZ");
    await setRack(t, id, seats[1].userId, "AE");
    for (let i = 0; i < 4; i++) await seats[i % 2].as.mutation(api.scrabble.pass, { id });
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result).toMatchObject({ reason: "passes", draw: false, winners: [seats[1].userId], standings: [[seats[1].userId], [seats[0].userId]] });
    expect((m.state as ScrabbleState).scores).toEqual([-20, -2]);
    expect(m.ratingChanges!.find((c) => c.userId === seats[1].userId)!.after).toBeGreaterThan(1200);
  });

  test("going out with an empty bag ends it, and earns what everyone else is holding", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", undefined)).unique();
      await ctx.db.patch(row!._id, { data: { bag: [], nextId: 500 } });
    });
    await setRack(t, id, seats[0].userId, "CAT");
    await setRack(t, id, seats[1].userId, "QQ");
    await seats[0].as.mutation(api.scrabble.play, { id, tiles: lay("CAT", 6, 7) });
    const m = (await get(t, id))!;
    expect(m.result).toMatchObject({ reason: "went_out", winners: [seats[0].userId] });
    expect((m.state as ScrabbleState).scores).toEqual([30, -20]);
    expect((m.state as ScrabbleState).adjust).toEqual([20, -20]);
  });

  test("swapping trades tiles with the bag and scores nothing", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "QQQAEIO");
    await seats[0].as.mutation(api.scrabble.swap, { id, tileIds: [0, 1, 2] });
    const rack = await seats[0].as.query(api.scrabble.rack, { id });
    expect(rack!.map((x) => x.letter).slice(0, 4).join("")).toBe("AEIO");
    expect(rack).toHaveLength(7);
    expect(await stateOf(t, id)).toMatchObject({ turn: 1, scoreless: 1, bag: 86 });
    expect((await stateOf(t, id)).moves.at(-1)).toMatchObject({ kind: "swap", count: 3 });
  });
});

describe("plans", () => {
  test("a plan is saved privately, others only see that you're planning, and playing clears it", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "CATSXYZ");
    await seats[1].as.mutation(api.scrabble.saveDraft, { id, placed: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 4, y: 3 }], order: [3, 2, 1, 0] });
    expect(await seats[1].as.query(api.scrabble.draft, { id })).toEqual({ placed: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 4, y: 3 }], order: [3, 2, 1, 0] });
    expect(await seats[0].as.query(api.scrabble.draft, { id })).toBeNull();
    expect((await seats[0].as.query(api.scrabble.planning, { id })).map((p) => [p.userId, p.count])).toEqual([[seats[1].userId, 2]]);
    await seats[0].as.mutation(api.scrabble.saveDraft, { id, placed: lay("CAT", 6, 7), order: [] });
    await seats[0].as.mutation(api.scrabble.play, { id, tiles: lay("CAT", 6, 7) });
    expect(await seats[0].as.query(api.scrabble.draft, { id })).toEqual({ placed: [], order: [] });
    // The other player's plan stays put; it's their screen that sorts out any clash.
    expect((await seats[1].as.query(api.scrabble.draft, { id }))!.placed).toHaveLength(2);
  });

  test("the dictionary check reports the words it doesn't know", async () => {
    const t = setup();
    const [a] = await crew(t, 1);
    expect(await a.as.query(api.scrabble.check, { words: ["CAT", "ZORP", "qi"] })).toEqual(["ZORP"]);
  });
});

describe("timers", () => {
  test("live games skip a turn when the timer runs out", async () => {
    const t = setup();
    const { id } = await game(t, 2, "scrabble:live", { turnTime: 30 });
    const s = await stateOf(t, id);
    expect(Math.abs(s.deadline! - (Date.now() + 30_000))).toBeLessThan(1000);
    const timer = (await scheduled(t)).find((f) => f.name === "scrabble:turnTimeout" && f.state.kind === "pending")!;
    expect(timer.scheduledTime).toBe(s.deadline);
    await t.mutation(internal.scrabble.turnTimeout, { id, moveCount: 0 });
    expect(await stateOf(t, id)).toMatchObject({ turn: 1, scoreless: 1 });
    expect((await stateOf(t, id)).moves.at(-1)).toMatchObject({ kind: "timeout", seat: 0 });
    // A stale timer does nothing.
    await t.mutation(internal.scrabble.turnTimeout, { id, moveCount: 0 });
    expect(await stateOf(t, id)).toMatchObject({ turn: 1 });
  });

  test("async games with a move timer skip you once it runs out", async () => {
    const t = setup();
    const { id } = await game(t, 3, "scrabble:classic", { moveTime: 24 });
    // A one-day limit is three reminders: the second one warns, the third skips.
    await t.mutation(internal.matches.remind, { id, moveCount: 0, strikes: 1 });
    expect((await pushes(t)).find((p) => p.title === "Still your move")!.body).toContain("Move in the next 8 hours or we skip your turn.");
    await t.mutation(internal.matches.remind, { id, moveCount: 0, strikes: 2 });
    expect(await stateOf(t, id)).toMatchObject({ turn: 1 });
    expect(REMINDER_MS).toBe(8 * 3600_000);
  });
});

describe("resigning", () => {
  test("in a bigger game you're out and the others play on; the last one in wins", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    await seats[0].as.mutation(api.matches.resign, { id });
    expect(await stateOf(t, id)).toMatchObject({ out: [0], turn: 1, racks: [0, 7, 7], bag: 86 });
    expect((await get(t, id))!.status).toBe("active");
    await seats[2].as.mutation(api.matches.resign, { id });
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result).toMatchObject({ reason: "last_player", winners: [seats[1].userId], standings: [[seats[1].userId], [seats[2].userId], [seats[0].userId]] });
  });
});

describe("rematch", () => {
  test("keeps the settings and moves everyone one seat along", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "scrabble:classic", { rack: 9 });
    await seats[0].as.mutation(api.matches.resign, { id });
    await seats[0].as.mutation(api.matches.rematch, { id });
    const newId = (await seats[1].as.mutation(api.matches.rematch, { id }))!;
    const m = (await get(t, newId))!;
    expect(m.settings).toEqual({ rack: 9 });
    expect((m.state as ScrabbleState).racks).toEqual([9, 9]);
    expect(m.players[0].userId).toBe(seats[1].userId);
  });
});
