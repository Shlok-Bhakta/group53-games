import { describe, expect, test } from "vitest";
import { COLORS, deckOf, isWild, colorOf, type Card } from "./cards";
import { act, autoTurn, cantPlay, leave, newGame, standings, type Action, type Rules, type Table } from "./engine";
import { unoRules } from "./modes";

const CLASSIC = unoRules("uno:classic", {});
const NO_MERCY = unoRules("uno:nomercy", {});

function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
const rng = seeded(7);

function table(hands: Card[][], top: Card, rules: Partial<Rules> = {}, deck: Card[] = []): Table {
  const t = newGame(hands.length, { ...CLASSIC, ...rules }, rng);
  t.hidden.hands = hands.map((h) => [...h]);
  t.hidden.deck = deck.length ? [...deck] : Array<Card>(40).fill("g9");
  t.hidden.discard = [top];
  t.state.top = top;
  t.state.color = (isWild(top) ? "r" : colorOf(top)) as Table["state"]["color"];
  t.state.counts = hands.map((h) => h.length);
  t.state.turn = 0;
  t.state.dir = 1;
  return t;
}

const go = (t: Table, seat: number, a: Action) => act(t, seat, a, rng);
const play = (t: Table, seat: number, card: Card, extra: Partial<Extract<Action, { kind: "play" }>> = {}) =>
  go(t, seat, { kind: "play", card, uno: true, ...extra });

describe("the decks", () => {
  test("classic is 108 cards, No Mercy 168, and a double deck doubles it", () => {
    expect(deckOf("classic")).toHaveLength(108);
    expect(deckOf("nomercy")).toHaveLength(168);
    expect(deckOf("classic", 2)).toHaveLength(216);
    expect(deckOf("classic").filter((c) => c === "wW4")).toHaveLength(4);
    expect(deckOf("nomercy").filter((c) => c === "wW10")).toHaveLength(4);
    expect(deckOf("nomercy").filter((c) => c === "wWC")).toHaveLength(8);
  });

  test("a new game deals hands, keeps the deck secret and starts on a number", () => {
    for (let seed = 1; seed < 30; seed++) {
      const t = newGame(4, { ...CLASSIC, hand: 7 }, seeded(seed));
      expect(t.hidden.hands.map((h) => h.length)).toEqual([7, 7, 7, 7]);
      expect(t.state.counts).toEqual([7, 7, 7, 7]);
      expect(t.state.top).toMatch(/^[rygb][0-9]$/);
      expect(t.hidden.deck.length + 28 + 1).toBe(108);
      expect(JSON.stringify(t.state)).not.toContain("hands");
    }
  });
});

describe("playing", () => {
  test("match the color or the face; wilds always go and set the color", () => {
    const t = table([["r5", "b3", "g7", "wW"], ["y1"]], "r9");
    const hand = t.hidden.hands[0];
    expect(cantPlay(t.state, 0, "r5", hand, null)).toBeNull();
    expect(cantPlay(t.state, 0, "b3", hand, null)).toBe("That doesn't match.");
    expect(cantPlay(t.state, 0, "wW", hand, null)).toBeNull();
    expect(cantPlay(t.state, 1, "y1", t.hidden.hands[1], null)).toBe("It's not your turn.");
    expect(() => go(t, 0, { kind: "play", card: "wW" })).toThrow("Pick a color.");
    const after = play(t, 0, "wW", { color: "b" });
    expect(after.state.color).toBe("b");
    expect(after.state.turn).toBe(1);
    expect(after.state.counts[0]).toBe(3);
    expect(cantPlay(after.state, 1, "y1", after.hidden.hands[1], null)).toBe("That doesn't match.");
  });

  test("skip, reverse and reverse with two players", () => {
    const three = table([["r1", "rS", "rR"], ["r2"], ["r3"]], "r9");
    expect(play(three, 0, "rS").state.turn).toBe(2);
    const rev = play(three, 0, "rR");
    expect(rev.state.dir).toBe(-1);
    expect(rev.state.turn).toBe(2);
    const two = table([["r1", "rR", "r4"], ["r2"]], "r9");
    expect(play(two, 0, "rR").state.turn, "reverse skips with two").toBe(0);
  });

  test("a draw 2 makes the next player draw and lose their turn", () => {
    const t = table([["rD2", "r1"], ["b2"], ["b3"]], "r9");
    const after = play(t, 0, "rD2");
    expect(after.state.counts[1]).toBe(3);
    expect(after.state.turn).toBe(2);
  });

  test("going out wins the hand, scores the others' cards and ends a one-hand game", () => {
    const t = table([["r1"], ["wW", "b5", "rS"], ["y9"]], "r9");
    const after = play(t, 0, "r1");
    expect(after.state.over).toBe(true);
    expect(after.state.last).toMatchObject({ winner: 0, points: 50 + 5 + 20 + 9 });
    expect(standings(after.state)).toEqual([[0], [2], [1]]);
  });

  test("a draw card as the last card still deals its draw before scoring", () => {
    const t = table([["rD2"], ["b5"]], "r9", {}, ["y1", "y2", "y3"]);
    const after = play(t, 0, "rD2");
    expect(after.state.over).toBe(true);
    expect(after.state.last!.cards[1]).toBe(3);
  });

  test("a points game deals the next hand and moves who starts", () => {
    const t = table([["r1"], ["b5"], ["y9"]], "r9", { goal: 500 });
    const after = play(t, 0, "r1");
    expect(after.state.over).toBe(false);
    expect(after.state.hand).toBe(2);
    expect(after.state.scores).toEqual([14, 0, 0]);
    expect(after.state.counts).toEqual([7, 7, 7]);
    expect(after.state.turn).toBe(1);
  });

  test("no power finish refuses going out on an action or wild", () => {
    const t = table([["rS"], ["b5"]], "r9", { powerFinish: false });
    expect(cantPlay(t.state, 0, "rS", t.hidden.hands[0], null)).toBe("You can't go out on a power card.");
    const da = table([["rDA", "r3"], ["b5"]], "r9", { deck: "nomercy", powerFinish: false });
    expect(cantPlay(da.state, 0, "rDA", da.hidden.hands[0], null), "discard all that would empty the hand").toMatch(/power card/);
  });
});

describe("drawing", () => {
  test("draw one: a playable draw can be played or kept", () => {
    const t = table([["b1"], ["b2"]], "r9", {}, ["g4", "r7"]);
    const after = go(t, 0, { kind: "draw" });
    expect(after.state.drew).toBe(true);
    expect(after.hidden.drawn).toBe("r7");
    expect(cantPlay(after.state, 0, "b1", after.hidden.hands[0], after.hidden.drawn)).toMatch(/just drew/);
    expect(go(after, 0, { kind: "pass" }).state.turn).toBe(1);
    expect(play(after, 0, "r7").state.top).toBe("r7");
    expect(() => go(after, 0, { kind: "draw" })).toThrow(/already drew/);
  });

  test("draw one that can't be played passes the turn", () => {
    const t = table([["b1"], ["b2"]], "r9", {}, ["g4"]);
    const after = go(t, 0, { kind: "draw" });
    expect(after.state.drew).toBe(false);
    expect(after.state.turn).toBe(1);
  });

  test("draw until you can play keeps drawing and must play it", () => {
    const t = table([["b1"], ["b2"]], "r9", { drawUntil: true }, ["r7", "g4", "y3", "b8"]);
    const after = go(t, 0, { kind: "draw" });
    expect(after.state.counts[0]).toBe(5);
    expect(after.hidden.drawn).toBe("r7");
    expect(() => go(after, 0, { kind: "pass" })).toThrow(/Play the card/);
  });

  test("forced play refuses a draw when you can play", () => {
    const t = table([["r1"], ["b2"]], "r9", { forcePlay: true });
    expect(() => go(t, 0, { kind: "draw" })).toThrow(/have to play/);
  });

  test("an empty deck reshuffles the discards under the top card", () => {
    const t = table([["b1"], ["b2"]], "r9", {});
    t.hidden.deck = [];
    t.hidden.discard = ["g1", "g2", "r9"];
    const after = go(t, 0, { kind: "draw" });
    expect(after.hidden.discard).toEqual(["r9"]);
    expect(after.state.counts[0]).toBe(2);
  });
});

describe("stacking and challenges", () => {
  test("stacking same card passes the growing stack along", () => {
    const t = table(
      [
        ["rD2", "r1"],
        ["bD2", "b1"],
        ["y1", "y2"],
      ],
      "r9",
      { stack: 1, challenge: false },
    );
    const a = play(t, 0, "rD2");
    expect(a.state.pending).toMatchObject({ kind: "draw", amount: 2 });
    expect(() => go(a, 1, { kind: "draw" })).toThrow(/Take the cards or stack/);
    const b = play(a, 1, "bD2");
    expect(b.state.pending).toMatchObject({ amount: 4 });
    expect(b.state.turn).toBe(2);
    const c = go(b, 2, { kind: "take" });
    expect(c.state.counts[2]).toBe(6);
    expect(c.state.turn).toBe(0);
    expect(c.state.pending).toBeNull();
  });

  test("same or bigger lets a Draw 4 go on a Draw 2 but not back", () => {
    const t = table(
      [
        ["rD2", "r1"],
        ["wW4", "b1"],
        ["yD2", "y2"],
      ],
      "r9",
      { stack: 2, challenge: false },
    );
    const b = play(play(t, 0, "rD2"), 1, "wW4", { color: "y" });
    expect(b.state.pending).toMatchObject({ amount: 6, level: 4 });
    expect(cantPlay(b.state, 2, "yD2", b.hidden.hands[2], null)).toMatch(/Stack a draw card/);
    const same = table(
      [
        ["rD2", "r1"],
        ["wW4", "b1"],
      ],
      "r9",
      { stack: 1, challenge: false },
    );
    expect(cantPlay(play(same, 0, "rD2").state, 1, "wW4", ["wW4", "b1"], null)).toMatch(/Stack/);
  });

  test("a bluffed Wild Draw 4 caught by a challenge makes the bluffer draw", () => {
    const t = table(
      [
        ["wW4", "r1", "b2"],
        ["g1", "g2"],
      ],
      "r9",
      {},
      Array<Card>(20).fill("y5"),
    );
    const a = play(t, 0, "wW4", { color: "b" });
    expect(a.state.pending).toMatchObject({ kind: "draw", amount: 4, challenge: true });
    expect(JSON.stringify(a.state)).not.toContain("bluff");
    const b = go(a, 1, { kind: "challenge" });
    expect(b.state.counts[0]).toBe(6);
    expect(b.state.counts[1]).toBe(2);
    expect(b.state.turn, "the challenger plays on").toBe(1);
    expect(b.state.log.at(-1)).toMatchObject({ kind: "challenge", guilty: true });
  });

  test("an honest Wild Draw 4 costs the challenger six", () => {
    const t = table([["wW4", "b1", "b2"], ["g1", "g2"], ["y1"]], "r9");
    const b = go(play(t, 0, "wW4", { color: "b" }), 1, { kind: "challenge" });
    expect(b.state.counts[1]).toBe(8);
    expect(b.state.turn).toBe(2);
  });

  test("with challenges off a Wild Draw 4 lands at once", () => {
    const t = table([["wW4", "r1"], ["g1"], ["y1"]], "r9", { challenge: false });
    const b = play(t, 0, "wW4", { color: "b" });
    expect(b.state.pending).toBeNull();
    expect(b.state.counts[1]).toBe(5);
    expect(b.state.turn).toBe(2);
  });
});

describe("house rules", () => {
  test("a 7 swaps hands with who you pick, a 0 passes every hand along", () => {
    const t = table([["r7", "r1", "r2"], ["b1"], ["y1", "y2"]], "r9", { sevenZero: true });
    expect(() => play(t, 0, "r7")).toThrow(/swap/);
    const s = play(t, 0, "r7", { target: 2 });
    expect(s.hidden.hands[0]).toEqual(["y1", "y2"]);
    expect(s.hidden.hands[2]).toEqual(["r1", "r2"]);
    expect(s.state.log.at(-1)).toMatchObject({ kind: "swap", target: 2 });
    const z = play(table([["r0", "r1"], ["b1"], ["y1", "y2"]], "r9", { sevenZero: true }), 0, "r0");
    expect(z.hidden.hands).toEqual([["y1", "y2"], ["r1"], ["b1"]]);
  });

  test("jump-in plays the exact same card out of turn and the turn goes on from there", () => {
    const t = table([["r1", "r2"], ["b1"], ["r9", "y5"], ["g1"]], "r9", { jumpIn: true });
    expect(cantPlay(t.state, 2, "r9", t.hidden.hands[2], null)).toBeNull();
    expect(cantPlay(t.state, 1, "b1", t.hidden.hands[1], null)).toMatch(/exact same/);
    const j = play(t, 2, "r9");
    expect(j.state.turn).toBe(3);
    expect(j.state.log.at(-1)).toMatchObject({ kind: "jump", seat: 2 });
    const off = table([["r1"], ["r9"]], "r9");
    expect(cantPlay(off.state, 1, "r9", ["r9"], null)).toBe("It's not your turn.");
  });

  test("forgetting UNO can be caught for two, or saved by calling it late", () => {
    const t = table(
      [
        ["r1", "r2"],
        ["b1", "b2"],
        ["y1", "y2"],
      ],
      "r9",
    );
    const a = go(t, 0, { kind: "play", card: "r1" });
    expect(a.state.forgot).toBe(0);
    const caught = go(a, 2, { kind: "catch", seat: 0 });
    expect(caught.state.counts[0]).toBe(3);
    expect(caught.state.forgot).toBeNull();
    const saved = go(a, 0, { kind: "uno" });
    expect(saved.state.called[0]).toBe(true);
    expect(() => go(saved, 2, { kind: "catch", seat: 0 })).toThrow(/Too late/);
    const moved = go(a, 1, { kind: "draw" });
    expect(moved.state.forgot, "the next move closes the window").toBeNull();
    expect(play(t, 0, "r1").state.called[0]).toBe(true);
  });

  test("the mercy rule knocks out whoever reaches the limit", () => {
    const t = table([["rD2", "r3"], ["b1"], ["y1"]], "r9", { mercy: 3 });
    const a = play(t, 0, "rD2");
    expect(a.state.out).toEqual([{ seat: 1, hand: 1, reason: "mercy" }]);
    expect(a.state.counts[1]).toBe(0);
    expect(a.state.turn).toBe(2);
    const b = go(a, 2, { kind: "draw" });
    expect(b.state.turn).toBe(0);
  });

  test("last one standing after the mercy rule wins the hand with 250 a knockout", () => {
    const t = table([["rD2", "r3"], ["b1"]], "r9", { mercy: 3 });
    const a = play(t, 0, "rD2");
    expect(a.state.over).toBe(true);
    expect(a.state.last).toMatchObject({ winner: 0, knockouts: 1, points: 250 });
    expect(standings(a.state)).toEqual([[0], [1]]);
  });
});

describe("No Mercy", () => {
  test("stacks equal or bigger, Wild Reverse Draw 4 turns the stack around", () => {
    const t = table(
      [
        ["rD2", "r1"],
        ["wW6", "b1"],
        ["wWR4", "y1"],
        ["g1", "g2"],
      ],
      "r9",
      NO_MERCY,
    );
    const a = play(play(t, 0, "rD2"), 1, "wW6", { color: "y" });
    expect(cantPlay(a.state, 2, "wWR4", a.hidden.hands[2], null)).toMatch(/Stack/);
    const t2 = table([["rD2", "r1"], ["wWR4", "b1"], ["y1"], ["g1", "g2"]], "r9", NO_MERCY);
    const b = play(play(t2, 0, "rD2"), 1, "wWR4", { color: "g" });
    expect(b.state.dir).toBe(-1);
    expect(b.state.turn).toBe(0);
    expect(b.state.pending).toMatchObject({ amount: 6 });
  });

  test("skip everyone plays again, discard all drops the color", () => {
    const t = table([["rSA", "r1", "b2"], ["b1"], ["y1"]], "r9", NO_MERCY);
    expect(play(t, 0, "rSA").state.turn).toBe(0);
    const d = play(table([["rDA", "r1", "r4", "b2"], ["b1"]], "r9", NO_MERCY), 0, "rDA");
    expect(d.hidden.hands[0]).toEqual(["b2"]);
    expect(d.state.top).toBe("rDA");
  });

  test("color roulette makes the next player pick a color and flip till they find it", () => {
    const t = table([["wWC", "r1"], ["b1"], ["y1"]], "r9", NO_MERCY, ["g2", "b7", "wW6", "y1"]);
    const a = play(t, 0, "wWC");
    expect(a.state.pending).toEqual({ kind: "roulette", by: 0 });
    expect(a.state.turn).toBe(1);
    expect(() => go(a, 1, { kind: "draw" })).toThrow(/roulette/);
    const b = go(a, 1, { kind: "roulette", color: "b" });
    expect(b.hidden.hands[1]).toEqual(["b1", "y1", "wW6", "b7"]);
    expect(b.state.color).toBe("b");
    expect(b.state.turn).toBe(2);
  });
});

describe("leaving and timeouts", () => {
  test("resigning on your turn moves the turn on; down to one ends it", () => {
    const t = table([["r1"], ["b1"], ["y1"]], "r9");
    const a = leave(t, 0, "resign", rng);
    expect(a.state.turn).toBe(1);
    const b = leave(a, 2, "resign", rng);
    expect(b.state.over).toBe(true);
    expect(standings(b.state)).toEqual([[1], [2], [0]]);
  });

  test("a timeout takes the stack, or draws and keeps going", () => {
    const t = table([["rD2", "r1"], ["b1"], ["y1"]], "r9", { stack: 1, challenge: false });
    const a = autoTurn(play(t, 0, "rD2"), 1, rng);
    expect(a.state.counts[1]).toBe(3);
    expect(a.state.idle[1]).toBe(1);
    expect(a.state.turn).toBe(2);
    const b = autoTurn(table([["b1"], ["b2"]], "r9", {}, ["r3"]), 0, rng);
    expect(b.state.turn).toBe(1);
    expect(b.state.counts[0]).toBe(2);
  });
});

describe("review fixes", () => {
  test("one timeout is one strike, even when it draws and then keeps", () => {
    const t = table([["b1"], ["b2"]], "r9", {}, ["r3"]);
    const a = autoTurn(t, 0, rng);
    expect(a.state.idle[0]).toBe(1);
    expect(a.state.log.slice(-2).map((e) => e.kind)).toEqual(["draw", "pass"]);
  });

  test("no power finish also holds for jump-ins and stacks", () => {
    const jump = table([["r1", "r2"], ["rS"]], "rS", { powerFinish: false, jumpIn: true });
    expect(cantPlay(jump.state, 1, "rS", ["rS"], null)).toMatch(/power card/);
    const t = table([["rD2", "r1"], ["bD2"]], "r9", { powerFinish: false, stack: 1, challenge: false });
    const a = play(t, 0, "rD2");
    expect(cantPlay(a.state, 1, "bD2", ["bD2"], null)).toMatch(/power card/);
  });

  test("Color Roulette as the last card still spins for the next player before scoring", () => {
    const t = table([["wWC"], ["b1"]], "r9", { ...NO_MERCY, goal: 500 }, ["y4", "r2", "b7"]);
    const a = play(t, 0, "wWC");
    expect(a.state.last!.cards[1]).toBeGreaterThan(1);
    expect(a.state.log.some((e) => e.kind === "roulette" && e.seat === 1)).toBe(true);
  });

  test("drawing till you can stops at the mercy limit", () => {
    const t = table([["b1", "b2", "b3"], ["g1"], ["g2"]], "r9", { ...NO_MERCY, mercy: 5 }, Array<Card>(20).fill("y4"));
    const a = go(t, 0, { kind: "draw" });
    expect(a.state.out).toEqual([{ seat: 0, hand: 1, reason: "mercy" }]);
    expect(a.hidden.deck.length, "only two cards pulled").toBe(18);
  });

  test("a Wild Draw 4 player who leaves can't be challenged into their old hand", () => {
    const t = table([["wW4", "r1", "b2"], ["g1", "g2"], ["y1"]], "r9");
    const a = leave(play(t, 0, "wW4", { color: "b" }), 0, "resign", rng);
    expect(a.state.pending).toMatchObject({ kind: "draw", amount: 4, challenge: false });
    expect(() => go(a, 1, { kind: "challenge" })).toThrow(/nothing to challenge/);
  });
});

describe("whole games", () => {
  const MIXES: Partial<Rules>[] = [
    {},
    { stack: 2, drawUntil: true, sevenZero: true, jumpIn: true },
    { forcePlay: true, powerFinish: false, mercy: 20, goal: 250 },
    { decks: 2, hand: 10, stack: 1 },
    NO_MERCY,
    { ...NO_MERCY, goal: 500, jumpIn: true },
  ];

  test("random players finish every mix of rules without breaking a rule", () => {
    for (const [m, mix] of MIXES.entries()) {
      for (let seed = 1; seed <= 15; seed++) {
        const r = seeded(seed * 31 + m);
        const n = 2 + (seed % 6);
        let t = newGame(n, { ...CLASSIC, ...mix }, r, seed % n);
        const total = deckOf(t.state.rules.deck, t.state.rules.decks).length;
        for (let step = 0; step < 40000 && !t.state.over; step++) {
          const s = t.state;
          const seat = s.turn;
          const hand = t.hidden.hands[seat];
          const options = hand.filter((c) => cantPlay(s, seat, c, hand, t.hidden.drawn) === null);
          const color = COLORS[Math.floor(r() * 4)];
          const others = s.counts.map((_, i) => i).filter((i) => i !== seat && !s.out.some((o) => o.seat === i));
          let a: Action;
          if (s.pending?.kind === "roulette") a = { kind: "roulette", color };
          else if (options.length && r() < 0.85)
            a = { kind: "play", card: options[Math.floor(r() * options.length)], color, target: others[0], uno: r() < 0.8 };
          else if (s.pending?.kind === "draw") a = s.pending.challenge && r() < 0.5 ? { kind: "challenge" } : { kind: "take" };
          else if (s.drew) a = { kind: "pass" };
          else a = { kind: "draw" };
          try {
            t = act(t, seat, a, r);
          } catch {
            t = autoTurn(t, seat, r);
          }
          if (!t.state.over && t.state.forgot !== null && r() < 0.3) {
            const catcher = t.state.counts.findIndex((_, i) => i !== t.state.forgot && !t.state.out.some((o) => o.seat === i));
            t = act(t, catcher, { kind: "catch", seat: t.state.forgot }, r);
          }
          const held = t.hidden.hands.reduce((a, h) => a + h.length, 0);
          expect(held + t.hidden.deck.length + t.hidden.discard.length, `cards are never lost (mix ${m}, seed ${seed})`).toBe(total);
          expect(t.state.counts).toEqual(t.hidden.hands.map((h) => h.length));
          if (!t.state.over)
            expect(t.state.out.some((o) => o.seat === t.state.turn && (o.reason !== "mercy" || o.hand === t.state.hand))).toBe(false);
        }
        expect(t.state.over, `mix ${m} seed ${seed} ends`).toBe(true);
        expect(standings(t.state).flat().sort()).toEqual(t.state.counts.map((_, i) => i));
      }
    }
  }, 60_000);
});
