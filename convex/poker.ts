import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { finish, loadMatch, scheduleReminder } from "./matches";
import { MODES, matchPath, settingsOf, type ModeKey } from "./modes";
import { displayName, notify } from "./notify";
import type { GameHooks } from "./games";
import { deckOf, shuffle, type Card, type Variant } from "./poker/cards";
import {
  VARIANTS,
  act,
  alive,
  autoAction,
  blindsFor,
  deal,
  leave,
  newGame,
  potOf,
  raiseBounds,
  standings,
  streetOf,
  toCall,
  type Action,
  type HandResult,
  type PokerState,
  type Table,
} from "./poker/engine";
import { actionText, handInSentence, resultText } from "./poker/text";

// Poker on the shared match framework, async: every move pushes whoever's next. Stacks, bets, the board and
// the last hand's showdown are in matches.state; the deck and everyone's cards are in `secrets`, so nobody can
// read another player's hand from the network. A move you've lined up for when it's your turn ("check or
// fold", "call 40") is a draft, and the game plays it for you the moment the action reaches you.

export type { PokerState } from "./poker/engine";

export const POKER_SEATS = ["red", "blue", "yellow", "green", "purple", "orange", "teal", "pink"] as const;
const VARIANT: Record<string, Variant> = { "poker:holdem": "holdem", "poker:omaha": "omaha", "poker:short": "short", "poker:draw": "draw" };
// At most this many automatic moves and hands in one go, so nothing can spin forever.
const MAX_STEPS = 200;
// Run out of time on this many moves in a row and you're taken off the table, so one absent player can't
// hold up everyone else's game for days.
export const IDLE_OUT = 3;

type Shoe = { deck: Card[]; muck: Card[] };
type Hand = { cards: Card[]; hand: number };
// A move lined up for later. It belongs to one street of one hand, and is used up or dropped when the
// action reaches you.
export type Pre = { kind: "checkfold" | "check" | "call"; amount: number; hand: number; street: number };

const tag = (match: Doc<"matches">) => `match:${match._id}`;
const seatOf = (match: Doc<"matches">, userId: Id<"users">) => match.players.findIndex((p) => p.userId === userId);

async function secretRow(ctx: QueryCtx, matchId: Id<"matches">, userId?: Id<"users">) {
  return await ctx.db
    .query("secrets")
    .withIndex("by_match_user", (q) => q.eq("matchId", matchId).eq("userId", userId))
    .unique();
}
async function writeSecret(ctx: MutationCtx, matchId: Id<"matches">, userId: Id<"users"> | undefined, data: Shoe | Hand) {
  const row = await secretRow(ctx, matchId, userId);
  if (row) await ctx.db.patch(row._id, { data });
  else await ctx.db.insert("secrets", { matchId, userId, data });
}
async function draftRow(ctx: QueryCtx, matchId: Id<"matches">, userId: Id<"users">) {
  return await ctx.db
    .query("drafts")
    .withIndex("by_match_user", (q) => q.eq("matchId", matchId).eq("userId", userId))
    .unique();
}

async function load(ctx: QueryCtx, match: Doc<"matches">): Promise<Table> {
  const shoe = ((await secretRow(ctx, match._id))?.data ?? { deck: [], muck: [] }) as Shoe;
  const holes = await Promise.all(match.players.map(async (p) => ((await secretRow(ctx, match._id, p.userId))?.data as Hand | undefined)?.cards ?? []));
  return { state: match.state as PokerState, hidden: { deck: shoe.deck, muck: shoe.muck, holes } };
}

async function save(ctx: MutationCtx, match: Doc<"matches">, before: Table, after: Table) {
  await writeSecret(ctx, match._id, undefined, { deck: after.hidden.deck, muck: after.hidden.muck });
  for (const [i, p] of match.players.entries()) {
    const cards = after.hidden.holes[i] ?? [];
    if (JSON.stringify(cards) !== JSON.stringify(before.hidden.holes[i] ?? []) || before.state.hand !== after.state.hand) {
      await writeSecret(ctx, match._id, p.userId, { cards, hand: after.state.hand });
    }
  }
}

// The move a lined-up plan makes now, or null if it doesn't fit any more (someone bet into your check).
function planned(s: PokerState, seat: number, pre: Pre): Action | null {
  if (pre.hand !== s.hand || pre.street !== s.street || streetOf(s).kind !== "bet") return null;
  const owe = toCall(s, seat);
  if (pre.kind === "checkfold") return owe === 0 ? { kind: "check" } : { kind: "fold" };
  if (pre.kind === "check") return owe === 0 ? { kind: "check" } : null;
  if (owe === 0) return { kind: "check" };
  return owe <= pre.amount ? { kind: "call" } : null;
}

// --- Start, resign, timeout ---

export const pokerHooks: GameHooks = {
  seats: (_mode, n) => POKER_SEATS.slice(0, n),
  start: async (ctx, match) => {
    const s = settingsOf(match.mode, match.settings);
    const state = newGame(VARIANT[match.mode], s.betting === 1 ? "pl" : "nl", match.players.length, s.stack);
    const empty: Table = { state, hidden: { deck: [], muck: [], holes: [] } };
    await proceed(ctx, { ...match, state }, empty, empty, null);
  },
  resign: async (ctx, match, userId) => {
    const seat = seatOf(match, userId);
    if (seat < 0 || (match.state as PokerState).out.some((o) => o.seat === seat)) return;
    await apply(ctx, match, (t) => leave(t, seat), userId, "resign");
  },
  timeout: async (ctx, match, userId) => {
    const seat = seatOf(match, userId);
    const state = match.state as PokerState;
    if (seat < 0 || state.turn !== seat) return;
    let gone = false;
    await apply(
      ctx,
      match,
      (t) => {
        const next = act(t, seat, autoAction(t.state, seat), Math.random, true);
        gone = (next.state.idle?.[seat] ?? 0) >= IDLE_OUT;
        return gone ? leave(next, seat) : next;
      },
      null,
      "timeout",
    );
    if (gone) await notify(ctx, userId, { title: "You've left the table", body: `Your time ran out on ${IDLE_OUT} moves in a row.`, url: matchPath(match), tag: tag(match) });
  },
  timeoutWarning: "or we check or fold for you",
};

// `why` names how the game ends if this move leaves one player: a resignation or a timeout.
async function apply(ctx: MutationCtx, match: Doc<"matches">, step: (t: Table) => Table, by: Id<"users"> | null, why?: string) {
  const before = await load(ctx, match);
  await proceed(ctx, match, before, step(before), by, why);
}

// After a move: plays any moves lined up by whoever's next, deals the next hand when one ends, ends the game
// when it's over, then saves and tells whoever has to act. `by` made the move and doesn't need a push.
async function proceed(ctx: MutationCtx, match: Doc<"matches">, before: Table, after: Table, by: Id<"users"> | null, why?: string) {
  const s = settingsOf(match.mode, match.settings);
  const variant = VARIANT[match.mode];
  let t = after;
  const results: HandResult[] = [];
  let ended: string | null = null;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (t.state.turn === -1) {
      if (t.state.last && t.state.last.hand === t.state.hand && !results.includes(t.state.last)) results.push(t.state.last);
      const left = alive(t.state);
      // Someone leaving can end it: a resignation reads better than "last one standing" heads-up.
      if (left.length < 2) ended = why && t.state.out.some((o) => o.reason === "resign" && o.hand === t.state.hand) && match.players.length === 2 ? why : "last_player";
      else if (s.hands > 0 && t.state.hand >= s.hands) ended = "hands";
      if (ended) break;
      t = deal(t.state, blindsFor(s.stack, t.state.hand + 1, s.blinds), shuffle(deckOf(VARIANTS[variant].short)));
      continue;
    }
    const seat = t.state.turn;
    const row = await draftRow(ctx, match._id, match.players[seat].userId);
    if (!row) break;
    await ctx.db.delete(row._id);
    const move = planned(t.state, seat, row.data as Pre);
    if (!move) break;
    t = act(t, seat, move);
  }
  await save(ctx, match, before, t);
  const now = Date.now();
  const moveCount = match.moveCount + 1;
  if (ended || t.state.turn === -1) {
    await ctx.db.patch(match._id, { state: t.state, moveCount, lastActivityAt: now });
    const places = standings(t.state).map((g) => g.map((seat) => match.players[seat].userId));
    const draw = places[0].length === match.players.length;
    await finish(ctx, { ...match, state: t.state, moveCount }, { winners: draw ? [] : places[0], draw, reason: ended ?? "last_player", standings: places });
    return;
  }
  const turn = match.players[t.state.turn].userId;
  await ctx.db.patch(match._id, { state: t.state, turn, moveCount, lastActivityAt: now });
  await tell(ctx, match, t.state, results, by, before.state.hand === 0);
  await scheduleReminder(ctx, match._id, moveCount);
}

// Pushes: whoever has to act now hears what just happened (notify skips anyone already looking at the game), winners of a showdown hear they won, and anyone
// knocked out hears it. One push each, the most useful.
async function tell(ctx: MutationCtx, match: Doc<"matches">, s: PokerState, results: HandResult[], by: Id<"users"> | null, first: boolean) {
  if (first && match.rematchOf) return;
  const names = await Promise.all(match.players.map((p) => displayName(ctx, p.userId)));
  const pushes = new Map<Id<"users">, { title: string; body: string }>();
  const game = MODES[match.mode as ModeKey].title;
  if (first) {
    for (const p of match.players) pushes.set(p.userId, { title: `${game} is on`, body: `${names[s.turn]} is first to act.` });
  }
  for (const r of results) {
    for (const [seat, p] of match.players.entries()) {
      const exit = s.out.find((o) => o.seat === seat && o.hand === r.hand && o.reason === "bust");
      if (exit) pushes.set(p.userId, { title: "You're out", body: `Knocked out in hand ${r.hand}. Stick around to see who wins.` });
      else if (r.showdown && r.won[seat] > 0 && r.net[seat] > 0) {
        const name = r.names[seat];
        pushes.set(p.userId, { title: `You won ${r.won[seat]}`, body: name ? `With ${handInSentence(name)} in hand ${r.hand}.` : `Hand ${r.hand}.` });
      }
    }
  }
  const seat = s.turn;
  const up = match.players[seat].userId;
  {
    const owe = toCall(s, seat);
    const street = streetOf(s);
    const pot = potOf(s) + s.bets.reduce((a, b) => a + b, 0);
    const ask =
      street.kind === "draw" ? "Pick the cards to swap."
      : owe > 0 ? `${owe} to call, ${pot} in the pot.`
      : raiseBounds(s, seat) ? `Check or bet. ${pot} in the pot.`
      : "Your move.";
    const latest = s.log.filter((e) => e.kind !== "blind").at(-1);
    const last = results.at(-1);
    const nameOf = (i: number) => (i === seat ? "You" : names[i]);
    let push: { title: string; body: string };
    if (first) push = { title: `${game} is on`, body: `You're first to act. ${ask}` };
    else if (latest) push = { title: actionText(latest, names[latest.seat]), body: ask };
    else if (last) push = { title: `Hand ${s.hand}: your move`, body: `${resultText(last, nameOf)}. ${ask}` };
    else push = { title: `Hand ${s.hand}: your move`, body: ask };
    pushes.set(up, push);
  }
  for (const [userId, push] of pushes) {
    // Whoever moved saw what happened, unless the action has come back round to them.
    if (userId === by && userId !== up) continue;
    await notify(ctx, userId, { ...push, url: matchPath(match), tag: tag(match) });
  }
}

// --- Moves ---

async function mine(ctx: MutationCtx | QueryCtx, id: Id<"matches">) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  const match = await loadMatch(ctx, id);
  if (!match.mode.startsWith("poker:")) throw new Error("Wrong kind of game.");
  const seat = seatOf(match, userId);
  if (seat < 0) throw new Error("You're not playing in this game.");
  return { userId, match, seat };
}

export const move = mutation({
  args: {
    id: v.id("matches"),
    // Hand and street the player saw, so a stale tap (the hand moved on under their thumb) is refused.
    hand: v.number(),
    street: v.number(),
    kind: v.union(v.literal("fold"), v.literal("check"), v.literal("call"), v.literal("raise"), v.literal("draw")),
    to: v.optional(v.number()),
    discard: v.optional(v.array(v.number())),
  },
  handler: async (ctx, { id, hand, street, kind, to, discard }) => {
    const { userId, match, seat } = await mine(ctx, id);
    if (match.status !== "active") throw new Error("This game is over.");
    const state = match.state as PokerState;
    if (state.turn !== seat) throw new Error("It's not your turn.");
    if (state.hand !== hand || state.street !== street) throw new Error("The hand moved on. Have another look.");
    const action: Action = kind === "raise" ? { kind, to: to ?? 0 } : kind === "draw" ? { kind, discard: discard ?? [] } : { kind };
    await apply(ctx, match, (t) => act(t, seat, action), userId);
  },
});

// Lines up a move for when the action reaches you, or clears it (`kind` left out). If it's already your turn,
// it plays now.
export const plan = mutation({
  args: {
    id: v.id("matches"),
    // The hand and street the player saw. A tap that lands after the hand moved on is dropped, so it can never
    // fold a hand you haven't looked at.
    hand: v.number(),
    street: v.number(),
    kind: v.optional(v.union(v.literal("checkfold"), v.literal("check"), v.literal("call"))),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { id, hand, street, kind, amount }) => {
    const { userId, match, seat } = await mine(ctx, id);
    const row = await draftRow(ctx, id, userId);
    if (row) await ctx.db.delete(row._id);
    if (!kind || match.status !== "active") return;
    const state = match.state as PokerState;
    if (state.hand !== hand || state.street !== street) return;
    const pre: Pre = { kind, amount: amount ?? 0, hand: state.hand, street: state.street };
    if (state.turn === seat) {
      const now = planned(state, seat, pre);
      if (now) await apply(ctx, match, (t) => act(t, seat, now), userId);
      return;
    }
    await ctx.db.insert("drafts", { matchId: id, userId, data: pre, count: 0, at: Date.now() });
  },
});

// --- What each player sees ---

// My cards in the current hand. `hand` says which hand they're from, so a phone never shows last hand's
// cards against this hand's board.
export const cards = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await secretRow(ctx, id, userId);
    return (row?.data as Hand | undefined) ?? null;
  },
});

export const myPlan = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return ((await draftRow(ctx, id, userId))?.data as Pre | undefined) ?? null;
  },
});
