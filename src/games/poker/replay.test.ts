import { describe, expect, test } from "vitest";
import { deckOf, type Card } from "../../../convex/poker/cards";
import { act, deal, newGame, type PokerState } from "../../../convex/poker/engine";
import { finalHands, handAt, missedHands, stacksAfter } from "./replay";

function stacked(top: string): Card[] {
  const first = top.split(" ");
  return [...first, ...deckOf(false).filter((c) => !first.includes(c))];
}

function bustOnTheBlinds() {
  const fresh = newGame("holdem", "nl", 2, 1000);
  fresh.stacks = [15, 1000];
  const shove = deal(fresh, { sb: 10, bb: 20 }, deckOf(false), () => 0);
  const folded = act(shove, 0, { kind: "fold" });
  const end = deal(folded.state, { sb: 10, bb: 20 }, stacked("2c 7d 3h As Kd Qh 8c 5s 4h"), () => 0);
  return { before: shove.state, end: end.state };
}

describe("catching up on hands", () => {
  test("a phone on hand 1 plays hand 1's end and then the hand that played itself", () => {
    const { before, end } = bustOnTheBlinds();
    expect(missedHands(before, end).map((r) => r.hand)).toEqual([1, 2]);
  });

  test("a hand the phone already saw end isn't played again", () => {
    const { end } = bustOnTheBlinds();
    expect(missedHands(end, end)).toEqual([]);
  });

  test("a missed hand starts from its own stacks, button and blinds with nothing on the board", () => {
    const { end } = bustOnTheBlinds();
    const two = handAt(end, end.recent![1])!;
    expect(two).toMatchObject({
      hand: 2,
      button: 1,
      start: [5, 1010],
      stacks: [0, 1000],
      bets: [5, 10],
      paid: [5, 10],
      board: [],
      turn: -1,
    });
    expect(two.out).toEqual([]);
    expect(stacksAfter(end, end.recent![0])).toEqual([5, 1010]);
    expect(stacksAfter(end, end.recent![1])).toEqual(end.stacks);
  });

  test("results from before this was kept can't be replayed", () => {
    const { end } = bustOnTheBlinds();
    const old: PokerState = { ...end, recent: undefined, last: { ...end.last!, start: undefined } };
    expect(handAt(old, old.last!)).toBeNull();
    expect(finalHands(old)).toEqual([]);
  });
});

describe("replaying the end of a game", () => {
  test("a last hand nobody chose anything in brings the hand before it", () => {
    const { end } = bustOnTheBlinds();
    expect(finalHands(end).map((r) => r.hand)).toEqual([1, 2]);
  });

  test("a last hand someone played is replayed alone", () => {
    const { end } = bustOnTheBlinds();
    const played: PokerState = { ...end, recent: end.recent!.map((r) => ({ ...r, forced: false })) };
    expect(finalHands(played).map((r) => r.hand)).toEqual([2]);
  });

  test("a run of hands played out on the blinds goes back to the hand that made the short stack", () => {
    const { end } = bustOnTheBlinds();
    const [one, two] = end.recent!;
    const chain: PokerState = {
      ...end,
      hand: 4,
      recent: [
        { ...one, hand: 1, forced: false },
        { ...one, hand: 2, forced: false },
        { ...two, hand: 3, forced: true },
        { ...two, hand: 4, forced: true },
      ],
    };
    expect(finalHands(chain).map((r) => r.hand)).toEqual([2, 3, 4]);
  });

  test("a game still going has no ending to replay", () => {
    const { before } = bustOnTheBlinds();
    expect(finalHands(before)).toEqual([]);
  });
});
