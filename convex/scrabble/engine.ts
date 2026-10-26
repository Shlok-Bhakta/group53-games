// Scrabble, the way Letter League plays it: 2 to 8 players on one board, a rack each. The core rules (which
// plays are legal, which words they form, how they score, the standard board, letter values and bag) come
// from @bglowacki/bingo-engine, set up for English Scrabble. On top of it we add what Letter League has and
// the library doesn't: a bigger board (handed to the engine as its layout) and Wild bonuses (scored here from
// the engine's per-word breakdown), plus turns, seats and standings.
//
// Pure and shared by the server (which validates every play) and the phones (which preview the score as you
// place tiles). Checking words against the dictionary is the server's job (convex/scrabble/dictionary.ts),
// so the engine here runs with a dictionary that accepts anything and only judges the shape of a play.
import {
  BLANK_FLAG,
  ENGLISH_ALPHABET,
  SCRABBLE_CLASSIC_RULES,
  SCRABBLE_LAYOUT_15X15,
  createBingoEngine,
  type Board,
  type BingoEngine,
  type Placement as EnginePlacement,
} from "@bglowacki/bingo-engine";

const A = ENGLISH_ALPHABET;
// Points per letter ("?" is the blank).
export const VALUES: Record<string, number> = Object.fromEntries(A.labels.map((l, id) => [id === 0 ? "?" : l.toUpperCase(), A.scores[id]]));
export const BINGO = SCRABBLE_CLASSIC_RULES.bingoBonus;

// "T" triple word, "D" double word, "t" triple letter, "d" double letter, "*" the centre (double word).
export type Premium = "T" | "D" | "t" | "d" | "*" | ".";
const KIND: Record<string, Premium> = { TWS: "T", DWS: "D", TLS: "t", DLS: "d" };
const ENGINE_KIND = { T: "TWS", D: "DWS", "*": "DWS", t: "TLS", d: "DLS" } as const;

// The standard board, straight from the engine.
const LAYOUT_15: string[] = (() => {
  const n = SCRABBLE_LAYOUT_15X15.size;
  const grid = Array.from({ length: n }, () => Array<Premium>(n).fill("."));
  for (const p of SCRABBLE_LAYOUT_15X15.premiums) grid[p.row][p.col] = KIND[p.kind];
  const c = SCRABBLE_LAYOUT_15X15.centerStart;
  if (c) grid[c.row][c.col] = "*";
  return grid.map((r) => r.join(""));
})();

// Our big board for bigger games, built from one eighth of it (distances from the centre, a >= b) mirrored
// eight ways.
const OCTANT_21: Record<Exclude<Premium, ".">, [number, number][]> = {
  "*": [[0, 0]],
  T: [[10, 10], [10, 0]],
  D: [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]],
  t: [[2, 2], [6, 2], [9, 9], [10, 5]],
  d: [[1, 1], [4, 0], [5, 1], [7, 3], [10, 7], [9, 2]],
};
const LAYOUT_21: string[] = (() => {
  const c = 10;
  const grid = Array.from({ length: 21 }, () => Array<Premium>(21).fill("."));
  for (const [kind, cells] of Object.entries(OCTANT_21) as [Premium, [number, number][]][]) {
    for (const [a, b] of cells) for (const [dx, dy] of [[a, b], [b, a]]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) grid[c + sy * dy][c + sx * dx] = kind;
  }
  return grid.map((r) => r.join(""));
})();

const LAYOUTS: Record<number, string[]> = { 15: LAYOUT_15, 21: LAYOUT_21 };
export const SIZES = [15, 21] as const;
export const layout = (size: number) => LAYOUTS[size] ?? LAYOUT_15;
export const premiumAt = (size: number, x: number, y: number) => (layout(size)[y]?.[x] ?? ".") as Premium;
export const centre = (size: number) => (layout(size).length - 1) / 2;

// Our layouts in the engine's terms.
function engineLayout(size: number) {
  const rows = layout(size);
  const premiums = rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === "." ? [] : [{ row: y, col: x, kind: ENGINE_KIND[c as keyof typeof ENGINE_KIND] }])));
  const c = centre(size);
  return { size: rows.length, premiums, centerStart: { row: c, col: c } };
}

// A tile in a rack. `letter` is "?" for a blank.
export type Tile = { id: number; letter: string };
// A tile on the board. Blanks show the letter they stand for and score nothing.
export type Placed = { x: number; y: number; letter: string; blank?: boolean; seat: number; turn: number };
// A tile someone is putting down this turn. `letter` names what a blank plays as.
export type Placement = { id: number; x: number; y: number; letter?: string };

// Settings that change the rules. A bingo is always using the whole rack. Wild (Letter League's default):
// a bonus square keeps working for every later word through its tile, not just the turn it's covered.
export type Rules = { size: number; rack: number; wild: boolean };
export const rulesOf = (settings: Record<string, number>): Rules => ({ size: settings.board ?? 15, rack: settings.rack ?? SCRABBLE_CLASSIC_RULES.rackSize, wild: settings.wild === 1 });

const engines = new Map<string, BingoEngine>();
const anyWord = { has: () => true, hasPrefix: () => true };
function engineFor(rules: Rules) {
  const k = `${rules.size}:${rules.rack}`;
  let e = engines.get(k);
  if (!e) {
    e = createBingoEngine({ alphabet: A, layout: engineLayout(rules.size), rules: { ...SCRABBLE_CLASSIC_RULES, rackSize: rules.rack, bingoSize: rules.rack }, dictionary: anyWord });
    engines.set(k, e);
  }
  return e;
}

// Wild scoring, from the engine's breakdown of a word: the same sum, but every tile's square counts, old or
// new. (Classic scoring is the engine's own.)
function wildScore(size: number, cells: readonly { row: number; col: number; letter: string; isBlank: boolean }[]) {
  let sum = 0;
  let mult = 1;
  for (const c of cells) {
    let v = c.isBlank ? 0 : (VALUES[c.letter.toUpperCase()] ?? 0);
    const p = premiumAt(size, c.col, c.row);
    if (p === "d") v *= 2;
    if (p === "t") v *= 3;
    if (p === "D" || p === "*") mult *= 2;
    if (p === "T") mult *= 3;
    sum += v;
  }
  return sum * mult;
}

// The bag for a game, as letters, unshuffled: the standard English bag scaled by `percent` (at least one of
// each letter).
export function bagLetters(percent = 100): string[] {
  const out: string[] = [];
  A.labels.forEach((label, id) => {
    const count = Math.max(1, Math.round((A.counts[id] * percent) / 100));
    for (let i = 0; i < count; i++) out.push(id === 0 ? "?" : label.toUpperCase());
  });
  return out;
}

export function shuffle<T>(xs: T[], random: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const rackValue = (rack: { letter: string }[]) => rack.reduce((s, t) => s + (VALUES[t.letter] ?? 0), 0);

export type Word = { word: string; score: number; cells: [number, number][] };
export type Evaluation = { ok: true; words: Word[]; score: number; bingo: boolean } | { ok: false; error: string };

const key = (x: number, y: number) => `${x},${y}`;
export const boardMap = (tiles: Placed[]) => new Map(tiles.map((t) => [key(t.x, t.y), t]));

const idOf = (letter: string) => A.labelToId[letter.toLowerCase()];
function engineBoard(tiles: Placed[], size: number): Board {
  const rows = Array.from({ length: size }, () => Array<{ tileId: number } | null>(size).fill(null));
  for (const t of tiles) rows[t.y][t.x] = { tileId: t.blank ? idOf(t.letter) | BLANK_FLAG : idOf(t.letter) };
  return rows;
}

const REASONS: Record<string, string> = {
  "empty-placement": "Put some tiles down first.",
  "out-of-bounds": "That's off the board.",
  "has-gap": "Leave no gaps between your tiles.",
  "overlaps-existing-different-letter": "That square is taken.",
  "first-move-not-on-center": "The first word goes through the centre star.",
  "not-connected": "Build off a word that's already down.",
  "rack-mismatch": "That tile isn't in your rack.",
};

// Checks a play and scores it. Placements are tiles on any squares; this finds the line they make, fills in
// the tiles already on the board between them, and hands that to the engine.
export function evaluate(board: Placed[], placement: Placement[], rack: Tile[], rules: Rules): Evaluation {
  if (placement.length === 0) return { ok: false, error: REASONS["empty-placement"] };
  const { size } = rules;
  const map = boardMap(board);
  const byId = new Map(rack.map((t) => [t.id, t]));
  const fresh = new Map<string, { letter: string; blank: boolean }>();
  for (const p of placement) {
    const tile = byId.get(p.id);
    if (!tile) return { ok: false, error: REASONS["rack-mismatch"] };
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= size || p.y >= size) return { ok: false, error: REASONS["out-of-bounds"] };
    if (map.has(key(p.x, p.y)) || fresh.has(key(p.x, p.y))) return { ok: false, error: REASONS["overlaps-existing-different-letter"] };
    const blank = tile.letter === "?";
    const letter = blank ? (p.letter ?? "").toUpperCase() : tile.letter;
    if (blank && !/^[A-Z]$/.test(letter)) return { ok: false, error: "Pick a letter for your blank." };
    fresh.set(key(p.x, p.y), { letter, blank });
  }
  if (new Set(placement.map((p) => p.id)).size !== placement.length) return { ok: false, error: "That tile is down twice." };
  const xs = new Set(placement.map((p) => p.x));
  const ys = new Set(placement.map((p) => p.y));
  if (xs.size > 1 && ys.size > 1) return { ok: false, error: "Keep your tiles in one line." };

  // One tile reads along whichever line it joins.
  const at = (x: number, y: number) => fresh.get(key(x, y)) ?? map.get(key(x, y));
  const p0 = placement[0];
  const horizontal = placement.length > 1 ? ys.size === 1 : !!(at(p0.x - 1, p0.y) || at(p0.x + 1, p0.y));
  const along = placement.map((p) => (horizontal ? p.x : p.y));
  const [from, to] = [Math.min(...along), Math.max(...along)];
  const tiles: EnginePlacement["tiles"][number][] = [];
  for (let i = from; i <= to; i++) {
    const t = horizontal ? at(i, p0.y) : at(p0.x, i);
    if (!t) return { ok: false, error: REASONS["has-gap"] };
    tiles.push({ letter: t.letter.toLowerCase(), isBlank: !!t.blank });
  }
  const play: EnginePlacement = { startRow: horizontal ? p0.y : from, startCol: horizontal ? from : p0.x, direction: horizontal ? "horizontal" : "vertical", tiles };
  const engine = engineFor(rules);
  const before = engineBoard(board, size);
  const rackTiles = placement.map((p) => ({ tileId: byId.get(p.id)!.letter === "?" ? 0 : idOf(byId.get(p.id)!.letter) }));
  const check = engine.validatePlacement(before, play, rackTiles);
  if (!check.valid) return { ok: false, error: REASONS[check.reason ?? ""] ?? "That play doesn't fit." };
  const scored = engine.scorePlacement(before, play);
  const words = scored.words
    .filter((w) => w.word.length > 1)
    .map((w) => ({ word: w.word.toUpperCase(), score: rules.wild ? wildScore(size, w.cells) : w.score, cells: w.cells.map((c) => [c.col, c.row] as [number, number]) }));
  if (words.length === 0) return { ok: false, error: "Words need at least two letters." };
  // The main word (the one through every new tile) first.
  const main = words.findIndex((w) => placement.every((p) => w.cells.some(([x, y]) => x === p.x && y === p.y)));
  if (main > 0) words.unshift(...words.splice(main, 1));
  const total = rules.wild ? words.reduce((s, w) => s + w.score, 0) + (scored.bingo ? BINGO : 0) : scored.total;
  return { ok: true, words, score: total, bingo: scored.bingo };
}

// The state everyone can see, stored in matches.state. Racks and the bag are secret (see convex/scrabble.ts).
export type Move = {
  seat: number;
  kind: "play" | "swap" | "pass" | "timeout" | "resign";
  score: number;
  words?: { word: string; score: number }[];
  bingo?: boolean;
  // How many tiles went down or were swapped.
  count?: number;
  at: number;
};

export type ScrabbleState = {
  kind: "scrabble";
  size: number;
  tiles: Placed[];
  scores: number[];
  // Tiles each seat holds, and tiles left in the bag.
  racks: number[];
  bag: number;
  // The seat to move; -1 once it's over.
  turn: number;
  round: number;
  // Turns in a row nobody scored (passes, swaps, timeouts). Everyone doing it twice ends the game.
  scoreless: number;
  // Seats that resigned. They score nothing more and are skipped.
  out: number[];
  moves: Move[];
  // Live games: when the current turn runs out.
  deadline: number | null;
  // End of game: what each seat's leftover tiles cost them (or earned, for whoever went out).
  adjust?: number[];
};

// The next seat still in, after `seat`.
export function nextSeat(state: Pick<ScrabbleState, "out" | "scores">, seat: number) {
  const n = state.scores.length;
  for (let i = 1; i <= n; i++) {
    const s = (seat + i) % n;
    if (!state.out.includes(s)) return s;
  }
  return seat;
}

// Places best first, ties sharing a place, by final score. Resigned seats come last, in the order they left
// (the last to leave placing higher).
export function standings(state: ScrabbleState): number[][] {
  const inSeats = state.scores.map((_, i) => i).filter((s) => !state.out.includes(s));
  const groups: number[][] = [];
  for (const s of [...inSeats].sort((a, b) => state.scores[b] - state.scores[a])) {
    const last = groups.at(-1);
    if (last && state.scores[last[0]] === state.scores[s]) last.push(s);
    else groups.push([s]);
  }
  return [...groups, ...[...state.out].reverse().map((s) => [s])];
}
