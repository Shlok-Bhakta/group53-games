import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { gameOf, matchPath, reasonOf, type ModeKey } from "./modes";
import { setup, signedIn } from "./test.setup";
import type { PokerState } from "./poker/engine";
import type { FourState } from "./chess";

// One test per bug fixed, so each stays fixed.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
type Player = Awaited<ReturnType<typeof signedIn>>;

const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pending = async (t: T, name: string) => (await scheduled(t)).filter((s) => s.name === name && s.state.kind === "pending").map((s) => s.args[0] as Record<string, unknown>);
const clearPushes = (t: T) =>
  t.run(async (ctx) => {
    for (const s of await ctx.db.system.query("_scheduled_functions").collect()) if (s.name === "push:sendToUser" && s.state.kind === "pending") await ctx.scheduler.cancel(s._id);
  });
const get = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.get(id));

async function crew(t: T, n: number) {
  const names = ["Shlok", "Chris", "Sam", "Alex"];
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await signedIn(t, names[i]));
  return out;
}

// Everyone queues into one game of `mode`; games the host starts are started. Seats in turn order.
async function game(t: T, mode: ModeKey, n: number) {
  const players = await crew(t, n);
  let id: Id<"matches"> | undefined;
  for (const p of players) id = await p.as.mutation(api.matches.queue, { mode });
  if ((await get(t, id!))!.status === "waiting") await players[0].as.mutation(api.matches.startGame, { id: id! });
  const m = (await get(t, id!))!;
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  return { id: id!, seats, match: m };
}

test("a live Scrabble game on my turn shows once on Home, under live", async () => {
  const t = setup();
  const { id, seats } = await game(t, "scrabble:live", 2);
  const inbox = (await seats[0].as.query(api.matches.inbox, {}))!;
  expect(inbox.live.map((m) => m._id)).toEqual([id]);
  expect(inbox.myTurn).toEqual([]);
});

describe("draws", () => {
  test("only modes that allow them take a draw offer", async () => {
    const t = setup();
    const scrabble = await game(t, "scrabble:classic", 2);
    await expect(scrabble.seats[0].as.mutation(api.matches.offerDraw, { id: scrabble.id })).rejects.toThrow("no draws");
    const t2 = setup();
    const poker = await game(t2, "poker:holdem", 2);
    await expect(poker.seats[0].as.mutation(api.matches.offerDraw, { id: poker.id })).rejects.toThrow("no draws");
  });

  test("real-time chess still takes them", async () => {
    const t = setup();
    const { id, seats } = await game(t, "chess:realtime", 2);
    await seats[0].as.mutation(api.matches.offerDraw, { id });
    await seats[1].as.mutation(api.matches.offerDraw, { id });
    expect((await get(t, id))!).toMatchObject({ status: "finished", result: { draw: true, reason: "agreement" } });
  });
});

describe("someone else resigning leaves the player to move on their clock", () => {
  test("poker", async () => {
    const t = setup();
    const { id, seats, match } = await game(t, "poker:holdem", 3);
    const s = match.state as PokerState;
    // Two reminders in: one strike off being acted for.
    await t.mutation(internal.matches.remind, { id, moveCount: match.moveCount, strikes: 0 });
    await t.mutation(internal.matches.remind, { id, moveCount: match.moveCount, strikes: 1 });
    await clearPushes(t);
    const reminders = (await pending(t, "matches:remind")).length;
    const other = seats.find((_, i) => i !== s.turn)!;
    await other.as.mutation(api.matches.resign, { id });
    const after = (await get(t, id))!;
    expect(after.turn).toBe(match.turn);
    expect(after.moveCount).toBe(match.moveCount);
    expect((await pending(t, "matches:remind")).length).toBe(reminders);
    expect((await pending(t, "push:sendToUser")).filter((p) => p.userId === match.turn)).toEqual([]);
    // The strike count carries on: the third reminder acts for them.
    await t.mutation(internal.matches.remind, { id, moveCount: match.moveCount, strikes: 2 });
    expect((await get(t, id))!.turn).not.toBe(match.turn);
  });

  test("poker: a resignation that ends the hand gives the next hand a fresh clock, even for the same player", async () => {
    const t = setup();
    const { id, seats, match } = await game(t, "poker:holdem", 3);
    const s = match.state as PokerState;
    // Hand 1: seat 0 has the button and acts first, and folds; seat 1 is up.
    expect(s.turn).toBe(0);
    await seats[0].as.mutation(api.poker.move, { id, hand: s.hand, street: s.street, kind: "fold" });
    const mid = (await get(t, id))!;
    expect((mid.state as PokerState).turn).toBe(1);
    await t.mutation(internal.matches.remind, { id, moveCount: mid.moveCount, strikes: 0 });
    await t.mutation(internal.matches.remind, { id, moveCount: mid.moveCount, strikes: 1 });
    await clearPushes(t);
    // Seat 2 resigns: seat 1 wins the hand, and is the button and first to act in the heads-up hand 2.
    await seats[2].as.mutation(api.matches.resign, { id });
    const after = (await get(t, id))!;
    const next = after.state as PokerState;
    expect(next.hand).toBe(2);
    expect(after.turn).toBe(mid.turn);
    expect(after.moveCount).toBe(mid.moveCount + 1);
    expect((await pending(t, "matches:remind")).filter((r) => r.moveCount === after.moveCount)).toEqual([expect.objectContaining({ strikes: 0 })]);
    expect((await pending(t, "push:sendToUser")).filter((p) => p.userId === after.turn)).toHaveLength(1);
  });

  test("four-player chess", async () => {
    const t = setup();
    const { id, seats, match } = await game(t, "chess:four", 4);
    const [red, blue] = seats;
    await clearPushes(t);
    const reminders = (await pending(t, "matches:remind")).length;
    await blue.as.mutation(api.matches.resign, { id });
    const after = (await get(t, id))!;
    expect((after.state as FourState).out).toEqual([{ color: "blue", reason: "resign", ply: 0 }]);
    expect(after.turn).toBe(red.userId);
    expect(after.moveCount).toBe(match.moveCount);
    expect((await pending(t, "matches:remind")).length).toBe(reminders);
    expect((await pending(t, "push:sendToUser")).filter((p) => p.userId === red.userId)).toEqual([]);
  });
});

test("queueing while my challenge waits opens a lobby instead of returning the challenge", async () => {
  const t = setup();
  const [a, b] = await crew(t, 2);
  const challenge = await a.as.mutation(api.matches.challenge, { mode: "chess:classic", opponent: b.userId });
  const lobby = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
  expect(lobby).not.toBe(challenge);
  expect((await get(t, lobby))!).toMatchObject({ status: "waiting", invited: [] });
  expect(await a.as.mutation(api.matches.queue, { mode: "chess:classic" })).toBe(lobby);
});

test("challenge no longer takes rematchOf", async () => {
  const t = setup();
  const [a, b] = await crew(t, 2);
  const args = { mode: "chess:classic", opponent: b.userId, rematchOf: undefined } as Record<string, unknown>;
  args.rematchOf = await t.run((ctx) => ctx.db.insert("matches", { mode: "chess:classic", status: "finished", createdBy: a.userId, players: [{ userId: a.userId }], invited: [], state: null, moveCount: 0, lastActivityAt: 0 }));
  await expect(a.as.mutation(api.matches.challenge, args as never)).rejects.toThrow();
});

test("Scrabble plans only touch Scrabble games", async () => {
  const t = setup();
  const { id, seats } = await game(t, "chess:classic", 2);
  await expect(seats[0].as.mutation(api.scrabble.saveDraft, { id, placed: [{ id: 0, x: 7, y: 7 }], order: [] })).rejects.toThrow("Wrong kind of game");
  await t.run((ctx) => ctx.db.insert("drafts", { matchId: id, userId: seats[1].userId, data: { placed: [{ id: 0, x: 1, y: 1 }] }, count: 1, at: 0 }));
  expect(await seats[0].as.query(api.scrabble.planning, { id })).toEqual([]);
});

test("an unknown mode has no game", () => {
  expect(() => gameOf("wordle:pvp")).toThrow("Unknown mode");
  expect(() => matchPath({ _id: "x", mode: "nope" })).toThrow("Unknown mode");
  expect(gameOf("poker:draw")).toBe("poker");
});

// Tables that moved from if-chains to per-game data.
describe("per-game tables", () => {
  test("endings read per game, with a mode's own wording first", () => {
    expect(reasonOf("fifty", "chess:four")).toEqual({ label: "Fifty quiet rounds", push: "fifty quiet rounds" });
    expect(reasonOf("fifty", "chess:classic")).toEqual({ label: "Fifty-move rule", push: "fifty-move rule" });
    expect(reasonOf("passes", "scrabble:live")).toEqual({ label: "Everyone passed twice", push: "everyone passed" });
    expect(reasonOf("resign", "poker:omaha").label).toBe("By resignation");
    expect(reasonOf("mystery", "poker:omaha")).toEqual({ label: "mystery", push: "mystery" });
  });

  test("link previews draw each game's board", async () => {
    const t = setup();
    const chess = await game(t, "chess:classic", 2);
    const scrabble = await game(t, "scrabble:classic", 2);
    const poker = await game(t, "poker:holdem", 2);
    const preview = (id: string) => t.query(internal.previews.match, { id });
    expect(await preview(chess.id)).toMatchObject({ mode: "chess:classic", status: "active", seats: 2, toMove: "w", result: null });
    expect(((await preview(chess.id)) as unknown as { board: string[][] }).board[0][4]).toBe("bK");
    expect(await preview(scrabble.id)).toMatchObject({ mode: "scrabble:classic", seats: 2, toMove: "red", scrabble: { size: 15, tiles: [], scores: [0, 0] } });
    expect(await preview(poker.id)).toMatchObject({ mode: "poker:holdem", seats: 2, poker: { hand: 1, pot: 30 } });
    expect(await preview("nope")).toBeNull();
    // A finished game's preview carries the phrase for "Chris won ...", from the game's own endings.
    await chess.seats[1].as.mutation(api.matches.resign, { id: chess.id });
    const winner = (await t.run((ctx) => ctx.db.get(chess.seats[0].userId)))!.name;
    expect(await preview(chess.id)).toMatchObject({ status: "finished", result: { draw: false, reason: "resign", how: "by resignation", winner } });
  });
});
