import { GUESSES } from "./words";

export const LENGTH = 5;
export const ROWS = 6;
export const MIN_ROWS = 3;
export const MAX_ROWS = 8;
export const START_COINS = 5;
export const BASE_PAY = 1;
export const SOLVE_PAY = 3;
export const STEAL = 10;
export const JAM_TURNS = 2;
export const FOG_ROWS = 2;
export const IN_STOCK_AT_LEAST = 6;
export const MAX_CART = 6;
const JAMMABLE = "earotlisnc";

export type ItemKey = "fog" | "fuse" | "jam" | "pickpocket" | "dark" | "tax" | "shield" | "clue" | "hint" | "extra" | "payday";

export type ItemDef = { name: string; price: number; target: boolean; rare?: boolean; text: string };

export const ITEMS: Record<ItemKey, ItemDef> = {
  dark: { name: "Blackout", price: 6, target: true, text: "Their keyboard shows no colors on their next word." },
  pickpocket: { name: "Pickpocket", price: 6, target: true, text: `Take up to ${STEAL} of the coins they have left after this shop.` },
  jam: { name: "Jam", price: 8, target: true, text: "Two common letters lock on their keyboard for their first two guesses." },
  tax: { name: "Tax", price: 9, target: true, text: "They earn half as much from their next word." },
  fog: { name: "Fog", price: 13, target: true, text: "Their top two rows fog over once they've guessed past them." },
  fuse: { name: "Short fuse", price: 14, target: true, rare: true, text: "One guess fewer on their next word." },
  clue: { name: "Clue", price: 5, target: false, text: "One letter of your next word lights up yellow on your keyboard." },
  shield: { name: "Shield", price: 7, target: false, text: "Blocks one thing thrown at you in this shop." },
  payday: { name: "Payday", price: 8, target: false, text: "Double what you earn from your next word." },
  extra: { name: "Extra row", price: 10, target: false, text: "One more guess on your next word." },
  hint: { name: "Hint", price: 12, target: false, rare: true, text: "Start your next word with one letter already green." },
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
  over: boolean;
  deadline: number | null;
  players: Player[];
  stock: Stock[];
  history: Round[];
};

export type Pick = { item: ItemKey; target: number } | null;

export type Cart = { item: ItemKey; target: number }[];

export type Mine = {
  round: number;
  guesses: string[];
  marks: string[];
  pick: Pick;
  cart?: Cart;
  lost?: ItemKey[];
  hint?: { at: number; letter: string };
  clue?: string;
};

export const cartOf = (mine: Mine): Cart => mine.cart ?? (mine.pick ? [mine.pick] : []);

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

export const stockCap = (item: ItemKey, n: number) => Math.max(1, Math.ceil(n / (ITEMS[item].rare ? 3 : 2)));

export function pickStock(n: number, rng: Rng): Stock[] {
  const stock = ITEM_KEYS.map((item) => ({ item, left: Math.floor(rng() * (stockCap(item, n) + 1)) }));
  const empty = stock.filter((x) => x.left === 0);
  while (stock.length - empty.length < IN_STOCK_AT_LEAST && empty.length) empty.splice(Math.floor(rng() * empty.length), 1)[0].left = 1;
  return stock;
}

export const leftOf = (s: WordleState, item: ItemKey) => s.stock.find((x) => x.item === item)?.left ?? 0;

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

export function payFor(p: Player, marks: string[]) {
  const solve = p.won ? SOLVE_PAY + (p.max - p.rows) : 0;
  let earned = BASE_PAY + greensFound(marks) + solve;
  const count = (k: ItemKey) => p.effects.filter((e) => e.item === k).length;
  for (let i = 0; i < count("payday"); i++) earned *= 2;
  for (let i = 0; i < count("tax"); i++) earned = Math.floor(earned / 2);
  return earned;
}

function pay(p: Player, mine: Mine) {
  p.earned = payFor(p, mine.marks);
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
  return { s, mine };
}

export function lastWord(s: WordleState) {
  return s.round + 1 >= s.rounds || s.players.some((p) => !p.out && p.done && p.solved >= s.rules.goal);
}

export const cartCost = (cart: Cart) => cart.reduce((n, x) => n + ITEMS[x.item].price, 0);

export type LeftFor = (item: ItemKey) => number;

export function cantPick(s: WordleState, seat: number, cart: Cart, leftFor: LeftFor = (k) => leftOf(s, k)): string | null {
  const p = s.players[seat];
  if (s.over) return "This game is over.";
  if (!p || p.out) return "You're out of this game.";
  if (!s.rules.shop) return "The shop is off in this game.";
  if (!p.done) return "Finish your word first.";
  if (lastWord(s)) return "No shop after the last word.";
  if (cart.length > MAX_CART) return `${MAX_CART} things at most.`;
  for (const x of cart) {
    if (!isItem(x.item)) return "That's not in the shop.";
    const wanted = cart.filter((y) => y.item === x.item).length;
    const left = leftFor(x.item);
    if (!left) return `${ITEMS[x.item].name} is sold out for you this round.`;
    if (wanted > left) return `Only ${left} ${ITEMS[x.item].name} in the shop.`;
    if (ITEMS[x.item].target) {
      const t = s.players[x.target];
      if (x.target === seat || !t || t.out) return "Pick someone else to throw it at.";
    }
  }
  if (cartCost(cart) > p.coins) return "Not enough coins.";
  return null;
}

function claimedAhead(s: WordleState, mines0: Mine[], seat: number) {
  const mines = structuredClone(mines0);
  reconcile(structuredClone(s), mines);
  const claimed = new Map<ItemKey, number>();
  for (const i of buyOrder(s)) {
    if (i === seat) break;
    for (const x of cartOf(mines[i])) claimed.set(x.item, (claimed.get(x.item) ?? 0) + 1);
  }
  return claimed;
}

export function leftForSeat(s: WordleState, mines: Mine[], seat: number): Record<ItemKey, number> {
  const claimed = claimedAhead(s, mines, seat);
  return Object.fromEntries(ITEM_KEYS.map((k) => [k, Math.max(0, leftOf(s, k) - (claimed.get(k) ?? 0))])) as Record<ItemKey, number>;
}

export type Bumped = { seat: number; lost: ItemKey[] };

export function fitCart(cart: Cart, left: (item: ItemKey) => number, coins: number) {
  const used = new Map<ItemKey, number>();
  let spent = 0;
  return cart.filter((x) => {
    const n = used.get(x.item) ?? 0;
    if (!isItem(x.item) || n >= left(x.item) || spent + ITEMS[x.item].price > coins) return false;
    used.set(x.item, n + 1);
    spent += ITEMS[x.item].price;
    return true;
  });
}

export function reconcile(s: WordleState, mines: Mine[]): Bumped[] {
  const claimed = new Map<ItemKey, number>();
  const bumped: Bumped[] = [];
  for (const seat of buyOrder(s)) {
    const kept: Cart = [];
    const lost: ItemKey[] = [];
    let spent = 0;
    for (const x of cartOf(mines[seat])) {
      const n = claimed.get(x.item) ?? 0;
      const target = s.players[x.target];
      const price = isItem(x.item) ? ITEMS[x.item].price : Infinity;
      if (n < leftOf(s, x.item) && target && !target.out && spent + price <= s.players[seat].coins) {
        claimed.set(x.item, n + 1);
        spent += price;
        kept.push(x);
      } else lost.push(x.item);
    }
    if (!lost.length) continue;
    mines[seat] = { ...mines[seat], cart: kept, pick: kept[0] ?? null, lost: [...(mines[seat].lost ?? []), ...lost] };
    s.players[seat].picked = false;
    bumped.push({ seat, lost });
  }
  return bumped;
}

export function choose(s0: WordleState, mines0: Mine[], seat: number, cart0: Cart) {
  const why = cantPick(s0, seat, cart0, (k) => leftForSeat(s0, mines0, seat)[k]);
  if (why) throw new Error(why);
  const s = structuredClone(s0);
  const mines = structuredClone(mines0);
  const cart = cart0.map((x) => ({ item: x.item, target: ITEMS[x.item].target ? x.target : seat }));
  mines[seat] = { ...mines[seat], cart, pick: cart[0] ?? null, lost: undefined };
  s.players[seat].picked = true;
  const bumped = reconcile(s, mines);
  return { s, mines, bumped };
}

export const waitingOn = (s: WordleState) =>
  s.over ? [] : alive(s).filter((i) => !s.players[i].done || (!s.players[i].picked && !lastWord(s)));

export const roundDone = (s: WordleState) => !s.over && waitingOn(s).length === 0;

export const coinsGoingIn = (p: Player) => p.coins - p.earned;
const solvedGoingIn = (p: Player) => p.solved - (p.done && p.won ? 1 : 0);

export const buyOrder = (s: WordleState) =>
  alive(s).sort((a, b) => {
    const x = s.players[a];
    const y = s.players[b];
    return coinsGoingIn(x) - coinsGoingIn(y) || solvedGoingIn(x) - solvedGoingIn(y) || a - b;
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
      for (const x of cartOf(mines[seat])) {
        if (!isItem(x.item)) continue;
        const def = ITEMS[x.item];
        const target = def.target ? x.target : seat;
        const ok = (left.get(x.item) ?? 0) > 0 && s.players[seat].coins >= def.price && !!s.players[target] && !s.players[target].out;
        if (ok) {
          left.set(x.item, (left.get(x.item) ?? 0) - 1);
          s.players[seat].coins -= def.price;
        }
        buys.push({ seat, item: x.item, target, got: ok });
      }
    }
    const shields = new Map<number, number>();
    for (const b of buys) if (b.got && b.item === "shield") shields.set(b.seat, (shields.get(b.seat) ?? 0) + 1);
    for (const b of buys) {
      if (!b.got || b.item === "shield") continue;
      const shield = shields.get(b.target) ?? 0;
      if (ITEMS[b.item].target && shield > 0) {
        shields.set(b.target, shield - 1);
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
    if (count("clue") && nextWord) {
      const pool = [...new Set(nextWord)].filter((ch) => ch !== nextMine[i].hint?.letter);
      if (pool.length) nextMine[i].clue = pool[Math.floor(rng() * pool.length)];
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
