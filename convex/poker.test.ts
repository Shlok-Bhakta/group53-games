import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { setup, signedIn } from "./test.setup";
import type { PokerState } from "./poker/engine";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
type Player = Awaited<ReturnType<typeof signedIn>>;
type Mode = "poker:holdem" | "poker:omaha" | "poker:short" | "poker:draw";

const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pushes = async (t: T) =>
  (await scheduled(t)).filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending").map((s) => s.args[0] as { userId: Id<"users">; title: string; body: string; url: string });
const clearPushes = (t: T) =>
  t.run(async (ctx) => {
    for (const s of await ctx.db.system.query("_scheduled_functions").collect()) if (s.name === "push:sendToUser" && s.state.kind === "pending") await ctx.scheduler.cancel(s._id);
  });
const get = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.get(id));
const stateOf = async (t: T, id: Id<"matches">) => (await get(t, id))!.state as PokerState;

async function game(t: T, n = 2, mode: Mode = "poker:holdem", settings?: Record<string, number>) {
  const names = ["Shlok", "Chris", "Sam", "Alex"];
  const players: Player[] = [];
  for (let i = 0; i < n; i++) players.push(await signedIn(t, names[i]));
  const id = await players[0].as.mutation(api.matches.queue, { mode, settings });
  for (const p of players.slice(1)) await p.as.mutation(api.matches.queue, { mode });
  await players[0].as.mutation(api.matches.startGame, { id });
  const m = (await get(t, id))!;
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  return { id, players, seats };
}

// The player whose turn it is, and a move for them on the hand and street they see.
async function up(t: T, id: Id<"matches">, seats: Player[]) {
  const s = await stateOf(t, id);
  const p = seats[s.turn];
  return { s, p, move: (kind: "fold" | "check" | "call" | "raise" | "draw", extra: { to?: number; discard?: number[] } = {}) => p.as.mutation(api.poker.move, { id, hand: s.hand, street: s.street, kind, ...extra }) };
}

describe("starting", () => {
  test("deals everyone in, posts the blinds and keeps the cards private", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    const m = (await get(t, id))!;
    expect(m.status).toBe("active");
    expect(m.players.map((p) => p.color)).toEqual(["red", "blue", "yellow"]);
    const s = m.state as PokerState;
    expect(s).toMatchObject({ kind: "poker", variant: "holdem", limit: "nl", hand: 1, button: 0, sb: 10, bb: 20, bets: [0, 10, 20], turn: 0, board: [] });
    expect(m.turn).toBe(seats[0].userId);
    // Nothing hidden in the public state.
    expect(JSON.stringify(s)).not.toMatch(/"[2-9TJQKA][shdc]"/);
    const mine = await seats[0].as.query(api.poker.cards, { id });
    expect(mine).toMatchObject({ hand: 1 });
    expect(mine!.cards).toHaveLength(2);
    const theirs = await seats[1].as.query(api.poker.cards, { id });
    expect(theirs!.cards).not.toEqual(mine!.cards);
    expect((await pushes(t)).map((p) => [p.userId, p.title, p.body])).toEqual(
      expect.arrayContaining([
        [seats[0].userId, "Texas Hold'em is on", "You're first to act. 20 to call, 30 in the pot."],
        [seats[1].userId, "Texas Hold'em is on", `${await t.run(async (ctx) => (await ctx.db.get(seats[0].userId))!.name)} is first to act.`],
      ]),
    );
  });

  test("settings: stack, pot limit and Omaha's four cards", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "poker:omaha", { stack: 2000 });
    const s = await stateOf(t, id);
    expect(s).toMatchObject({ variant: "omaha", limit: "pl", sb: 20, bb: 40 });
    expect((await seats[0].as.query(api.poker.cards, { id }))!.cards).toHaveLength(4);
  });
});

describe("playing", () => {
  test("moves pass the action on and push whoever's next", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await clearPushes(t);
    let u = await up(t, id, seats);
    await expect(seats[1].as.mutation(api.poker.move, { id, hand: 1, street: 0, kind: "check" })).rejects.toThrow("not your turn");
    await u.move("raise", { to: 60 });
    expect((await pushes(t)).map((p) => [p.userId, p.title, p.body])).toEqual([[seats[1].userId, `${await t.run(async (ctx) => (await ctx.db.get(seats[0].userId))!.name)} raised to 60`, "40 to call, 80 in the pot."]]);
    u = await up(t, id, seats);
    await u.move("call");
    const s = await stateOf(t, id);
    expect(s.street).toBe(1);
    expect(s.board).toHaveLength(3);
    // A tap from the street before is refused.
    u = await up(t, id, seats);
    await expect(u.p.as.mutation(api.poker.move, { id, hand: 1, street: 0, kind: "check" })).rejects.toThrow("moved on");
  });

  test("folding ends the hand and the next one is dealt straight away", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    const u = await up(t, id, seats);
    await clearPushes(t);
    await u.move("fold");
    const s = await stateOf(t, id);
    expect(s.hand).toBe(2);
    expect(s.button).toBe(1);
    expect(s.last).toMatchObject({ hand: 1, showdown: false });
    expect(s.stacks.reduce((a, b) => a + b, 0) + s.bets.reduce((a, b) => a + b, 0)).toBe(2000);
    expect((await seats[1].as.query(api.poker.cards, { id }))!.hand).toBe(2);
    const next = seats[s.turn];
    expect((await pushes(t)).find((p) => p.userId === next.userId)?.title).toBe("Hand 2: your move");
  });

  test("a lined-up move plays itself when the action arrives", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    // Seat 1 (small blind) lines up check/fold, seat 2 (big blind) lines up a call of 20 or less.
    await seats[1].as.mutation(api.poker.plan, { id, hand: 1, street: 0, kind: "checkfold" });
    await seats[2].as.mutation(api.poker.plan, { id, hand: 1, street: 0, kind: "call", amount: 20 });
    expect(await seats[1].as.query(api.poker.myPlan, { id })).toMatchObject({ kind: "checkfold", hand: 1, street: 0 });
    // Seat 0 calls: seat 1 has 10 to call, so its check/fold folds; seat 2 owes nothing, so it checks.
    await seats[0].as.mutation(api.poker.move, { id, hand: 1, street: 0, kind: "call" });
    const s = await stateOf(t, id);
    expect(s.folded).toEqual([false, true, false]);
    expect(s.street).toBe(1);
    expect(s.log.map((e) => [e.seat, e.kind])).toEqual([[1, "blind"], [2, "blind"], [0, "call"], [1, "fold"], [2, "check"]]);
    expect(await seats[1].as.query(api.poker.myPlan, { id })).toBeNull();
  });

  test("a plan that no longer fits waits for the player instead", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    await seats[1].as.mutation(api.poker.plan, { id, hand: 1, street: 0, kind: "call", amount: 10 });
    await seats[0].as.mutation(api.poker.move, { id, hand: 1, street: 0, kind: "raise", to: 100 });
    const s = await stateOf(t, id);
    expect(s.turn).toBe(1);
    expect(await seats[1].as.query(api.poker.myPlan, { id })).toBeNull();
  });

  test("a lined-up move from a hand that's already over is dropped", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    // The big blind taps Check/Fold for hand 1, but the button folds first and hand 2 is dealt.
    await (await up(t, id, seats)).move("fold");
    const s = await stateOf(t, id);
    expect(s.hand).toBe(2);
    const late = seats[s.turn];
    await late.as.mutation(api.poker.plan, { id, hand: 1, street: 0, kind: "checkfold" });
    const after = await stateOf(t, id);
    expect(after.turn).toBe(s.turn);
    expect(after.folded.every((f) => !f)).toBe(true);
    expect(await late.as.query(api.poker.myPlan, { id })).toBeNull();
  });

  test("when lined-up moves bring the action back round, the mover gets a push too", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    await seats[1].as.mutation(api.poker.plan, { id, hand: 1, street: 0, kind: "call", amount: 50 });
    await seats[2].as.mutation(api.poker.plan, { id, hand: 1, street: 0, kind: "call", amount: 50 });
    await clearPushes(t);
    await seats[0].as.mutation(api.poker.move, { id, hand: 1, street: 0, kind: "raise", to: 50 });
    // Both called for them, so it's the flop and seat 1 to act; nobody was left waiting on seat 0.
    const s = await stateOf(t, id);
    expect(s.street).toBe(1);
    expect((await pushes(t)).map((p) => p.userId)).toContain(seats[s.turn].userId);
  });

  test("five-card draw: swapping cards", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "poker:draw");
    let u = await up(t, id, seats);
    await u.move("call");
    u = await up(t, id, seats);
    await u.move("check");
    u = await up(t, id, seats);
    expect(u.s.street).toBe(1);
    const before = (await u.p.as.query(api.poker.cards, { id }))!.cards;
    await u.move("draw", { discard: [0, 1] });
    const after = (await u.p.as.query(api.poker.cards, { id }))!.cards;
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(after.slice(0, 2)).not.toEqual(before.slice(0, 2));
    expect((await stateOf(t, id)).drew[u.s.turn]).toBe(2);
  });
});

describe("ending", () => {
  test("after the last hand, places by chips", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, "poker:holdem", { hands: 5 });
    for (let i = 0; i < 5; i++) await (await up(t, id, seats)).move("fold");
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result!.reason).toBe("hands");
    const s = m.state as PokerState;
    expect(s.hand).toBe(5);
    const best = s.stacks[0] > s.stacks[1] ? 0 : 1;
    expect(m.result!.winners).toEqual([m.players[best].userId]);
    expect(m.ratingChanges).toHaveLength(2);
  });

  test("resigning in a three-way game folds you out and the rest play on", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    await seats[0].as.mutation(api.matches.resign, { id });
    let m = (await get(t, id))!;
    expect(m.status).toBe("active");
    let s = m.state as PokerState;
    expect(s.out).toEqual([{ seat: 0, hand: 1, reason: "resign", stack: 1000 }]);
    expect(s.turn).toBe(1);
    await seats[1].as.mutation(api.matches.resign, { id });
    m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result!.reason).toBe("last_player");
    expect(m.result!.standings).toEqual([[seats[2].userId], [seats[1].userId], [seats[0].userId]]);
    s = m.state as PokerState;
    expect(s.stacks[2]).toBe(1010);
  });

  test("heads-up, a resignation ends it as a resignation", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    await seats[1].as.mutation(api.matches.resign, { id });
    const m = (await get(t, id))!;
    expect(m.result).toMatchObject({ reason: "resign", winners: [seats[0].userId] });
  });

  test("three timeouts in a row take you off the table", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3, "poker:holdem", { moveTime: 24 });
    const absent = seats[0];
    // Seat 0 never moves; everyone else folds or checks to it whenever it's their turn.
    for (let i = 0; i < 40; i++) {
      const m = (await get(t, id))!;
      const s = m.state as PokerState;
      if (s.out.some((o) => o.seat === 0) || m.status !== "active") break;
      if (s.turn === 0) {
        for (let strikes = 0; strikes < 3; strikes++) await t.mutation(internal.matches.remind, { id, moveCount: m.moveCount, strikes });
      } else {
        const u = await up(t, id, seats);
        await u.move(s.current > s.bets[s.turn] ? "fold" : "check");
      }
    }
    const s = await stateOf(t, id);
    expect(s.out.map((o) => o.seat)).toEqual([0]);
    expect((await pushes(t)).some((p) => p.userId === absent.userId && p.title === "You've left the table")).toBe(true);
  });

  test("running out of time checks or folds for you", async () => {
    const t = setup();
    const { id } = await game(t, 2, "poker:holdem", { moveTime: 24 });
    const m = (await get(t, id))!;
    for (let strikes = 0; strikes < 3; strikes++) await t.mutation(internal.matches.remind, { id, moveCount: m.moveCount, strikes });
    const s = await stateOf(t, id);
    // The button had 10 to call, so it folded and the next hand is on.
    expect(s.hand).toBe(2);
    expect(s.last).toMatchObject({ hand: 1, showdown: false });
  });
});
