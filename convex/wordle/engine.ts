import { GUESSES } from "./words";

export const LENGTH = 5;
export const ROWS = 6;
export const MIN_ROWS = 3;
export const MAX_ROWS = 8;
export const START_COINS = 4;
export const BASE_PAY = 2;
export const SOLVE_PAY = 3;
export const STEAL = 3;
export const JAM_TURNS = 2;
export const FOG_ROWS = 3;
export const SHOP_SIZE = 5;
const JAMMABLE = "earotlisnc";

export type ItemKey = "fog" | "fuse" | "jam" | "pickpocket" | "dark" | "shield" | "hint" | "extra";

export type ItemDef = { name: string; price: number; target: boolean; text: string };

export const ITEMS: Record<ItemKey, ItemDef> = {
  fog: { name: "Fog", price: 4, target: true, text: "Their top three rows fog over once they've guessed past them." },
  fuse: { name: "Short fuse", price: 5, target: true, text: "One guess fewer on their next word." },
  jam: { name: "Jam", price: 3, target: true, text: "Two common letters lock on their keyboard for their first two guesses." },
  pickpocket: { name: "Pickpocket", price: 2, target: true, text: `Take ${STEAL} of their coins.` },
  dark: { name: "Blackout", price: 3, target: true, text: "Their keyboard shows no colors on their next word." },
  shield: { name: "Shield", price: 3, target: false, text: "Blocks the first thing thrown at you in this shop." },
  hint: { name: "Hint", price: 4, target: false, text: "Start your next word with one letter already green." },
  extra: { name: "Extra row", price: 4, target: false, text: "One more guess on your next word." },
};
export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];
export const isItem = (k: string): k is ItemKey => k in ITEMS;

export type Effect = { item: ItemKey; by: number; letters?: string };

export type Player = {
  coins: number;
  solved: number;
  guesses: number;
  rows: number;
  max: number;
  done: boolean;
  won: boolean;
  earned: number;
  picked: boolean;
  effects: Effect[];
  out?: boolean;
};

export type Stock = { item: ItemKey; left: number };

export type Buy = { seat: number; item: ItemKey; target: number; got: boolean; blocked?: boolean; took?: number };

export type Board = { guesses: string[]; marks: string[]; won: boolean };

export type Round = { word: string; boards: Board[]; buys: Buy[] };

export type Rules = { goal: number; shop: boolean };

export type WordleState = {
  rules: Rules;
  round: number;
  rounds: number;
  seq: number;
  over: boolean;
  deadline: number | null;
  players: Player[];
  stock: Stock[];
  history: Round[];
};

export type Pick = { item: ItemKey; target: number } | null;

export type Mine = { round: number; guesses: string[]; marks: string[]; pick: Pick; hint?: { at: number; letter: string } };

export type Rng = () => number;

let guessSet: Set<string> | null = null;
export function isGuessable(word: string) {
  guessSet ??= new Set(Array.from({ length: GUESSES.length / LENGTH }, (_, i) => GUESSES.slice(i * LENGTH, i * LENGTH + LENGTH)));
  return guessSet.has(word.toLowerCase());
}

export function score(guess: string, word: string): string {
  const g = guess.toLowerCase();
  const w = word.toLowerCase();
  const marks = Array<number>(LENGTH).fill(0);
  const left = new Map<string, number>();
  for (let i = 0; i < LENGTH; i++) {
    if (g[i] === w[i]) marks[i] = 2;
    else left.set(w[i], (left.get(w[i]) ?? 0) + 1);
  }
  for (let i = 0; i < LENGTH; i++) {
    if (marks[i] === 2) continue;
    const n = left.get(g[i]) ?? 0;
    if (n > 0) {
      marks[i] = 1;
      left.set(g[i], n - 1);
    }
  }
  return marks.join("");
}

export const alive = (s: WordleState) => s.players.flatMap((p, i) => (p.out ? [] : [i]));

export const roundsFor = (goal: number) => goal + 3;

function pickStock(n: number, rng: Rng): Stock[] {
  const keys = [...ITEM_KEYS];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const left = Math.max(1, Math.ceil(n / 4));
  return keys
    .slice(0, SHOP_SIZE)
    .sort((a, b) => ITEM_KEYS.indexOf(a) - ITEM_KEYS.indexOf(b))
    .map((item) => ({ item, left }));
}

export function pickWords(answers: string, count: number, rng: Rng): string[] {
  const total = answers.length / LENGTH;
  const chosen = new Set<number>();
  while (chosen.size < Math.min(count, total)) chosen.add(Math.floor(rng() * total));
  return [...chosen].map((i) => answers.slice(i * LENGTH, i * LENGTH + LENGTH));
}

const freshMine = (round: number): Mine => ({ round, guesses: [], marks: [], pick: null });

export function newGame(n: number, rules: Rules, rng: Rng): { s: WordleState; mine: Mine[] } {
  const s: WordleState = {
    rules,
    round: 0,
    rounds: roundsFor(rules.goal),
    seq: 0,
    over: false,
    deadline: null,
    players: Array.from({ length: n }, () => ({
      coins: START_COINS,
      solved: 0,
      guesses: 0,
      rows: 0,
      max: ROWS,
      done: false,
      won: false,
      earned: 0,
      picked: false,
      effects: [],
    })),
    stock: rules.shop ? pickStock(n, rng) : [],
    history: [],
  };
  return { s, mine: s.players.map(() => freshMine(0)) };
}

export const has = (p: Player, item: ItemKey) => p.effects.some((e) => e.item === item);

export function jammed(p: Player): string {
  if (p.rows >= JAM_TURNS) return "";
  return p.effects.flatMap((e) => (e.item === "jam" && e.letters ? [e.letters] : [])).join("");
}

export const fogged = (p: Player, row: number) => has(p, "fog") && row < FOG_ROWS && row < p.rows - 1;

export function cantGuess(s: WordleState, seat: number, word: string): string | null {
  const p = s.players[seat];
  if (s.over) return "This game is over.";
  if (!p || p.out) return "You're out of this game.";
  if (p.done) return "You're done with this word.";
  if (word.length !== LENGTH) return "Five letters.";
  if (!/^[a-z]+$/i.test(word)) return "Letters only.";
  if (!isGuessable(word)) return "Not in the word list.";
  const locked = [...jammed(p)].filter((ch) => word.toLowerCase().includes(ch));
  if (locked.length) return `${locked.join(", ").toUpperCase()} ${locked.length === 1 ? "is" : "are"} jammed for now.`;
  return null;
}

function greensFound(marks: string[]) {
  let n = 0;
  for (let i = 0; i < LENGTH; i++) if (marks.some((m) => m[i] === "2")) n++;
  return n;
}

function pay(p: Player, mine: Mine) {
  const greens = greensFound(mine.marks);
  const solve = p.won ? SOLVE_PAY + (p.max - p.rows) : 0;
  p.earned = BASE_PAY + greens + solve;
  p.coins += p.earned;
  p.guesses += p.won ? p.rows : ROWS + 1;
  if (p.won) p.solved++;
}

export function guess(s0: WordleState, mine0: Mine, seat: number, word: string, answer: string) {
  const why = cantGuess(s0, seat, word);
  if (why) throw new Error(why);
  const s = structuredClone(s0);
  const mine = structuredClone(mine0);
  const p = s.players[seat];
  const lower = word.toLowerCase();
  const marks = score(lower, answer);
  mine.guesses.push(lower);
  mine.marks.push(marks);
  p.rows++;
  p.won = marks === "2".repeat(LENGTH);
  if (p.won || p.rows >= p.max) {
    p.done = true;
    pay(p, mine);
    if (!s.rules.shop || lastWord(s)) p.picked = true;
  }
  s.seq++;
  return { s, mine };
}

export function lastWord(s: WordleState) {
  return s.round + 1 >= s.rounds || s.players.some((p) => !p.out && p.done && p.solved >= s.rules.goal);
}

export function cantPick(s: WordleState, seat: number, pick: Pick): string | null {
  const p = s.players[seat];
  if (s.over) return "This game is over.";
  if (!p || p.out) return "You're out of this game.";
  if (!s.rules.shop) return "The shop is off in this game.";
  if (!p.done) return "Finish your word first.";
  if (lastWord(s)) return "No shop after the last word.";
  if (!pick) return null;
  const def = ITEMS[pick.item];
  if (!s.stock.some((x) => x.item === pick.item)) return "That's not in the shop this round.";
  if (p.coins < def.price) return "Not enough coins.";
  if (def.target) {
    const t = s.players[pick.target];
    if (pick.target === seat || !t || t.out) return "Pick someone else to throw it at.";
  }
  return null;
}

export function choose(s0: WordleState, mine0: Mine, seat: number, pick: Pick) {
  const why = cantPick(s0, seat, pick);
  if (why) throw new Error(why);
  const s = structuredClone(s0);
  const mine = { ...mine0, pick: pick && { item: pick.item, target: ITEMS[pick.item].target ? pick.target : seat } };
  s.players[seat].picked = true;
  s.seq++;
  return { s, mine };
}

export const waitingOn = (s: WordleState) =>
  s.over ? [] : alive(s).filter((i) => !s.players[i].done || (!s.players[i].picked && !lastWord(s)));

export const roundDone = (s: WordleState) => !s.over && waitingOn(s).length === 0;

export const buyOrder = (s: WordleState) =>
  alive(s).sort((a, b) => {
    const x = s.players[a];
    const y = s.players[b];
    return x.coins - y.coins || x.solved - y.solved || a - b;
  });

function rankKey(p: Player) {
  return [-p.solved, p.guesses, -p.coins];
}

export function standings(s: WordleState): number[][] {
  const order = s.players
    .map((p, i) => ({ i, p }))
    .sort((a, b) => {
      if (!!a.p.out !== !!b.p.out) return a.p.out ? 1 : -1;
      const ka = rankKey(a.p);
      const kb = rankKey(b.p);
      for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k];
      return 0;
    });
  const groups: number[][] = [];
  for (const { i, p } of order) {
    const last = groups.at(-1);
    const q = last && s.players[last[0]];
    if (q && !p.out && !q.out && rankKey(p).every((v, k) => v === rankKey(q)[k])) last.push(i);
    else groups.push([i]);
  }
  return groups;
}

export type Resolved = { s: WordleState; mine: Mine[]; buys: Buy[] };

export function finishRound(s0: WordleState, mine0: Mine[], words: string[], rng: Rng, force = false): Resolved {
  const s = structuredClone(s0);
  const mines = structuredClone(mine0);
  const word = words[s.round];
  for (const i of alive(s)) {
    const p = s.players[i];
    if (!p.done) {
      p.done = true;
      p.won = false;
      pay(p, mines[i]);
    }
  }
  if (!force && waitingOn(s).length) throw new Error("Not everyone's done yet.");
  const ending = lastWord(s) || alive(s).length < 2;
  const buys: Buy[] = [];
  const next: Effect[][] = s.players.map(() => []);
  if (!ending && s.rules.shop) {
    const left = new Map(s.stock.map((x) => [x.item, x.left]));
    for (const seat of buyOrder(s)) {
      const pick = mines[seat].pick;
      if (!pick) continue;
      const def = ITEMS[pick.item];
      const target = def.target ? pick.target : seat;
      const ok = (left.get(pick.item) ?? 0) > 0 && s.players[seat].coins >= def.price && !s.players[target]?.out;
      if (ok) {
        left.set(pick.item, (left.get(pick.item) ?? 0) - 1);
        s.players[seat].coins -= def.price;
      }
      buys.push({ seat, item: pick.item, target, got: ok });
    }
    const shielded = new Set(buys.filter((b) => b.got && b.item === "shield").map((b) => b.seat));
    for (const b of buys) {
      if (!b.got || b.item === "shield") continue;
      if (ITEMS[b.item].target && shielded.has(b.target)) {
        shielded.delete(b.target);
        b.blocked = true;
        continue;
      }
      if (b.item === "pickpocket") {
        const took = Math.min(STEAL, s.players[b.target].coins);
        s.players[b.target].coins -= took;
        s.players[b.seat].coins += took;
        b.took = took;
        continue;
      }
      const effect: Effect = { item: b.item, by: b.seat };
      if (b.item === "jam") effect.letters = jamLetters(next[b.target], rng);
      next[b.target].push(effect);
    }
  }
  s.history.push({
    word,
    boards: s.players.map((_, i) => ({ guesses: mines[i].guesses, marks: mines[i].marks, won: s.players[i].won })),
    buys,
  });
  s.seq++;
  if (ending || s.players.some((p) => !p.out && p.solved >= s.rules.goal)) {
    s.over = true;
    s.deadline = null;
    return { s, mine: mines, buys };
  }
  s.round++;
  const nextWord = words[s.round];
  const nextMine = s.players.map(() => freshMine(s.round));
  s.players.forEach((p, i) => {
    const fx = next[i];
    const count = (k: ItemKey) => fx.filter((e) => e.item === k).length;
    p.rows = 0;
    p.done = false;
    p.won = false;
    p.earned = 0;
    p.picked = false;
    p.effects = fx;
    p.max = Math.min(MAX_ROWS, Math.max(MIN_ROWS, ROWS - count("fuse") + count("extra")));
    if (count("hint") && nextWord) {
      const at = Math.floor(rng() * LENGTH);
      nextMine[i].hint = { at, letter: nextWord[at] };
    }
    if (p.out) p.done = p.picked = true;
  });
  s.stock = s.rules.shop ? pickStock(alive(s).length, rng) : [];
  return { s, mine: nextMine, buys };
}

function jamLetters(already: Effect[], rng: Rng) {
  const taken = already.map((e) => e.letters ?? "").join("");
  const pool = [...JAMMABLE].filter((ch) => !taken.includes(ch));
  const out: string[] = [];
  while (out.length < 2 && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out.join("");
}

export function leave(s0: WordleState, seat: number) {
  const s = structuredClone(s0);
  const p = s.players[seat];
  if (!p || p.out) return s;
  p.out = true;
  p.done = true;
  p.picked = true;
  s.seq++;
  return s;
}

export type Key = 0 | 1 | 2;

export function keyColors(guesses: string[], marks: string[]): Record<string, Key> {
  const out: Record<string, Key> = {};
  guesses.forEach((g, r) => {
    for (let i = 0; i < LENGTH; i++) {
      const m = Number(marks[r][i]) as Key;
      const ch = g[i];
      if (out[ch] === undefined || m > out[ch]) out[ch] = m;
    }
  });
  return out;
}
