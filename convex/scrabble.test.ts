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
    // Half a bag is 54 tiles; two racks of 7 leave 40.
    expect(await stateOf(t, id)).toMatchObject({ bag: 40, racks: [7, 7] });
  });
});

describe("racks are secret", () => {
  test("each player reads only their own rack, and the public state has no letters", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    const rows = await t.run((ctx) => ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id)).collect());
    const secret = (userId?: Id<"users">) => rows.find((r) => r.userId === userId)!.data as { rack: { id: number; letter: string }[] };
    // Each player's rack query returns exactly their own tiles, never the other player's.
    for (const p of seats) {
      const got = await p.as.query(api.scrabble.rack, { id });
      expect(got).toEqual(secret(p.userId).rack);
      expect(got).toHaveLength(7);
    }
    expect(secret(seats[0].userId).rack.map((x) => x.id)).not.toEqual(expect.arrayContaining(secret(seats[1].userId).rack.map((x) => x.id)));
    // Someone not in the game, or signed out, gets nothing.
    const outsider = await signedIn(t, "Lurker");
    expect(await outsider.as.query(api.scrabble.rack, { id })).toBeNull();
    expect(await t.query(api.scrabble.rack, { id })).toBeNull();
    // The public state only counts tiles: no letters, no bag.
    const view = await seats[1].as.query(api.matches.get, { id });
    expect(view!.state).toMatchObject({ racks: [7, 7], bag: 86, tiles: [] });
    expect(JSON.stringify(view)).not.toMatch(/"letter"|"rack"|"bag":\[/);
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
    expect(m.ratingChanges!.map((c) => [c.userId, c.after])).toEqual(expect.arrayContaining([[seats[1].userId, 1216], [seats[0].userId, 1184]]));
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
    expect((await seats[0].as.query(api.scrabble.planning, { id })).map((p) => [p.userId, p.count, p.cells])).toEqual([[seats[1].userId, 2, [[3, 3], [4, 3]]]]);
    // Where, but never which letters.
    expect(JSON.stringify(await seats[0].as.query(api.scrabble.planning, { id }))).not.toMatch(/"id"|letter/);
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
    // Each strike is a reminder armed 8 hours (in minutes here) out, so three are the day: the
    // start's, the one the first strike re-armed, and the next player's first after the skip.
    const reminders = (await scheduled(t)).filter((f) => f.name === "matches:remind").map((f) => [f.args[0], Math.round((f.scheduledTime - Date.now()) / 60_000)]);
    expect(reminders).toEqual([
      [{ id, moveCount: 0, strikes: 0 }, 8 * 60],
      [{ id, moveCount: 0, strikes: 2 }, 8 * 60],
      [{ id, moveCount: 1, strikes: 0 }, 8 * 60],
    ]);
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

describe("notifications", () => {
  const scheduledFns = async (t: T, name: string) => (await scheduled(t)).filter((f) => f.name === name && f.state.kind === "pending");

  test("async: every turn pushes the next player, reminds them every 8 hours, and stale reminders stay quiet", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    const url = `/scrabble/${id}`;
    // The game starting tells everyone, and the first player it's on them.
    const start = (await pushes(t)).filter((p) => !p.title.includes("wants") && !p.title.includes("joined"));
    expect(start.find((p) => p.userId === seats[0].userId)).toMatchObject({ title: "You go first", url });
    expect(start.filter((p) => p.userId !== seats[0].userId).map((p) => p.title)).toEqual(["Classic Scrabble is on", "Classic Scrabble is on"]);
    await clearPushes(t);

    await setRack(t, id, seats[0].userId, "CATSXYZ");
    await seats[0].as.mutation(api.scrabble.play, { id, tiles: lay("CAT", 6, 7) });
    const name = (await t.run((ctx) => ctx.db.get(seats[0].userId)))!.name;
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: seats[1].userId, title: `${name} played CAT for 10`, body: "Your move.", url })]);
    await clearPushes(t);

    // The reminder for this move is armed 8 hours out and nags the right person.
    const reminder = (await scheduledFns(t, "matches:remind")).find((f) => (f.args[0] as { moveCount: number }).moveCount === 1)!;
    expect(reminder.scheduledTime - Date.now()).toBeGreaterThan(REMINDER_MS - 1000);
    await t.mutation(internal.matches.remind, reminder.args[0] as { id: Id<"matches">; moveCount: number });
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: seats[1].userId, title: "Still your move", url })]);
    await clearPushes(t);

    // Once they've moved, that reminder fizzles.
    await seats[1].as.mutation(api.scrabble.pass, { id });
    await clearPushes(t);
    await t.mutation(internal.matches.remind, { id, moveCount: 1 });
    expect(await pushes(t)).toEqual([]);
  });

  test("nobody gets a push for a game they're looking at", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await clearPushes(t);
    await t.run((ctx) => ctx.db.insert("presence", { userId: seats[1].userId, online: true, lastSeen: Date.now(), path: `/scrabble/${id}` }));
    await seats[0].as.mutation(api.scrabble.pass, { id });
    expect(await pushes(t)).toEqual([]);
  });

  test("the end of the game tells everyone how they did", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "QZ");
    await setRack(t, id, seats[1].userId, "AE");
    await clearPushes(t);
    for (let i = 0; i < 4; i++) await seats[i % 2].as.mutation(api.scrabble.pass, { id });
    const end = (await pushes(t)).filter((p) => p.title.startsWith("You"));
    expect(end.find((p) => p.userId === seats[1].userId)!.title).toBe("You won (+16)");
    expect(end.find((p) => p.userId === seats[0].userId)!.title).toBe("You lost (-16)");
    expect(end.every((p) => p.url === `/scrabble/${id}`)).toBe(true);
  });

  test("live: the next player is pushed too, and challenges reach the people invited", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "scrabble:live");
    await clearPushes(t);
    await seats[0].as.mutation(api.scrabble.pass, { id });
    expect((await pushes(t)).map((p) => [p.userId, p.body])).toEqual([[seats[1].userId, "Your move."]]);

    const [a, b] = await crew(t, 2);
    await clearPushes(t);
    const cid = await a.as.mutation(api.matches.challenge, { mode: "scrabble:classic", opponents: [b.userId] });
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: b.userId, title: "Shlok challenged you", url: `/scrabble/${cid}?accept=1` })]);
  });
});

describe("plays the server refuses or records specially", () => {
  const bagOf = (t: T, id: Id<"matches">) =>
    t.run(async (ctx) => (await ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", undefined)).unique())!.data as { bag: string[]; nextId: number });
  const setBag = (t: T, id: Id<"matches">, bag: string[]) =>
    t.run(async (ctx) => {
      const row = await ctx.db.query("secrets").withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", undefined)).unique();
      await ctx.db.patch(row!._id, { data: { bag, nextId: 500 } });
    });

  test("the same tile on two squares is refused, and nothing changes", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "OTZZZZZ");
    const rack = await seats[0].as.query(api.scrabble.rack, { id });
    const before = await get(t, id);
    // TOO, with tile 0 (the only O) used for both Os.
    await expect(seats[0].as.mutation(api.scrabble.play, { id, tiles: [{ id: 1, x: 6, y: 7 }, { id: 0, x: 7, y: 7 }, { id: 0, x: 8, y: 7 }] })).rejects.toThrow("That tile is down twice.");
    expect(await seats[0].as.query(api.scrabble.rack, { id })).toEqual(rack);
    expect(await get(t, id)).toEqual(before);
    expect(await stateOf(t, id)).toMatchObject({ scores: [0, 0], tiles: [], turn: 0 });
  });

  test("swapping more tiles than the bag holds is refused, and the rack stays as it was", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "QQQAEIO");
    await setBag(t, id, ["E", "S"]);
    const rack = await seats[0].as.query(api.scrabble.rack, { id });
    await expect(seats[0].as.mutation(api.scrabble.swap, { id, tileIds: [0, 1, 2] })).rejects.toThrow("Only 2 left in the bag.");
    expect(await seats[0].as.query(api.scrabble.rack, { id })).toEqual(rack);
    expect((await bagOf(t, id)).bag).toEqual(["E", "S"]);
    expect(await stateOf(t, id)).toMatchObject({ turn: 0, scoreless: 0, moves: [] });
    await setBag(t, id, []);
    await expect(seats[0].as.mutation(api.scrabble.swap, { id, tileIds: [0] })).rejects.toThrow("The bag is empty.");
    expect(await seats[0].as.query(api.scrabble.rack, { id })).toEqual(rack);
    // As many as the bag holds is fine.
    await setBag(t, id, ["E", "S"]);
    await seats[0].as.mutation(api.scrabble.swap, { id, tileIds: [0, 1] });
    expect((await seats[0].as.query(api.scrabble.rack, { id }))!.map((x) => x.letter).sort()).toEqual(["A", "E", "E", "I", "O", "Q", "S"]);
  });

  test("a blank is stored with the letter it stands for, and the whole rack down is a bingo worth 50 more", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await setRack(t, id, seats[0].userId, "?ETAINS");
    // RETAINS through the star, the blank as R: (0 + 1 + 1 + 1 + 1 + 1 + 1) x 2 + 50.
    const tiles = lay("RETAINS", 4, 7).map((p) => (p.id === 0 ? { ...p, letter: "r" } : p));
    expect(await seats[0].as.mutation(api.scrabble.play, { id, tiles })).toBe(62);
    const s = await stateOf(t, id);
    expect(s.tiles.map((x) => [x.letter, x.blank ?? false])).toEqual([["R", true], ["E", false], ["T", false], ["A", false], ["I", false], ["N", false], ["S", false]]);
    expect(s.tiles[0]).toEqual({ x: 4, y: 7, letter: "R", blank: true, seat: 0, turn: 0 });
    expect(s.scores).toEqual([62, 0]);
    expect(s.moves.at(-1)).toMatchObject({ seat: 0, kind: "play", score: 62, bingo: true, count: 7, words: [{ word: "RETAINS", score: 12 }] }); // the word itself, the 50 on top
    expect(s.racks).toEqual([7, 7]);
    // A blank with no letter picked is refused.
    await setRack(t, id, seats[1].userId, "?TZZZZZ");
    await expect(seats[1].as.mutation(api.scrabble.play, { id, tiles: [{ id: 0, x: 4, y: 8 }] })).rejects.toThrow("Pick a letter for your blank.");
  });
});
