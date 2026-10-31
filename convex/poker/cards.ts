// Playing cards and poker hand rankings. Pure, shared by the server and phones (a phone names its own hand
// as the board comes out). A card is two characters: rank then suit, "As", "Td", "7c".

export type Card = string;
export const RANKS = "23456789TJQKA";
export const SUITS = "shdc";

export const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2; // 2..14
export const suitOf = (c: Card) => c[1];

// A full 52-card deck, or Short Deck's 36 (sixes and up).
export function deckOf(short: boolean): Card[] {
  const ranks = short ? RANKS.slice(4) : RANKS;
  return [...ranks].flatMap((r) => [...SUITS].map((s) => r + s));
}

export function shuffle<T>(xs: T[], random: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Hand categories, weakest first, as named in the standard game.
export const CATEGORY = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"] as const;
// Short Deck (Triton rules): with fewer cards a flush is rarer than a full house, and a straight more common
// than three of a kind, so those swap places. The wheel is A-6-7-8-9.
const SHORT_ORDER = [0, 1, 2, 4, 3, 6, 5, 7, 8];

export type HandRank = { score: number; category: number; name: string; cards: Card[] };

const WORD: Record<number, string> = { 14: "Ace", 13: "King", 12: "Queen", 11: "Jack", 10: "Ten" };
const one = (r: number) => WORD[r] ?? String(r);
const many = (r: number) => (WORD[r] ? `${WORD[r]}s` : `${r}s`);

// Ranks up to five cards. Fewer than five can still pair up (a phone naming "Pair of Aces" before the flop),
// but only five make a straight or flush.
export function rank5(cards: Card[], short = false): HandRank {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Groups by size, then rank: [[K,3],[7,2]] for a full house.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const five = cards.length === 5;
  const flush = five && cards.every((c) => suitOf(c) === suitOf(cards[0]));
  let straightHigh = 0;
  if (five && groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    const wheel = short ? [14, 9, 8, 7, 6] : [14, 5, 4, 3, 2];
    if (ranks.every((r, i) => r === wheel[i])) straightHigh = wheel[1];
  }
  let cat: number;
  let kickers: number[];
  if (straightHigh && flush) [cat, kickers] = [8, [straightHigh]];
  else if (groups[0][1] === 4) [cat, kickers] = [7, groups.map((g) => g[0])];
  else if (groups[0][1] === 3 && groups[1]?.[1] === 2) [cat, kickers] = [6, groups.map((g) => g[0])];
  else if (flush) [cat, kickers] = [5, ranks];
  else if (straightHigh) [cat, kickers] = [4, [straightHigh]];
  else if (groups[0][1] === 3) [cat, kickers] = [3, groups.map((g) => g[0])];
  else if (groups[0][1] === 2 && groups[1]?.[1] === 2) [cat, kickers] = [2, groups.map((g) => g[0])];
  else if (groups[0][1] === 2) [cat, kickers] = [1, groups.map((g) => g[0])];
  else [cat, kickers] = [0, ranks];
  const order = short ? SHORT_ORDER[cat] : cat;
  let score = order;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] ?? 0);
  const [a, b] = [groups[0][0], groups[1]?.[0]];
  const name = [
    `${one(ranks[0])} high`,
    `Pair of ${many(a)}`,
    `Two pair, ${many(a)} and ${many(b)}`,
    `Three ${many(a)}`,
    `Straight, ${one(straightHigh)} high`,
    `Flush, ${one(ranks[0])} high`,
    `Full house, ${many(a)} full of ${many(b)}`,
    `Four ${many(a)}`,
    straightHigh === 14 ? "Royal flush" : `Straight flush, ${one(straightHigh)} high`,
  ][cat];
  return { score, category: cat, name, cards };
}

function combos<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [head, ...rest] = xs;
  return [...combos(rest, k - 1).map((c) => [head, ...c]), ...combos(rest, k)];
}

function bestOf(sets: Card[][], short: boolean): HandRank | null {
  let best: HandRank | null = null;
  for (const s of sets) {
    const r = rank5(s, short);
    if (!best || r.score > best.score) best = r;
  }
  return best;
}

export type Variant = "holdem" | "omaha" | "short" | "draw";

// The best hand a player has: Hold'em and Short Deck use any five of their cards and the board, Omaha exactly
// two of their four and three from the board, draw poker just their five. Null until there's enough to say.
export function bestHand(variant: Variant, hole: Card[], board: Card[]): HandRank | null {
  if (hole.length === 0) return null;
  const short = variant === "short";
  if (variant === "draw") return rank5(hole, false);
  if (variant === "omaha") {
    if (board.length < 3) return null;
    return bestOf(combos(hole, 2).flatMap((h) => combos(board, 3).map((b) => [...h, ...b])), false);
  }
  const all = [...hole, ...board];
  return bestOf(all.length <= 5 ? [all] : combos(all, 5), short);
}
