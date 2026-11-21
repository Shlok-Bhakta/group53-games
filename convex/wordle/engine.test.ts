import { describe, expect, test } from "vitest";
import { ANSWERS } from "./answers";
import {
  BASE_PAY,
  ITEMS,
  ROWS,
  SOLVE_PAY,
  START_COINS,
  STEAL,
  buyOrder,
  cantGuess,
  cantPick,
  choose,
  finishRound,
  fogged,
  guess,
  isGuessable,
  jammed,
  keyColors,
  lastWord,
  leave,
  newGame,
  pickWords,
  roundDone,
  score,
  standings,
  waitingOn,
  type ItemKey,
  type Mine,
  type WordleState,
} from "./engine";

const fixed =
  (n = 0.42) =>
  () =>
    n;
const WORDS = ["crane", "slate", "pious", "ghost", "flame", "brick", "shard", "tempo"];
const everyItem: ItemKey[] = ["fog", "fuse", "jam", "pickpocket", "dark", "shield", "hint", "extra"];

function table(n: number, goal = 3, shop = true) {
  const g = newGame(n, { goal, shop }, fixed());
  g.s.stock = everyItem.map((item) => ({ item, left: 1 }));
  return { s: g.s, mine: g.mine };
}

type Table = ReturnType<typeof table>;

function play(t: Table, seat: number, ...words: string[]) {
  for (const w of words) {
    const r = guess(t.s, t.mine[seat], seat, w, WORDS[t.s.round]);
    t.s = r.s;
    t.mine[seat] = r.mine;
  }
}

function buy(t: Table, seat: number, item: ItemKey | null, target = -1) {
  const r = choose(t.s, t.mine[seat], seat, item ? { item, target } : null);
  t.s = r.s;
  t.mine[seat] = r.mine;
}

function close(t: Table, rng = fixed()) {
  const r = finishRound(t.s, t.mine, WORDS, rng);
  t.s = r.s;
  t.mine = r.mine;
  return r.buys;
}

describe("scoring", () => {
  test("greens, yellows and grays", () => {
    expect(score("crane", "crane")).toBe("22222");
    expect(score("react", "crane")).toBe("11210");
    expect(score("ghost", "crane")).toBe("00000");
  });

  test("a repeated letter only counts as often as the word has it", () => {
    expect(score("speed", "abide")).toBe("00101");
    expect(score("eerie", "there")).toBe("10102");
    expect(score("llama", "hello")).toBe("11000");
  });

  test("the keyboard keeps the best color a letter has had", () => {
    const k = keyColors(["react", "crane"], ["11210", "22222"]);
    expect(k).toMatchObject({ c: 2, r: 2, a: 2, n: 2, e: 2, t: 0 });
  });
});

describe("words", () => {
  test("every answer is a five-letter guessable word, and the lists hold no junk", () => {
    expect(ANSWERS.length % 5).toBe(0);
    for (let i = 0; i < ANSWERS.length; i += 5) {
      const w = ANSWERS.slice(i, i + 5);
      expect(w, w).toMatch(/^[a-z]{5}$/);
      expect(isGuessable(w), w).toBe(true);
    }
    expect(isGuessable("CRANE")).toBe(true);
    expect(isGuessable("xqzvw")).toBe(false);
  });

  test("a game's words are all different", () => {
    let k = 0;
    const words = pickWords(ANSWERS, 10, () => ((k = (k * 7 + 3) % 97), k / 97));
    expect(new Set(words).size).toBe(10);
  });
});

describe("guessing", () => {
  test("refuses short words, non-words, and guesses once you're done", () => {
    const t = table(2);
    expect(cantGuess(t.s, 0, "cran")).toBe("Five letters.");
    expect(cantGuess(t.s, 0, "xqzvw")).toBe("Not in the word list.");
    play(t, 0, "crane");
    expect(cantGuess(t.s, 0, "slate")).toBe("You're done with this word.");
  });

  test("solving pays the base, the greens and the guesses left", () => {
    const t = table(2);
    play(t, 0, "slate", "crane");
    const p = t.s.players[0];
    expect(p).toMatchObject({ done: true, won: true, rows: 2, solved: 1, guesses: 2 });
    expect(p.earned).toBe(BASE_PAY + 5 + SOLVE_PAY + (ROWS - 2));
    expect(p.coins).toBe(START_COINS + p.earned);
    expect(t.mine[0].marks).toEqual(["00202", "22222"]);
  });

  test("missing every row pays the base and the greens found", () => {
    const t = table(2);
    play(t, 0, "slate", "brine", "ghost", "flame", "brick", "shard");
    const p = t.s.players[0];
    expect(p).toMatchObject({ done: true, won: false, solved: 0, guesses: ROWS + 1 });
    expect(p.earned, "a, r, n and e went green").toBe(BASE_PAY + 4);
  });

  test("the round waits for everyone's word, then everyone's shopping", () => {
    const t = table(3);
    play(t, 0, "crane");
    expect(waitingOn(t.s)).toEqual([0, 1, 2]);
    play(t, 1, "crane");
    play(t, 2, "crane");
    buy(t, 0, null);
    buy(t, 1, null);
    expect(roundDone(t.s)).toBe(false);
    buy(t, 2, null);
    expect(roundDone(t.s)).toBe(true);
  });

  test("picking needs your word done, the coins and someone else to throw it at", () => {
    const t = table(2);
    expect(cantPick(t.s, 0, { item: "fog", target: 1 })).toBe("Finish your word first.");
    play(t, 0, "crane");
    expect(cantPick(t.s, 0, { item: "fog", target: 0 })).toBe("Pick someone else to throw it at.");
    t.s.players[0].coins = 1;
    expect(cantPick(t.s, 0, { item: "fog", target: 1 })).toBe("Not enough coins.");
  });
});

describe("the shop", () => {
  function round1(n = 3) {
    const t = table(n);
    for (let i = 0; i < n; i++) play(t, i, "crane");
    return t;
  }

  test("whoever has the fewest coins buys first, so the richer player misses a sold-out item", () => {
    const t = round1();
    t.s.players[0].coins = 20;
    t.s.players[1].coins = 5;
    t.s.players[2].coins = 9;
    expect(buyOrder(t.s)).toEqual([1, 2, 0]);
    buy(t, 0, "fog", 2);
    buy(t, 1, "fog", 2);
    buy(t, 2, null);
    const buys = close(t);
    expect(buys.find((b) => b.seat === 1)).toMatchObject({ got: true });
    expect(buys.find((b) => b.seat === 0)).toMatchObject({ got: false });
    expect(t.s.players[0].coins, "a miss costs nothing").toBe(20);
    expect(t.s.players[1].coins).toBe(5 - ITEMS.fog.price);
    expect(t.s.players[2].effects).toEqual([{ item: "fog", by: 1 }]);
  });

  test("a shield blocks the first thing thrown, not the second", () => {
    const t = round1();
    t.s.stock = everyItem.map((item) => ({ item, left: 3 }));
    t.s.players.forEach((p) => (p.coins = 20));
    buy(t, 0, "shield");
    buy(t, 1, "fog", 0);
    buy(t, 2, "dark", 0);
    const buys = close(t);
    expect(buys.find((b) => b.seat === 1)?.blocked).toBe(true);
    expect(t.s.players[0].effects).toEqual([{ item: "dark", by: 2 }]);
  });

  test("pickpocket takes coins at once, never more than they have", () => {
    const t = round1(2);
    t.s.players[0].coins = 10;
    t.s.players[1].coins = 2;
    buy(t, 0, "pickpocket", 1);
    buy(t, 1, null);
    const buys = close(t);
    expect(buys[0].took).toBe(2);
    expect(t.s.players[0].coins).toBe(10 - ITEMS.pickpocket.price + 2);
    expect(t.s.players[1].coins).toBe(0);
    expect(STEAL).toBeGreaterThan(2);
  });

  test("short fuse and extra row change the next word's rows, within limits", () => {
    const t = round1();
    t.s.stock = everyItem.map((item) => ({ item, left: 3 }));
    t.s.players.forEach((p) => (p.coins = 20));
    buy(t, 0, "fuse", 2);
    buy(t, 1, "fuse", 2);
    buy(t, 2, "extra");
    close(t);
    expect(t.s.players[2].max).toBe(ROWS - 2 + 1);
    expect(t.s.players[0].max).toBe(ROWS);
  });

  test("jam locks two letters for the first two guesses", () => {
    const t = round1(2);
    buy(t, 0, "jam", 1);
    buy(t, 1, null);
    close(t);
    const letters = jammed(t.s.players[1]);
    expect(letters).toHaveLength(2);
    const word = ["slate", "pious", "ghost", "brick", "dumpy"].find((w) => [...letters].some((ch) => w.includes(ch)))!;
    expect(cantGuess(t.s, 1, word)).toMatch(/jammed/);
    const clean = ["dumpy", "fizzy", "jumpy", "buggy", "whomp"].find((w) => ![...letters].some((ch) => w.includes(ch)))!;
    play(t, 1, clean, clean);
    expect(jammed(t.s.players[1]), "free again from the third guess").toBe("");
  });

  test("fog hides the top three rows once they're behind you", () => {
    const t = round1(2);
    buy(t, 0, "fog", 1);
    buy(t, 1, null);
    close(t);
    const p = t.s.players[1];
    play(t, 1, "crane", "ghost");
    expect([0, 1].map((r) => fogged(t.s.players[1], r))).toEqual([true, false]);
    play(t, 1, "flame", "brick", "pious");
    expect([0, 1, 2, 3, 4].map((r) => fogged(t.s.players[1], r))).toEqual([true, true, true, false, false]);
    expect(p.effects[0].item).toBe("fog");
  });

  test("a hint shows one letter of the next word", () => {
    const t = round1(2);
    t.s.players[0].coins = 10;
    buy(t, 0, "hint");
    buy(t, 1, null);
    close(t, fixed(0.5));
    const hint = t.mine[0].hint!;
    expect(WORDS[1][hint.at]).toBe(hint.letter);
    expect(t.mine[1].hint).toBeUndefined();
  });

  test("the next word starts fresh and the closed one goes into history with everyone's letters", () => {
    const t = round1(2);
    buy(t, 0, null);
    buy(t, 1, null);
    close(t);
    expect(t.s.round).toBe(1);
    expect(t.s.players.every((p) => !p.done && p.rows === 0 && !p.picked)).toBe(true);
    expect(t.s.history[0]).toMatchObject({ word: "crane", boards: [{ guesses: ["crane"], won: true }, { guesses: ["crane"] }] });
    expect(t.mine.every((m: Mine) => m.round === 1 && m.guesses.length === 0)).toBe(true);
  });

  test("with the shop off nobody waits on shopping", () => {
    const t = table(2, 3, false);
    play(t, 0, "crane");
    play(t, 1, "slate", "crane");
    expect(roundDone(t.s)).toBe(true);
    expect(cantPick(t.s, 0, null)).toBe("The shop is off in this game.");
  });
});

describe("winning", () => {
  function solveAll(s: WordleState, t: Table, seats: number[]) {
    for (const i of seats) play(t, i, WORDS[s.round]);
  }

  test("the first to the goal wins, ties go to fewer guesses", () => {
    const t = table(2, 3, false);
    for (let r = 0; r < 3; r++) {
      play(t, 0, WORDS[r]);
      if (r === 1) play(t, 1, "ghost", WORDS[r]);
      else play(t, 1, WORDS[r]);
      if (r === 2) expect(lastWord(t.s)).toBe(true);
      close(t);
    }
    expect(t.s.over).toBe(true);
    expect(standings(t.s)).toEqual([[0], [1]]);
  });

  test("the shop doesn't open after the last word", () => {
    const t = table(2, 3);
    t.s.players[0].solved = 2;
    play(t, 0, "crane");
    expect(lastWord(t.s)).toBe(true);
    expect(t.s.players[0].picked).toBe(true);
    play(t, 1, "crane");
    expect(roundDone(t.s)).toBe(true);
  });

  test("when the words run out the most solved wins", () => {
    const t = table(2, 3, false);
    t.s.rounds = 2;
    solveAll(t.s, t, [0]);
    play(t, 1, "ghost", "ghost", "ghost", "ghost", "ghost", "ghost");
    close(t);
    solveAll(t.s, t, [0, 1]);
    close(t);
    expect(t.s.over).toBe(true);
    expect(standings(t.s)[0]).toEqual([0]);
  });

  test("equal on everything is a shared place", () => {
    const t = table(3, 3, false);
    t.s.players[2].solved = 1;
    expect(standings(t.s)).toEqual([[2], [0, 1]]);
  });

  test("someone leaving stops the wait on them and drops them to last", () => {
    const t = table(3);
    play(t, 0, "crane");
    play(t, 1, "crane");
    buy(t, 0, null);
    buy(t, 1, null);
    t.s = leave(t.s, 2);
    expect(roundDone(t.s)).toBe(true);
    t.s.players[2].solved = 3;
    expect(standings(t.s).at(-1)).toEqual([2]);
  });

  test("the deadline closes the word for anyone not done", () => {
    const t = table(2);
    play(t, 0, "slate");
    const r = finishRound(t.s, t.mine, WORDS, fixed(), true);
    expect(r.s.history[0].boards[0]).toMatchObject({ guesses: ["slate"], won: false });
    expect(r.s.players[0].guesses).toBe(ROWS + 1);
    expect(r.s.round).toBe(1);
  });
});
