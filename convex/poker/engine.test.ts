import { describe, expect, test } from "vitest";
import { bestHand, deckOf, rank5 } from "./cards";
import { act, alive, blindsFor, deal, leave, newGame, potOf, raiseBounds, sidePots, standings, toCall, type Card, type Table } from "./engine";

const r = (s: string) => rank5(s.split(" "));
const short = (s: string) => rank5(s.split(" "), true);
const cards = (s: string) => s.split(" ");
const noRandom = () => 0;

// A deck with these cards on top (dealing order: holes from the button's left, then the board), the rest after.
function stacked(top: string, isShort = false): Card[] {
  const first = cards(top);
  return [...first, ...deckOf(isShort).filter((c) => !first.includes(c))];
}

describe("hand rankings", () => {
  test("every category beats the one below it", () => {
    const ladder = ["As Kd 9h 7c 3s", "2s 2d 9h 7c 3s", "2s 2d 3h 3c 9s", "2s 2d 2h 7c 9s", "5s 6d 7h 8c 9s", "2s 7s 9s Js Ks", "2s 2d 2h 3c 3s", "2s 2d 2h 2c 3s", "5s 6s 7s 8s 9s"];
    const scores = ladder.map((h) => r(h).score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(ladder.map((h) => r(h).name)).toEqual([
      "Ace high",
      "Pair of 2s",
      "Two pair, 3s and 2s",
      "Three 2s",
      "Straight, 9 high",
      "Flush, King high",
      "Full house, 2s full of 3s",
      "Four 2s",
      "Straight flush, 9 high",
    ]);
  });
  test("kickers break ties and the wheel is the lowest straight", () => {
    expect(r("As Ad Kh 7c 3s").score).toBeGreaterThan(r("As Ad Qh Jc Ts").score);
    expect(r("As 2d 3h 4c 5s").name).toBe("Straight, 5 high");
    expect(r("As 2d 3h 4c 5s").score).toBeLessThan(r("2s 3d 4h 5c 6s").score);
    expect(r("Ts Js Qs Ks As").name).toBe("Royal flush");
    expect(r("Kh Ks Kd 2c 2s").score).toBe(r("Kc Ks Kd 2h 2d").score);
  });
  test("Short Deck: flushes beat full houses, trips beat straights, A-6-7-8-9 is a straight", () => {
    expect(short("2s 7s 9s Js Ks").score).toBeGreaterThan(short("6s 6d 6h 7c 7s").score);
    expect(short("6s 6d 6h 9c Ks").score).toBeGreaterThan(short("6s 7d 8h 9c Ts").score);
    expect(short("As 6d 7h 8c 9s").name).toBe("Straight, 9 high");
  });
  test("Omaha uses exactly two hole cards and three from the board", () => {
    // Four spades on the board and one in hand is no flush in Omaha.
    expect(bestHand("omaha", cards("As Kd Qh Jc"), cards("2s 5s 8s 9s Td"))!.name).not.toMatch(/Flush/);
    expect(bestHand("holdem", cards("As Kd"), cards("2s 5s 8s 9s Td"))!.name).toBe("Flush, Ace high");
    expect(bestHand("omaha", cards("As Ks Qh Jc"), cards("2s 5s 8d 9s Td"))!.name).toBe("Flush, Ace high");
    expect(bestHand("omaha", cards("As Ks Qh Jc"), [])).toBeNull();
  });
});

describe("a hand of Hold'em", () => {
  test("blinds double on schedule", () => {
    expect(blindsFor(1000, 1, 3)).toEqual({ sb: 10, bb: 20 });
    expect(blindsFor(1000, 4, 3)).toEqual({ sb: 20, bb: 40 });
    expect(blindsFor(1000, 7, 3)).toEqual({ sb: 40, bb: 80 });
    expect(blindsFor(500, 9, 0)).toEqual({ sb: 5, bb: 10 });
  });

  test("heads-up: the button posts the small blind and acts first, then last after the flop", () => {
    // Seat 1 gets As Ad, seat 0 gets Kc Kd; board 2h 7s 9c Jd 3h.
    let t = deal(newGame("holdem", "nl", 2, 1000), { sb: 10, bb: 20 }, stacked("As Ad Kc Kd 2h 7s 9c Jd 3h"), noRandom);
    expect(t.state.button).toBe(0);
    expect(t.state.bets).toEqual([10, 20]);
    expect(t.state.turn).toBe(0);
    expect(t.hidden.holes).toEqual([["Kc", "Kd"], ["As", "Ad"]]);
    t = act(t, 0, { kind: "call" });
    expect(t.state.turn).toBe(1); // the big blind's option
    expect(() => act(t, 0, { kind: "check" })).toThrow("not your turn");
    t = act(t, 1, { kind: "check" });
    expect(t.state.board).toEqual(["2h", "7s", "9c"]);
    expect(potOf(t.state)).toBe(40);
    expect(t.state.turn).toBe(1);
    for (let i = 0; i < 3; i++) {
      t = act(t, 1, { kind: "check" });
      t = act(t, 0, { kind: "check" });
    }
    expect(t.state.turn).toBe(-1);
    expect(t.state.stacks).toEqual([980, 1020]);
    expect(t.state.last).toMatchObject({ showdown: true, net: [-20, 20], board: ["2h", "7s", "9c", "Jd", "3h"] });
    expect(t.state.last!.names).toEqual(["Pair of Kings", "Pair of Aces"]);
    expect(t.state.last!.shown).toEqual([["Kc", "Kd"], ["As", "Ad"]]);
  });

  test("everyone folding hands the pot over without a showdown", () => {
    let t = deal(newGame("holdem", "nl", 3, 1000), { sb: 10, bb: 20 }, deckOf(false));
    // Button 0, small blind 1, big blind 2: the button acts first.
    expect(t.state.turn).toBe(0);
    t = act(t, 0, { kind: "raise", to: 60 });
    t = act(t, 1, { kind: "fold" });
    t = act(t, 2, { kind: "fold" });
    expect(t.state.turn).toBe(-1);
    expect(t.state.stacks).toEqual([1030, 990, 980]);
    // The 40 nobody called came back; the pot was the blinds and the matched 20.
    expect(t.state.last).toMatchObject({ showdown: false, shown: [null, null, null], won: [50, 0, 0], net: [30, -10, -20] });
  });

  test("raises: at least the last raise again, all-in for less allowed, and a short all-in doesn't reopen", () => {
    let t: Table = deal({ ...newGame("holdem", "nl", 3, 1000), stacks: [1000, 1000, 70] }, { sb: 10, bb: 20 }, deckOf(false));
    expect(raiseBounds(t.state, 0)).toEqual({ min: 40, max: 1000 });
    expect(() => act(t, 0, { kind: "raise", to: 30 })).toThrow("between 40 and 1000");
    t = act(t, 0, { kind: "raise", to: 50 }); // raise of 30
    expect(raiseBounds(t.state, 1)).toEqual({ min: 80, max: 1000 });
    t = act(t, 1, { kind: "call" });
    // The big blind has 50 behind its 20: all-in to 70 is less than a full raise.
    expect(raiseBounds(t.state, 2)).toEqual({ min: 70, max: 70 });
    t = act(t, 2, { kind: "raise", to: 70 });
    expect(t.state.stacks[2]).toBe(0);
    // Seat 0 raised to 50; 20 more isn't a full raise over that, so it can only call or fold.
    expect(toCall(t.state, 0)).toBe(20);
    expect(raiseBounds(t.state, 0)).toBeNull();
    t = act(t, 0, { kind: "call" });
    // Seat 1 called 50 too, so likewise.
    expect(raiseBounds(t.state, 1)).toBeNull();
    t = act(t, 1, { kind: "call" });
    expect(t.state.board).toHaveLength(3);
  });

  test("pot limit caps a raise at the pot after calling", () => {
    const t = deal(newGame("omaha", "pl", 3, 1000), { sb: 10, bb: 20 }, deckOf(false));
    // Pot is 30, calling makes it 50, so the button can raise to 20 + 50.
    expect(raiseBounds(t.state, 0)).toEqual({ min: 40, max: 70 });
    expect(t.hidden.holes[0]).toHaveLength(4);
  });

  test("side pots: each all-in only wins what it matched", () => {
    // Seats 1, 2, 0 are dealt in that order. Seat 1 (100 chips) has the best hand, seat 2 (300) the next.
    const deck = stacked("As Ad Ks Kd 7c 2d 3h 8s 9c Jd 4h");
    let t = deal({ ...newGame("holdem", "nl", 3, 1000), stacks: [1000, 100, 300] }, { sb: 10, bb: 20 }, deck, noRandom);
    t = act(t, 0, { kind: "raise", to: 1000 });
    t = act(t, 1, { kind: "call" });
    t = act(t, 2, { kind: "call" });
    expect(t.state.turn).toBe(-1);
    expect(t.state.board).toHaveLength(5);
    const pots = t.state.last!.pots;
    // The unmatched part of the shove went back before the pots were shared out.
    expect(pots.map((p) => [p.amount, p.eligible, p.winners])).toEqual([
      [300, [0, 1, 2], [1]],
      [400, [0, 2], [2]],
    ]);
    expect(t.state.last!.net).toEqual([-300, 200, 100]);
    expect(t.state.stacks).toEqual([700, 300, 400]);
    expect(t.state.out.map((o) => o.seat)).toEqual([]);
  });

  test("busting out, and standings by chips then by how long you lasted", () => {
    const deck = stacked("As Ad 7c 2d Ks Kd 3h 8s 9c Jd 4h");
    let t = deal({ ...newGame("holdem", "nl", 3, 1000), stacks: [1000, 100, 300] }, { sb: 10, bb: 20 }, deck, noRandom);
    t = act(t, 0, { kind: "raise", to: 1000 });
    t = act(t, 1, { kind: "call" });
    t = act(t, 2, { kind: "call" });
    // Seat 1 wins the main pot, seat 0's kings take the side pot and knock seat 2 out.
    expect(t.state.stacks).toEqual([1100, 300, 0]);
    expect(t.state.out).toEqual([{ seat: 2, hand: 1, reason: "bust", stack: 300 }]);
    expect(alive(t.state)).toEqual([0, 1]);
    expect(standings(t.state)).toEqual([[0], [1], [2]]);
    // Next hand deals only the two left; the button moves on.
    t = deal(t.state, { sb: 10, bb: 20 }, deckOf(false));
    expect(t.state.dealt).toEqual([true, true, false]);
    expect(t.state.button).toBe(1);
  });

  test("everyone all-in before the flop runs the board out", () => {
    let t = deal(newGame("holdem", "nl", 2, 1000), { sb: 10, bb: 20 }, deckOf(false));
    t = act(t, 0, { kind: "raise", to: 1000 });
    t = act(t, 1, { kind: "call" });
    expect(t.state.turn).toBe(-1);
    expect(t.state.board).toHaveLength(5);
    expect(t.state.stacks[0] + t.state.stacks[1]).toBe(2000);
  });

  test("resigning folds you and your chips leave with you", () => {
    let t = deal(newGame("holdem", "nl", 3, 1000), { sb: 10, bb: 20 }, deckOf(false));
    t = leave(t, 1); // the small blind, not on turn
    expect(t.state.folded[1]).toBe(true);
    expect(t.state.turn).toBe(0);
    t = leave(t, 0); // on turn: the big blind wins
    expect(t.state.turn).toBe(-1);
    expect(t.state.stacks).toEqual([0, 0, 1010]);
    expect(standings(t.state)).toEqual([[2], [0], [1]]);
  });
});

describe("five-card draw", () => {
  test("a betting round, a draw, then another", () => {
    let t = deal(newGame("draw", "nl", 2, 1000), { sb: 10, bb: 20 }, deckOf(false), noRandom);
    expect(t.hidden.holes.map((h) => h.length)).toEqual([5, 5]);
    t = act(t, 0, { kind: "call" });
    t = act(t, 1, { kind: "check" });
    // Draw: first to the button's left.
    expect(t.state.street).toBe(1);
    expect(t.state.turn).toBe(1);
    expect(() => act(t, 1, { kind: "check" })).toThrow("swap");
    const before = [...t.hidden.holes[1]];
    t = act(t, 1, { kind: "draw", discard: [0, 2] });
    expect(t.state.drew[1]).toBe(2);
    expect(t.hidden.holes[1][1]).toBe(before[1]);
    expect(t.hidden.holes[1][0]).not.toBe(before[0]);
    expect(t.hidden.muck).toEqual([before[0], before[2]]);
    t = act(t, 0, { kind: "draw", discard: [] });
    expect(t.state.street).toBe(2);
    t = act(t, 1, { kind: "check" });
    t = act(t, 0, { kind: "check" });
    expect(t.state.turn).toBe(-1);
    expect(t.state.last!.names.every((n) => n !== null)).toBe(true);
  });

  test("the muck is shuffled back in when the deck runs dry", () => {
    let t = deal(newGame("draw", "nl", 2, 1000), { sb: 10, bb: 20 }, deckOf(false), noRandom);
    t = { ...t, hidden: { ...t.hidden, deck: t.hidden.deck.slice(0, 1), muck: ["Kc", "Qc", "Jc"] } };
    t = act(t, 0, { kind: "call" });
    t = act(t, 1, { kind: "check" });
    t = act(t, 1, { kind: "draw", discard: [0, 1, 2] });
    expect(t.hidden.holes[1].length).toBe(5);
    expect(new Set(t.hidden.holes[1]).size).toBe(5);
  });
});

test("side pots ignore folded seats as winners but keep their chips", () => {
  const s = { ...newGame("holdem", "nl", 3, 1000), dealt: [true, true, true], folded: [true, false, false], paid: [50, 100, 40] };
  expect(sidePots(s)).toEqual([
    { amount: 120, eligible: [1, 2] },
    { amount: 70, eligible: [1] },
  ]);
});

describe("review fixes", () => {
  test("a big blind all-in for less than the small blind is not a bet to answer", () => {
    // Heads-up: seat 0 (button, small blind) has plenty; seat 1 has only 5 for its big blind.
    const t = deal({ ...newGame("holdem", "nl", 2, 1000), stacks: [1000, 5] }, { sb: 10, bb: 20 }, deckOf(false));
    // Nobody is left to act, so the board runs out and the 5 over the short blind comes back.
    expect(t.state.turn).toBe(-1);
    expect(t.state.board).toHaveLength(5);
    expect(t.state.stacks[0] + t.state.stacks[1]).toBe(1005);
    expect(t.state.last!.pots.map((p) => p.amount)).toEqual([10]);
  });

  test("a resigning player's bet stays in the pot instead of going back to them", () => {
    let t = deal(newGame("holdem", "nl", 3, 1000), { sb: 10, bb: 20 }, deckOf(false));
    t = act(t, 0, { kind: "raise", to: 200 });
    t = act(t, 1, { kind: "call" });
    // The big blind folds.
    t = act(t, 2, { kind: "fold" });
    expect(t.state.street).toBe(1);
    t = act(t, 1, { kind: "check" });
    t = act(t, 0, { kind: "raise", to: 100 });
    // Seat 0 bets 100 nobody has called yet, then resigns: the 100 isn't refunded to an empty seat.
    t = leave(t, 0);
    expect(t.state.turn).toBe(-1);
    expect(t.state.stacks).toEqual([0, 1320, 980]);
  });

  test("timeouts count up and a real move resets them", () => {
    let t = deal(newGame("holdem", "nl", 3, 1000), { sb: 10, bb: 20 }, deckOf(false));
    t = act(t, 0, { kind: "call" }, Math.random, true);
    expect(t.state.idle).toEqual([1, 0, 0]);
    t = act(t, 1, { kind: "call" });
    t = act(t, 2, { kind: "check" });
    t = act(t, 1, { kind: "check" });
    t = act(t, 2, { kind: "check" });
    t = act(t, 0, { kind: "check" });
    expect(t.state.idle).toEqual([0, 0, 0]);
  });
});
