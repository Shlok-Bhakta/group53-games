import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { setup, signedIn } from "../test.setup";
import { REMIND_MS } from "../wordle";
import type { Mine, WordleState } from "./engine";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
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
const stateOf = async (t: T, id: Id<"matches">) => (await get(t, id))!.state as WordleState;
const word = (t: T, id: Id<"matches">) => t.query(internal.testing.wordleWord, { id });

async function game(t: T, n = 2, settings?: Record<string, number>) {
  vi.stubEnv("ALLOW_TEST_HELPERS", "1");
  const names = ["Shlok", "Chris", "Sam", "Alex", "Boiler", "Jump", "Kai", "Mo"];
  const players: Player[] = [];
  for (let i = 0; i < n; i++) players.push(await signedIn(t, names[i]));
  const id = await players[0].as.mutation(api.matches.queue, { mode: "wordle:classic", settings });
  for (const p of players.slice(1)) await p.as.mutation(api.matches.queue, { mode: "wordle:classic" });
  if ((await get(t, id))!.status === "waiting") await players[0].as.mutation(api.matches.startGame, { id });
  const m = (await get(t, id))!;
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  return { id, players, seats };
}

async function solve(t: T, id: Id<"matches">, p: Player) {
  const s = await stateOf(t, id);
  const seat = (await get(t, id))!.players.findIndex((x) => x.userId === p.userId);
  return await p.as.mutation(api.wordle.guess, { id, word: await word(t, id), row: s.players[seat].rows });
}

async function miss(t: T, id: Id<"matches">, p: Player) {
  const answer = await word(t, id);
  const wrong = ["pious", "ghost", "flame", "brick", "shard", "dumpy", "crane", "slate"].filter((w) => w !== answer);
  for (let r = 0; r < 6; r++) {
    const s = await stateOf(t, id);
    const seat = (await get(t, id))!.players.findIndex((x) => x.userId === p.userId);
    if (s.players[seat].done) return;
    await p.as.mutation(api.wordle.guess, { id, word: wrong[r], row: s.players[seat].rows });
  }
}

const pass = (id: Id<"matches">, p: Player, round: number) => p.as.mutation(api.wordle.pick, { id, round, item: null });

describe("PvP Wordle on the server", () => {
  test("starting deals one secret word list, waits on everyone and tells them", async () => {
    const t = setup();
    const { id, players } = await game(t, 3);
    const m = (await get(t, id))!;
    const s = m.state as WordleState;
    expect(m.status).toBe("active");
    expect(m.turn).toBeUndefined();
    expect(new Set(m.waitingOn)).toEqual(new Set(players.map((p) => p.userId)));
    expect(s.round).toBe(0);
    expect(s.deadline! - Date.now(), "a day per word by default").toBeGreaterThan(24 * 3600_000 - 1000);
    const answer = await word(t, id);
    expect(JSON.stringify(m.state)).not.toContain(answer);
    const titles = (await pushes(t)).map((p) => p.title);
    expect(titles.filter((x) => x === "PvP Wordle is on")).toHaveLength(3);
    for (const p of players) expect((await p.as.query(api.matches.attention, {})).myTurn).toBe(1);
  });

  test("a guess is scored, kept secret, and refused when stale", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    const [a, b] = seats;
    const r = await a.as.mutation(api.wordle.guess, { id, word: "pious", row: 0 });
    expect(r.marks).toMatch(/^[012]{5}$/);
    await expect(a.as.mutation(api.wordle.guess, { id, word: "ghost", row: 0 })).rejects.toThrow(/changed/);
    await expect(a.as.mutation(api.wordle.guess, { id, word: "zzzzz", row: 1 })).rejects.toThrow(/word list/);
    const mine = await a.as.query(api.wordle.board, { id });
    expect(mine!.rows).toEqual([{ letters: "pious", marks: r.marks }]);
    const theirs = await b.as.query(api.wordle.board, { id });
    expect(theirs!.rows).toEqual([]);
    expect(theirs!.others, "colors stay hidden until you're done").toEqual([null, null]);
    expect(JSON.stringify((await get(t, id))!.state)).not.toContain("pious");
  });

  test("others see someone typing, and their colors once they're done themselves", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    const [a, b] = seats;
    await a.as.mutation(api.wordle.typing, { id, letters: 3 });
    expect((await b.as.query(api.wordle.board, { id }))!.typing).toEqual([{ seat: 0, letters: 3 }]);
    await a.as.mutation(api.wordle.guess, { id, word: "pious", row: 0 });
    expect((await b.as.query(api.wordle.board, { id }))!.typing, "a guess clears it").toEqual([]);
    await solve(t, id, b);
    const view = (await b.as.query(api.wordle.board, { id }))!;
    expect(view.others[0]).toHaveLength(1);
    expect(view.others[1]).toBeNull();
  });

  test("the last pick closes the word, pays out the shop and pushes the hits", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    const [a, b, c] = seats;
    for (const p of seats) await solve(t, id, p);
    await t.mutation(internal.testing.wordlePatch, { id, players: [{ coins: 3 }, { coins: 30 }, { coins: 30 }] });
    const s0 = await stateOf(t, id);
    const item = s0.stock.find((x) => x.item !== "shield" && x.item !== "hint" && x.item !== "extra")!.item;
    await expect(a.as.mutation(api.wordle.pick, { id, round: 0, item: "fog", target: 1 })).rejects.toThrow(/./);
    await b.as.mutation(api.wordle.pick, { id, round: 0, item, target: 0 });
    await c.as.mutation(api.wordle.pick, { id, round: 0, item, target: 0 });
    await clearPushes(t);
    await pass(id, a, 0);
    const s = await stateOf(t, id);
    expect(s.round).toBe(1);
    expect(s.history[0].boards.every((x) => x.won)).toBe(true);
    const got = s.history[0].buys.filter((x) => x.got);
    expect(got.length, "one in stock with three players").toBe(1);
    const sent = await pushes(t);
    const toA = sent.find((p) => p.userId === a.userId)!;
    expect(toA.title).toBe("Word 2 is up");
    expect(toA.body, "the hit, not the score").not.toMatch(/You've solved/);
    const loser = s.history[0].buys.find((x) => !x.got)!;
    expect(sent.find((p) => p.userId === seats[loser.seat].userId)!.body).toMatch(/sold out/);
    const m = (await get(t, id))!;
    expect(m.waitingOn).toHaveLength(3);
    expect(await pass(id, a, 0).catch((e: Error) => e.message)).toMatch(/closed/);
  });

  test("a shop pick can be changed until the shop closes", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    const [a, b] = seats;
    for (const p of seats) await solve(t, id, p);
    await a.as.mutation(api.wordle.pick, { id, round: 0, item: null });
    const s = await stateOf(t, id);
    const cheap = s.stock.find((x) => !["fog", "fuse", "jam", "pickpocket", "dark"].includes(x.item))?.item;
    if (cheap) await a.as.mutation(api.wordle.pick, { id, round: 0, item: cheap });
    expect((await a.as.query(api.wordle.board, { id }))!.pick).toEqual(cheap ? { item: cheap, target: 0 } : null);
    expect((await b.as.query(api.wordle.board, { id }))!.pick, "only my own pick comes back").toBeNull();
  });

  test("the deadline closes the word for whoever isn't done", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, { wordTime: 12 });
    await solve(t, id, seats[0]);
    await pass(id, seats[0], 0);
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(12 * 3600_000 + 1000);
    await t.finishInProgressScheduledFunctions();
    const s = await stateOf(t, id);
    expect(s.round).toBe(1);
    expect(s.history[0].boards[1].won).toBe(false);
  });

  test("reminders go to whoever the word is waiting on", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, { wordTime: 0 });
    await solve(t, id, seats[0]);
    await pass(id, seats[0], 0);
    await clearPushes(t);
    vi.advanceTimersByTime(REMIND_MS + 1000);
    await t.finishInProgressScheduledFunctions();
    const sent = await pushes(t);
    expect(sent.map((p) => p.userId)).toEqual([seats[1].userId]);
    expect(sent[0].title).toBe("Word 1 is waiting");
  });

  test("resigning in a two-player game ends it; in a bigger one the word stops waiting on them", async () => {
    const t = setup();
    const two = await game(t, 2);
    await two.seats[1].as.mutation(api.matches.resign, { id: two.id });
    expect((await get(t, two.id))!.result).toMatchObject({ reason: "resign", winners: [two.seats[0].userId] });

    const t3 = setup();
    const three = await game(t3, 3);
    for (const p of three.seats.slice(0, 2)) {
      await solve(t3, three.id, p);
      await pass(three.id, p, 0);
    }
    await three.seats[2].as.mutation(api.matches.resign, { id: three.id });
    const s = await stateOf(t3, three.id);
    expect(s.round).toBe(1);
    expect(s.players[2].out).toBe(true);
    expect((await get(t3, three.id))!.waitingOn).not.toContain(three.seats[2].userId);
  });

  test("a whole game: first to the goal wins with standings in words", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, { goal: 3, shop: 0 });
    for (let r = 0; r < 3; r++) {
      await solve(t, id, seats[0]);
      if (r === 0) await miss(t, id, seats[1]);
      else await solve(t, id, seats[1]);
    }
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result).toMatchObject({ reason: "words", winners: [seats[0].userId] });
    expect(m.waitingOn).toBeUndefined();
    const s = m.state as WordleState;
    expect(s.history).toHaveLength(3);
    const board = (await seats[1].as.query(api.wordle.board, { id }))!;
    expect(board.others[0], "everything shows once it's over").toHaveLength(1);
  });

  test("the link preview shows only finished words", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await seats[0].as.mutation(api.wordle.guess, { id, word: "pious", row: 0 });
    const p = (await t.query(internal.previews.match, { id }))! as unknown as { wordle: { last: unknown; rows: number[] } };
    expect(p.wordle.last).toBeNull();
    expect(p.wordle.rows).toEqual([1, 0]);
    const secrets = await t.run((ctx) => ctx.db.query("secrets").collect());
    const mine = secrets.find((x) => x.userId === seats[0].userId)!.data as Mine;
    expect(JSON.stringify(p)).not.toContain(mine.guesses[0]);
  });
});
