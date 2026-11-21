import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { setup, signedIn } from "../test.setup";
import type { UnoState } from "./engine";

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
const stateOf = async (t: T, id: Id<"matches">) => (await get(t, id))!.state as UnoState;

async function game(t: T, n = 2, settings?: Record<string, number>, mode = "uno:classic") {
  vi.stubEnv("ALLOW_TEST_HELPERS", "1");
  const names = ["Shlok", "Chris", "Sam", "Alex", "Boiler", "Jump", "Kai", "Mo"];
  const players: Player[] = [];
  for (let i = 0; i < n; i++) players.push(await signedIn(t, names[i]));
  const id = await players[0].as.mutation(api.matches.queue, { mode, settings });
  for (const p of players.slice(1)) await p.as.mutation(api.matches.queue, { mode });
  if ((await get(t, id))!.status === "waiting") await players[0].as.mutation(api.matches.startGame, { id });
  const m = (await get(t, id))!;
  const seats = m.players.map((s) => players.find((p) => p.userId === s.userId)!);
  const named = seats.map((p) => names[players.indexOf(p)]);
  return { id, players, seats, named };
}

const deal = (t: T, id: Id<"matches">, hands: string[][], top: string, extra: { turn?: number; deck?: string[]; patch?: object } = {}) =>
  t.mutation(internal.testing.unoDeal, { id, hands, top, ...extra });

async function play(
  p: Player,
  id: Id<"matches">,
  t: T,
  card: string,
  more: { color?: "r" | "y" | "g" | "b"; target?: number; uno?: boolean } = {},
) {
  const s = await stateOf(t, id);
  return await p.as.mutation(api.uno.move, { id, seq: s.seq, kind: "play", card, uno: true, ...more });
}

describe("Uno on the server", () => {
  test("starting deals secret hands, gives someone the turn and tells everyone", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    const m = (await get(t, id))!;
    const s = m.state as UnoState;
    expect(m.status).toBe("active");
    expect(s.counts).toEqual([7, 7, 7]);
    expect(m.turn).toBe(m.players[s.turn].userId);
    const mine = await seats[0].as.query(api.uno.hand, { id });
    expect(mine!.cards).toHaveLength(7);
    expect(JSON.stringify(m.state)).not.toContain(JSON.stringify(mine!.cards));
    const titles = (await pushes(t)).map((p) => p.title);
    expect(titles.filter((x) => x === "Uno is on")).toHaveLength(3);
    const preview = JSON.stringify(await t.query(internal.previews.match, { id }));
    expect(preview).not.toContain(JSON.stringify(mine!.cards));
  });

  test("a play moves the turn, pushes the next player, and stale or off-turn taps are refused", async () => {
    const t = setup();
    const { id, seats, named } = await game(t, 3);
    const [a, b, c] = seats;
    await deal(
      t,
      id,
      [
        ["r5", "b2", "y3"],
        ["r6", "g1"],
        ["y9", "y1"],
      ],
      "r9",
      { turn: 0 },
    );
    await clearPushes(t);
    const seq = (await stateOf(t, id)).seq;
    await expect(b.as.mutation(api.uno.move, { id, seq, kind: "play", card: "r6" })).rejects.toThrow(/not your turn/);
    await a.as.mutation(api.uno.move, { id, seq, kind: "play", card: "r5" });
    await expect(a.as.mutation(api.uno.move, { id, seq, kind: "draw" })).rejects.toThrow(/changed/);
    const s = await stateOf(t, id);
    expect(s.turn).toBe(1);
    expect(s.top).toBe("r5");
    expect((await b.as.query(api.uno.hand, { id }))!.cards).toEqual(["r6", "g1"]);
    const p = (await pushes(t)).find((x) => x.userId === b.userId)!;
    expect(p.title).toBe(`${named[0]} played Red 5`);
    expect(p.body).toBe("Red 5 on top. You have 2 cards.");
    expect((await pushes(t)).some((x) => x.userId === c.userId)).toBe(false);
  });

  test("drawing shows the drawn card only to its owner, and keeping it passes", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    const [a, b] = seats;
    await deal(t, id, [["b1"], ["g2"]], "r9", { turn: 0, deck: ["y1", "r3"] });
    await a.as.mutation(api.uno.move, { id, seq: (await stateOf(t, id)).seq, kind: "draw" });
    expect((await a.as.query(api.uno.hand, { id }))!.drawn).toBe("r3");
    expect((await b.as.query(api.uno.hand, { id }))!.drawn).toBeNull();
    await a.as.mutation(api.uno.move, { id, seq: (await stateOf(t, id)).seq, kind: "pass" });
    expect((await stateOf(t, id)).turn).toBe(1);
  });

  test("forgetting UNO pushes the others, and catching it costs two", async () => {
    const t = setup();
    const { id, seats, named } = await game(t, 3);
    const [a, b, c] = seats;
    await deal(
      t,
      id,
      [
        ["r5", "b2"],
        ["r6", "g1"],
        ["y9", "y1"],
      ],
      "r9",
      { turn: 0 },
    );
    await clearPushes(t);
    await play(a, id, t, "r5", { uno: false });
    expect((await stateOf(t, id)).forgot).toBe(0);
    const forgot = (await pushes(t)).filter((p) => p.title === `${named[0]} forgot to call UNO`).map((p) => p.userId);
    expect(forgot).toContain(c.userId);
    const turnPush = (await pushes(t)).find((p) => p.userId === b.userId)!;
    expect(turnPush.title, "the next player hears about it too").toBe(`${named[0]} forgot to call UNO`);
    await clearPushes(t);
    const moveCount = (await get(t, id))!.moveCount;
    const seen = (await stateOf(t, id)).seq;
    await expect(c.as.mutation(api.uno.move, { id, seq: seen - 1, kind: "catch", target: 0 }), "a stale catch").rejects.toThrow(/changed/);
    await c.as.mutation(api.uno.move, { id, seq: seen, kind: "catch", target: 0 });
    const s = await stateOf(t, id);
    expect(s.counts[0]).toBe(3);
    expect(s.turn).toBe(1);
    expect((await get(t, id))!.moveCount, "a catch off turn leaves the turn's clock alone").toBe(moveCount);
    expect((await pushes(t)).find((p) => p.userId === a.userId)!.title).toBe(`${named[2]} caught you without UNO`);
  });

  test("a 7 swaps hands and tells who you swapped with", async () => {
    const t = setup();
    const { id, seats, named } = await game(t, 3, { sevenZero: 1 });
    const [a, , c] = seats;
    await deal(t, id, [["r7", "b2", "b3"], ["r6", "g1"], ["y9"]], "r9", { turn: 0 });
    await clearPushes(t);
    await play(a, id, t, "r7", { target: 2 });
    expect((await a.as.query(api.uno.hand, { id }))!.cards).toEqual(["y9"]);
    expect((await c.as.query(api.uno.hand, { id }))!.cards).toEqual(["b2", "b3"]);
    expect((await pushes(t)).find((p) => p.userId === c.userId)!.title).toBe(`${named[0]} swapped hands with you`);
  });

  test("jump-in lets someone off turn play the same card", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3, { jumpIn: 1 });
    const [, , c] = seats;
    await deal(
      t,
      id,
      [
        ["b2", "b3"],
        ["r6", "g1"],
        ["r9", "y1"],
      ],
      "r9",
      { turn: 0 },
    );
    await play(c, id, t, "r9");
    const s = await stateOf(t, id);
    expect(s.turn).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ kind: "jump", seat: 2 });
  });

  test("going out finishes the game with the winner first", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    const [a] = seats;
    await deal(t, id, [["r1"], ["b5", "wW"], ["y9"]], "r9", { turn: 0 });
    await play(a, id, t, "r1");
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result?.reason).toBe("out");
    expect(m.result?.winners).toEqual([a.userId]);
    expect(m.result?.standings?.[1]).toEqual([m.players[2].userId]);
  });

  test("a points game deals the next hand and pushes the hand result", async () => {
    const t = setup();
    const { id, seats, named } = await game(t, 2, { goal: 250 });
    const [a, b] = seats;
    await deal(t, id, [["r1"], ["b5", "wW"]], "r9", { turn: 0 });
    await clearPushes(t);
    await play(a, id, t, "r1");
    const s = await stateOf(t, id);
    expect((await get(t, id))!.status).toBe("active");
    expect(s.hand).toBe(2);
    expect(s.scores).toEqual([55, 0]);
    expect((await pushes(t)).find((p) => p.userId === b.userId)!.title).toBe(`${named[0]} won hand 1`);
  });

  test("No Mercy's roulette makes the next player spin", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2, undefined, "uno:nomercy");
    const [a, b] = seats;
    await deal(t, id, [["wWC", "r1"], ["b5"]], "r9", { turn: 0, deck: ["g1", "b4", "y2"] });
    await play(a, id, t, "wWC");
    expect((await stateOf(t, id)).pending).toEqual({ kind: "roulette", by: 0 });
    await b.as.mutation(api.uno.move, { id, seq: (await stateOf(t, id)).seq, kind: "roulette", color: "b" });
    expect((await b.as.query(api.uno.hand, { id }))!.cards).toEqual(["b5", "y2", "b4"]);
    expect((await stateOf(t, id)).color).toBe("b");
  });

  test("running out of time draws for you, three in a row and you're out", async () => {
    const t = setup();
    const { id, seats } = await game(t, 3);
    await deal(t, id, [["b1"], ["g2"], ["y3"]], "r9", { turn: 0, deck: Array(30).fill("g5") });
    for (let k = 0; k < 3; k++) {
      const m = (await get(t, id))!;
      const seat = (m.state as UnoState).turn;
      if (seat !== 0) {
        await deal(t, id, [["b1", ...Array(k).fill("g5")], ["g2"], ["y3"]], "r9", { turn: 0, deck: Array(30).fill("g5") });
      }
      const now = (await get(t, id))!;
      await t.mutation(internal.matches.remind, { id, moveCount: now.moveCount, strikes: 2 });
    }
    const s = await stateOf(t, id);
    expect(s.out.some((o) => o.seat === 0 && o.reason === "idle")).toBe(true);
    expect((await pushes(t)).some((p) => p.userId === seats[0].userId && p.title === "You're out of the game")).toBe(true);
  });

  test("resigning heads-up hands the other player the win", async () => {
    const t = setup();
    const { id, seats } = await game(t, 2);
    const [a, b] = seats;
    await a.as.mutation(api.matches.resign, { id });
    const m = (await get(t, id))!;
    expect(m.status).toBe("finished");
    expect(m.result?.winners).toEqual([b.userId]);
    expect(m.result?.reason).toBe("resign");
  });
});
