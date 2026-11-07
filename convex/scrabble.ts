import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { finishBySeats } from "./matches";
import { MODES, settingsOf, type ModeKey } from "./modes";
import type { GameHooks } from "./games";
import { SEAT_COLORS, loadMatch, onTurn, requireUser, seatOf } from "./lib/seats";
import { displayName } from "./lib/people";
import { mySecret, readSecret, writeSecret } from "./lib/secrets";
import { draftsOf, myDraft, readDraft, writeDraft } from "./lib/drafts";
import { armTurn, passTurn, startPushes, type TurnTimer } from "./lib/turns";
import { isWord } from "./scrabble/dictionary";
import {
  bagLetters,
  evaluate,
  nextSeat,
  rackValue,
  rulesOf,
  shuffle,
  standings,
  type Move,
  type Placement,
  type ScrabbleState,
  type Tile,
} from "./scrabble/engine";

// Scrabble on the shared match framework. Everything public (the board, scores, how many tiles each seat
// holds, the bag count, the move log) is in matches.state; racks and the bag are in `secrets`, so nobody
// can read another player's tiles from the network. Plans for your next turn are in `drafts`.

export type { ScrabbleState } from "./scrabble/engine";

type Bag = { bag: string[]; nextId: number };
type Hand = { rack: Tile[] };
type Draft = { placed: Placement[]; order: number[] };

const isLive = (match: Doc<"matches">) => MODES[match.mode as ModeKey]?.kind === "realtime";
const settings = (match: Doc<"matches">) => settingsOf(match.mode, match.settings);
const readBag = (ctx: QueryCtx, matchId: Id<"matches">) => readSecret<Bag>(ctx, matchId, undefined, { bag: [], nextId: 0 });
const readHand = (ctx: QueryCtx, matchId: Id<"matches">, userId: Id<"users">) => readSecret<Hand>(ctx, matchId, userId, { rack: [] });
// Live games run a clock on every turn; async ones get the 8-hour reminder.
const timerFor = (state: ScrabbleState): TurnTimer | null =>
  state.deadline !== null ? { at: state.deadline, fn: internal.scrabble.turnTimeout } : null;

// Takes up to `n` tiles off the top of the bag, giving each a fresh id.
function draw(bag: Bag, n: number): Tile[] {
  const letters = bag.bag.splice(0, Math.max(0, n));
  return letters.map((letter) => ({ id: bag.nextId++, letter }));
}

// --- Start, resign, timeout ---

export const scrabbleHooks: GameHooks = {
  seats: (_mode, n) => SEAT_COLORS.slice(0, n),
  start: async (ctx, match) => {
    const s = settings(match);
    const rules = rulesOf(s);
    const bag: Bag = { bag: shuffle(bagLetters(s.bag)), nextId: 0 };
    const racks = match.players.map(() => draw(bag, rules.rack));
    for (const [i, p] of match.players.entries()) await writeSecret<Hand>(ctx, match._id, p.userId, { rack: racks[i] });
    await writeSecret(ctx, match._id, undefined, bag);
    const now = Date.now();
    const state: ScrabbleState = {
      kind: "scrabble",
      size: rules.size,
      tiles: [],
      scores: match.players.map(() => 0),
      racks: racks.map((r) => r.length),
      bag: bag.bag.length,
      turn: 0,
      round: 1,
      scoreless: 0,
      out: [],
      moves: [],
      deadline: isLive(match) ? now + s.turnTime * 1000 : null,
    };
    const first = match.players[0].userId;
    await ctx.db.patch(match._id, { state, turn: first, lastActivityAt: now });
    const name = await displayName(ctx, first);
    await startPushes(ctx, match, (p) =>
      p.userId === first
        ? { title: "You go first", body: "Put down a word through the centre star." }
        : { title: `${MODES[match.mode as ModeKey].name} Scrabble is on`, body: `${name} goes first. Plan your word while you wait.` },
    );
    await armTurn(ctx, match, timerFor(state));
  },
  resign: async (ctx, match, userId) => {
    const state = match.state as ScrabbleState;
    const seat = seatOf(match, userId);
    if (seat < 0 || state.out.includes(seat)) return;
    // Their tiles go back in the bag for everyone else.
    const bag = await readBag(ctx, match._id);
    const hand = await readHand(ctx, match._id, userId);
    bag.bag = shuffle([...bag.bag, ...hand.rack.map((t) => t.letter)]);
    await writeSecret(ctx, match._id, undefined, bag);
    await writeSecret<Hand>(ctx, match._id, userId, { rack: [] });
    const racks = state.racks.map((n, i) => (i === seat ? 0 : n));
    const next: ScrabbleState = { ...state, out: [...state.out, seat], racks, bag: bag.bag.length };
    const record: Move = { seat, kind: "resign", score: 0, at: Date.now() };
    if (state.scores.length - next.out.length < 2) return await endGame(ctx, match, { ...next, moves: [...state.moves, record] }, "last_player");
    if (state.turn === seat) return await advance(ctx, match, next, record, false);
    await ctx.db.patch(match._id, { state: { ...next, moves: [...state.moves, record] }, lastActivityAt: Date.now() });
  },
  timeout: async (ctx, match, userId) => {
    const state = match.state as ScrabbleState;
    const seat = seatOf(match, userId);
    if (state.turn !== seat) return;
    await advance(ctx, match, state, { seat, kind: "timeout", score: 0, at: Date.now() }, false);
  },
  timeoutWarning: "or we skip your turn",
};

// Live games: the clock ran out on someone's turn. Like reminders, a stale one (the turn already moved on)
// does nothing.
export const turnTimeout = internalMutation({
  args: { id: v.id("matches"), moveCount: v.number() },
  handler: async (ctx, { id, moveCount }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount) return;
    const state = match.state as ScrabbleState;
    await advance(ctx, match, state, { seat: state.turn, kind: "timeout", score: 0, at: Date.now() }, false);
  },
});

// Records a move, then either ends the game or passes the turn on and tells the next player.
async function advance(ctx: MutationCtx, match: Doc<"matches">, state: ScrabbleState, record: Move, scored: boolean) {
  const s = settings(match);
  const active = state.scores.length - state.out.length;
  const scoreless = scored ? 0 : state.scoreless + 1;
  const moves = [...state.moves, record];
  const next = nextSeat(state, record.seat);
  // Passing the first seat still in starts a new round.
  const round = next <= record.seat ? state.round + 1 : state.round;
  const base = { ...state, moves, scoreless };
  if (scoreless >= active * 2) return await endGame(ctx, match, base, "passes");
  if (s.rounds > 0 && round > s.rounds) return await endGame(ctx, match, base, "rounds");

  const now = Date.now();
  const updated: ScrabbleState = { ...base, turn: next, round, deadline: isLive(match) ? now + s.turnTime * 1000 : null };
  const mover = match.players[record.seat].userId;
  const who = await displayName(ctx, mover);
  const title =
    record.kind === "play" ? `${who} played ${record.words![0].word} for ${record.score}`
    : record.kind === "swap" ? `${who} swapped ${record.count} tile${record.count === 1 ? "" : "s"}`
    : record.kind === "resign" ? `${who} resigned`
    : record.kind === "timeout" ? `${who} ran out of time`
    : `${who} passed`;
  await passTurn(ctx, match, { state: updated, turn: match.players[next].userId, by: mover, push: { title, body: "Your move." }, timer: timerFor(updated) });
}

// Leftover tiles count against whoever holds them. If someone went out, they also get everyone else's.
async function endGame(ctx: MutationCtx, match: Doc<"matches">, state: ScrabbleState, reason: string, wentOut?: number) {
  const left = await Promise.all(match.players.map(async (p, i) => (state.out.includes(i) ? 0 : rackValue((await readHand(ctx, match._id, p.userId)).rack))));
  const adjust = left.map((v) => -v);
  if (wentOut !== undefined) adjust[wentOut] = left.reduce((a, b) => a + b, 0);
  const final: ScrabbleState = { ...state, scores: state.scores.map((sc, i) => sc + adjust[i]), adjust, turn: -1, deadline: null };
  await ctx.db.patch(match._id, { state: final });
  await finishBySeats(ctx, { ...match, state: final }, standings(final), reason);
}

// --- Turns ---

async function myTurn(ctx: MutationCtx, id: Id<"matches">, as?: Id<"users">) {
  const s = await onTurn(ctx, id, { game: "scrabble", as });
  return { ...s, state: s.match.state as ScrabbleState };
}

// After a play or swap: the plan's tiles are gone, but the rack keeps its order.
async function clearPlan(ctx: MutationCtx, matchId: Id<"matches">, userId: Id<"users">, keep: Tile[]) {
  const draft = await readDraft<Draft>(ctx, matchId, userId);
  if (!draft) return;
  const order = (draft.order ?? []).filter((id) => keep.some((t) => t.id === id));
  await writeDraft<Draft>(ctx, matchId, userId, { placed: [], order }, 0);
}

const placementArg = v.array(v.object({ id: v.number(), x: v.number(), y: v.number(), letter: v.optional(v.string()) }));

export const play = mutation({
  args: { id: v.id("matches"), tiles: placementArg },
  handler: async (ctx, { id, tiles }) => await playTiles(ctx, id, tiles),
});

// Validates, scores and plays a word for the signed-in player (or `as`, for test helpers).
export async function playTiles(ctx: MutationCtx, id: Id<"matches">, tiles: Placement[], as?: Id<"users">) {
  const { userId, match, seat, state } = await myTurn(ctx, id, as);
  const hand = await readHand(ctx, id, userId);
  const rules = rulesOf(settings(match));
  const result = evaluate(state.tiles, tiles, hand.rack, rules);
  if (!result.ok) throw new Error(result.error);
  const bad = result.words.filter((w) => !isWord(w.word)).map((w) => w.word);
  if (bad.length) throw new Error(bad.length === 1 ? `${bad[0]} isn't in the dictionary.` : `Not in the dictionary: ${bad.join(", ")}.`);

  const turnNo = state.moves.length;
  const placed = tiles.map((t) => {
    const tile = hand.rack.find((r) => r.id === t.id)!;
    const blank = tile.letter === "?";
    return { x: t.x, y: t.y, letter: blank ? t.letter!.toUpperCase() : tile.letter, ...(blank ? { blank: true } : {}), seat, turn: turnNo };
  });
  const bag = await readBag(ctx, id);
  const kept = hand.rack.filter((t) => !tiles.some((p) => p.id === t.id));
  const rack = [...kept, ...draw(bag, tiles.length)];
  await writeSecret<Hand>(ctx, id, userId, { rack });
  await writeSecret(ctx, id, undefined, bag);
  await clearPlan(ctx, id, userId, rack);

  const next: ScrabbleState = {
    ...state,
    tiles: [...state.tiles, ...placed],
    scores: state.scores.map((s, i) => (i === seat ? s + result.score : s)),
    racks: state.racks.map((n, i) => (i === seat ? rack.length : n)),
    bag: bag.bag.length,
  };
  const record: Move = { seat, kind: "play", score: result.score, words: result.words.map(({ word, score }) => ({ word, score })), bingo: result.bingo || undefined, count: tiles.length, at: Date.now() };
  if (rack.length === 0 && bag.bag.length === 0) await endGame(ctx, match, { ...next, moves: [...state.moves, record], scoreless: 0 }, "went_out", seat);
  else await advance(ctx, match, next, record, true);
  return result.score;
}

export const swap = mutation({
  args: { id: v.id("matches"), tileIds: v.array(v.number()) },
  handler: async (ctx, { id, tileIds }) => {
    const { userId, match, seat, state } = await myTurn(ctx, id);
    const hand = await readHand(ctx, id, userId);
    const ids = [...new Set(tileIds)].filter((t) => hand.rack.some((r) => r.id === t));
    if (ids.length === 0) throw new Error("Pick the tiles to swap.");
    const bag = await readBag(ctx, id);
    if (bag.bag.length < ids.length) throw new Error(bag.bag.length === 0 ? "The bag is empty." : `Only ${bag.bag.length} left in the bag.`);
    const out = hand.rack.filter((t) => ids.includes(t.id));
    const fresh = draw(bag, ids.length);
    bag.bag = shuffle([...bag.bag, ...out.map((t) => t.letter)]);
    const rack = [...hand.rack.filter((t) => !ids.includes(t.id)), ...fresh];
    await writeSecret<Hand>(ctx, id, userId, { rack });
    await writeSecret(ctx, id, undefined, bag);
    await clearPlan(ctx, id, userId, rack);
    await advance(ctx, match, { ...state, bag: bag.bag.length }, { seat, kind: "swap", score: 0, count: ids.length, at: Date.now() }, false);
  },
});

export const pass = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const { match, seat, state } = await myTurn(ctx, id);
    await advance(ctx, match, state, { seat, kind: "pass", score: 0, at: Date.now() }, false);
  },
});

// --- What each player sees ---

export const rack = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => (await mySecret<Hand>(ctx, id))?.rack ?? null,
});

// Which of these words the dictionary doesn't know, for the live preview while you place tiles.
export const check = query({
  args: { words: v.array(v.string()) },
  handler: async (ctx, { words }) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    return words.slice(0, 30).filter((w) => !isWord(w));
  },
});

// --- Plans ---

// Saved as you go: tiles you've laid out on the board, and the order of your rack. Anyone's turn, not just
// yours. If someone else plays over a planned square, that tile just goes back to your rack on screen.
export const saveDraft = mutation({
  args: {
    id: v.id("matches"),
    placed: v.array(v.object({ id: v.number(), x: v.number(), y: v.number(), letter: v.optional(v.string()) })),
    order: v.array(v.number()),
  },
  handler: async (ctx, { id, placed, order }) => {
    const userId = await requireUser(ctx);
    const match = await loadMatch(ctx, id);
    if (!match.mode.startsWith("scrabble:")) throw new Error("Wrong kind of game.");
    if (match.status !== "active" || seatOf(match, userId) < 0) return;
    const data: Draft = { placed: placed.slice(0, 21), order: order.slice(0, 21) };
    await writeDraft(ctx, id, userId, data, data.placed.length);
  },
});

export const draft = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => await myDraft<Draft>(ctx, id),
});

// Who else is planning right now, and the squares they're trying (never the letters), so their phones can
// show face-down tiles like Letter League does: a little window into who's stuck and who's confident.
export const planning = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    if (!(await ctx.db.get(id))?.mode.startsWith("scrabble:")) return [];
    return (await draftsOf(ctx, id))
      .filter((r) => r.userId !== userId && r.count > 0)
      .map((r) => ({ userId: r.userId, count: r.count, at: r.at, cells: (r.data as Draft).placed.map((p) => [p.x, p.y] as [number, number]) }));
  },
});
