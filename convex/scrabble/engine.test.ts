import { describe, expect, test } from "vitest";
import { BINGO, bagLetters, centre, evaluate, layout, nextSeat, premiumAt, standings, type Placed, type ScrabbleState, type Tile } from "./engine";
import { isWord } from "./dictionary";

const rules = { size: 15, rack: 7, league: false };
const rackOf = (letters: string): Tile[] => [...letters].map((letter, i) => ({ id: i, letter }));
// Lays `word` out from (x, y), across or down, using rack tiles in order.
const lay = (word: string, x: number, y: number, down = false, from = 0) => [...word].map((_, i) => ({ id: from + i, x: down ? x : x + i, y: down ? y + i : y }));
const onBoard = (word: string, x: number, y: number, down = false): Placed[] =>
  [...word].map((letter, i) => ({ letter, x: down ? x : x + i, y: down ? y + i : y, seat: 0, turn: 0 }));

describe("board", () => {
  test("the standard board is symmetric with the centre star in the middle", () => {
    const rows = layout(15);
    expect(rows).toHaveLength(15);
    expect(premiumAt(15, 7, 7)).toBe("*");
    expect(premiumAt(15, 0, 0)).toBe("T");
    expect(premiumAt(15, 3, 0)).toBe("d");
    expect(premiumAt(15, 5, 1)).toBe("t");
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) expect(rows[y][x]).toBe(rows[x][y]);
  });

  test("the big board mirrors eight ways too", () => {
    const rows = layout(21);
    expect(rows.every((r) => r.length === 21)).toBe(true);
    expect(premiumAt(21, centre(21), centre(21))).toBe("*");
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
      expect(rows[y][x]).toBe(rows[x][y]);
      expect(rows[y][x]).toBe(rows[20 - y][x]);
    }
  });

  test("the bag is the standard 100 tiles, and scales with at least one of each", () => {
    expect(bagLetters()).toHaveLength(100);
    expect(bagLetters().filter((l) => l === "?")).toHaveLength(2);
    const half = bagLetters(50);
    expect(half.length).toBeGreaterThan(45);
    expect(half.length).toBeLessThan(60);
    expect(half).toContain("Q");
    expect(bagLetters(200)).toHaveLength(200);
  });
});

describe("evaluate", () => {
  test("the first word must cross the centre star, which doubles it", () => {
    const rack = rackOf("CAT");
    expect(evaluate([], lay("CAT", 0, 0), rack, rules)).toEqual({ ok: false, error: "The first word goes through the centre star." });
    const r = evaluate([], lay("CAT", 6, 7), rack, rules);
    expect(r).toMatchObject({ ok: true, score: 10, bingo: false });
    if (r.ok) expect(r.words.map((w) => w.word)).toEqual(["CAT"]);
  });

  test("a single tile can't be a word", () => {
    expect(evaluate([], [{ id: 0, x: 7, y: 7 }], rackOf("A"), rules)).toEqual({ ok: false, error: "Words need at least two letters." });
  });

  test("tiles in one line, no gaps, built off what's there", () => {
    const board = onBoard("CAT", 6, 7);
    const rack = rackOf("SHOE");
    expect(evaluate(board, [{ id: 0, x: 0, y: 0 }, { id: 1, x: 1, y: 1 }], rack, rules)).toMatchObject({ error: "Keep your tiles in one line." });
    expect(evaluate(board, [{ id: 0, x: 0, y: 3 }, { id: 1, x: 2, y: 3 }], rack, rules)).toMatchObject({ error: "Leave no gaps between your tiles." });
    expect(evaluate(board, lay("SH", 0, 0), rack, rules)).toMatchObject({ error: "Build off a word that's already down." });
    expect(evaluate(board, [{ id: 0, x: 6, y: 7 }], rack, rules)).toMatchObject({ error: "That square is taken." });
  });

  test("existing tiles fill the gaps and every cross word counts", () => {
    // CAT across the middle, then S on the end makes CATS.
    const board = onBoard("CAT", 6, 7);
    const r = evaluate(board, [{ id: 0, x: 9, y: 7 }], rackOf("S"), rules);
    expect(r).toMatchObject({ ok: true, score: 6 });
    // Playing H-A-T down through the A of CAT: the A is reused.
    const down = evaluate(board, [{ id: 0, x: 7, y: 6 }, { id: 1, x: 7, y: 8 }], rackOf("HT"), rules);
    expect(down.ok && down.words.map((w) => w.word)).toEqual(["HAT"]);
  });

  test("bonus squares count once in Scrabble, and stay with their tile in Letter League", () => {
    // CAT across the centre star (double word), then COW down from its C.
    const board = onBoard("CAT", 7, 7);
    expect(evaluate(board, lay("OW", 7, 8, true), rackOf("OW"), rules)).toMatchObject({ ok: true, score: 8 });
    expect(evaluate(board, lay("OW", 7, 8, true), rackOf("OW"), { ...rules, league: true })).toMatchObject({ ok: true, score: 16 });
  });

  test("in Letter League, an S on a doubled word doubles it again", () => {
    // CAT on the centre star scored (3+1+1)x2 = 10. CATS: official 6, Letter League (3+1+1+1)x2 = 12.
    const board = onBoard("CAT", 6, 7);
    const s = [{ id: 0, x: 9, y: 7 }];
    expect(evaluate(board, s, rackOf("S"), rules)).toMatchObject({ ok: true, score: 6 });
    expect(evaluate(board, s, rackOf("S"), { ...rules, league: true })).toMatchObject({ ok: true, score: 12 });
  });

  test("the big board plays by the same rules, centred on its own star", () => {
    const big = { ...rules, size: 21 };
    expect(evaluate([], lay("CAT", 0, 0), rackOf("CAT"), big)).toMatchObject({ error: "The first word goes through the centre star." });
    expect(evaluate([], lay("CAT", 9, 10), rackOf("CAT"), big)).toMatchObject({ ok: true, score: 10 });
  });

  test("a single tile next to a word extends it, either way it's read", () => {
    const board = onBoard("CAT", 6, 7);
    const r = evaluate(board, [{ id: 0, x: 9, y: 7 }], rackOf("S"), rules);
    expect(r.ok && r.words.map((w) => w.word)).toEqual(["CATS"]);
  });

  test("a bigger rack makes a bingo only when all of it goes down", () => {
    const r = evaluate([], lay("RETAINS", 4, 7), rackOf("RETAINSAB"), { ...rules, rack: 9 });
    expect(r).toMatchObject({ ok: true, bingo: false, score: 14 });
  });

  test("blanks play as any letter and score nothing", () => {
    const r = evaluate([], [{ id: 0, x: 7, y: 7, letter: "c" }, { id: 1, x: 8, y: 7 }, { id: 2, x: 9, y: 7 }], rackOf("?AT"), rules);
    expect(r).toMatchObject({ ok: true, score: 4 });
    expect(r.ok && r.words[0].word).toBe("CAT");
    expect(evaluate([], [{ id: 0, x: 7, y: 7 }, { id: 1, x: 8, y: 7 }], rackOf("?A"), rules)).toMatchObject({ error: "Pick a letter for your blank." });
  });

  test("using the whole rack is a bingo", () => {
    const r = evaluate([], lay("RETAINS", 4, 7), rackOf("RETAINS"), rules);
    expect(r).toMatchObject({ ok: true, bingo: true });
    expect(r.ok && r.score).toBe(2 * (1 + 1 + 1 + 1 + 1 + 1 + 1) + BINGO);
  });

  test("tiles not in the rack are refused", () => {
    expect(evaluate([], [{ id: 9, x: 7, y: 7 }], rackOf("A"), rules)).toMatchObject({ error: "That tile isn't in your rack." });
  });
});

describe("turns and standings", () => {
  const state = (scores: number[], out: number[] = []) => ({ scores, out }) as unknown as ScrabbleState;

  test("the turn skips players who left", () => {
    expect(nextSeat(state([0, 0, 0]), 0)).toBe(1);
    expect(nextSeat(state([0, 0, 0], [1]), 0)).toBe(2);
    expect(nextSeat(state([0, 0, 0], [1]), 2)).toBe(0);
  });

  test("highest score first, ties share a place, resigned players last", () => {
    expect(standings(state([10, 30, 30, 5]))).toEqual([[1, 2], [0], [3]]);
    expect(standings(state([10, 30, 50, 5], [2, 0]))).toEqual([[1], [3], [0], [2]]);
  });
});

describe("dictionary", () => {
  test("knows real words in any case, and not made-up ones", () => {
    expect(isWord("cat")).toBe(true);
    expect(isWord("QI")).toBe(true);
    expect(isWord("zyzzyva")).toBe(true);
    expect(isWord("zorp")).toBe(false);
  });
});
