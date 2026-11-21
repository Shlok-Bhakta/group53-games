import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { finishBySeats } from "./matches";
import { settingsOf } from "./modes";
import { notifyMatch } from "./notify";
import type { GameHooks } from "./games";
import { SEAT_COLORS, seatOf, seated } from "./lib/seats";
import { displayName } from "./lib/people";
import { readSecret, writeSecret } from "./lib/secrets";
import { clearDraft, draftsOf, writeDraft } from "./lib/drafts";
import { startPushes } from "./lib/turns";
import { ANSWERS } from "./wordle/answers";
import {
  ITEMS,
  alive,
  cartOf,
  choose,
  cluesOf,
  handOf,
  hintsOf,
  play as playCard,
  fogged,
  finishRound,
  guess as step,
  isItem,
  jammed,
  leave,
  leftForSeat,
  reconcile,
  newGame,
  pickWords,
  roundDone,
  standings,
  waitingOn,
  type Bumped,
  type Buy,
  type Cart,
  type Mine,
  type Rules,
  type WordleState,
} from "./wordle/engine";
import { roundPush } from "./wordle/text";

export const REMIND_MS = 6 * 60 * 60 * 1000;
const REMIND_LATER_MS = 12 * 60 * 60 * 1000;
const EAGER_REMINDERS = 2;
const HOUR_MS = 60 * 60 * 1000;

type Words = { words: string[] };

export function rulesOf(mode: string, raw: Doc<"matches">["settings"]): Rules {
  const s = settingsOf(mode, raw);
  return { goal: s.goal, shop: s.shop === 1 };
}

const wordHours = (match: Doc<"matches">) => settingsOf(match.mode, match.settings).wordTime ?? 0;

const blankMine = (round: number): Mine => ({ round, guesses: [], marks: [], pick: null });

async function mineOf(ctx: QueryCtx, match: Doc<"matches">, userId: Id<"users">, s: WordleState) {
  const m = await readSecret<Mine | null>(ctx, match._id, userId, null);
  return m && m.round === s.round ? m : blankMine(s.round);
}

const idsOf = (match: Doc<"matches">, s: WordleState) => waitingOn(s).map((i) => match.players[i].userId);

function reasonFor(match: Doc<"matches">, s: WordleState) {
  if (alive(s).length < 2) return match.players.length === 2 ? "resign" : "last_player";
  return s.players.some((p) => !p.out && p.solved >= s.rules.goal) ? "words" : "rounds";
}

async function save(ctx: MutationCtx, match: Doc<"matches">, s: WordleState) {
  const waiting = idsOf(match, s);
  const moveCount = match.moveCount + 1;
  const patch = { state: s, waitingOn: waiting, turn: undefined, moveCount, lastActivityAt: Date.now() };
  await ctx.db.patch(match._id, patch);
  const after = { ...match, ...patch };
  if (s.over) await finishBySeats(ctx, after, standings(s), reasonFor(match, s));
  return after;
}

async function armRound(ctx: MutationCtx, match: Doc<"matches">, s: WordleState) {
  if (s.deadline) await ctx.scheduler.runAt(s.deadline, internal.wordle.deadline, { id: match._id, round: s.round });
  await ctx.scheduler.runAfter(REMIND_MS, internal.wordle.remind, { id: match._id, round: s.round, strikes: 0 });
}

const deadlineFor = (match: Doc<"matches">) => (wordHours(match) ? Date.now() + wordHours(match) * HOUR_MS : null);

async function nudgeLast(ctx: MutationCtx, before: Doc<"matches">, after: Doc<"matches">, s: WordleState) {
  const was = before.waitingOn ?? [];
  const now = after.waitingOn ?? [];
  if (now.length !== 1 || was.length < 2 || s.players.length < 3) return;
  const seat = seatOf(after, now[0]);
  const done = s.players[seat].done;
  await notifyMatch(ctx, now[0], after, {
    title: "Everyone's waiting on you",
    body: done ? "Pick something from the shop, or pass." : `Word ${s.round + 1} is the last one still open.`,
  });
}

const minesOf = (ctx: QueryCtx, match: Doc<"matches">, s: WordleState) =>
  Promise.all(match.players.map((p) => mineOf(ctx, match, p.userId, s)));

async function tellBumped(ctx: MutationCtx, match: Doc<"matches">, s: WordleState, bumped: Bumped[]) {
  if (s.over) return;
  for (const b of bumped) {
    if (s.players[b.seat].picked) continue;
    const names = [...new Set(b.lost)].map((k) => ITEMS[k].name);
    await notifyMatch(ctx, match.players[b.seat].userId, match, {
      title: "Shop again",
      body: `${names.join(" and ")} dropped out of your cart, so those coins are yours to spend again.`,
    });
  }
}

async function resolve(ctx: MutationCtx, match: Doc<"matches">, s: WordleState, force = false) {
  const { words } = await readSecret<Words>(ctx, match._id, undefined, { words: [] });
  const mines = await minesOf(ctx, match, s);
  const r = finishRound(s, mines, words, Math.random, force);
  if (!r.s.over) r.s.deadline = deadlineFor(match);
  for (const [i, p] of match.players.entries()) {
    await writeSecret(ctx, match._id, p.userId, r.mine[i]);
    await clearDraft(ctx, match._id, p.userId);
  }
  const after = await save(ctx, match, r.s);
  if (r.s.over) return after;
  await armRound(ctx, after, r.s);
  await tellRound(ctx, after, r.s, r.buys);
  return after;
}

async function tellRound(ctx: MutationCtx, match: Doc<"matches">, s: WordleState, buys: Buy[]) {
  const names = await Promise.all(match.players.map((p) => displayName(ctx, p.userId)));
  for (const seat of alive(s)) {
    const push = roundPush(s, seat, buys, names);
    await notifyMatch(ctx, match.players[seat].userId, match, push);
  }
}

export const wordleHooks: GameHooks = {
  seats: (_mode, n) => SEAT_COLORS.slice(0, n),
  start: async (ctx, match) => {
    const { s, mine } = newGame(match.players.length, rulesOf(match.mode, match.settings), Math.random);
    s.deadline = deadlineFor(match);
    await writeSecret<Words>(ctx, match._id, undefined, { words: pickWords(ANSWERS, s.rounds, Math.random) });
    for (const [i, p] of match.players.entries()) await writeSecret(ctx, match._id, p.userId, mine[i]);
    const after = await save(ctx, match, s);
    await armRound(ctx, after, s);
    await startPushes(ctx, after, () => ({
      title: "PvP Wordle is on",
      body: `Word 1 is up. First to ${s.rules.goal} words wins.`,
    }));
  },
  resign: async (ctx, match, userId) => {
    const seat = seatOf(match, userId);
    const s0 = match.state as WordleState;
    if (seat < 0 || s0.players[seat].out) return;
    const s = leave(s0, seat);
    const mines = await minesOf(ctx, match, s);
    const bumped = reconcile(s, mines);
    for (const b of bumped) await writeSecret(ctx, match._id, match.players[b.seat].userId, mines[b.seat]);
    if (alive(s).length < 2) await resolve(ctx, match, s, true);
    else if (roundDone(s)) await resolve(ctx, match, s);
    else await tellBumped(ctx, await save(ctx, match, s), s, bumped);
  },
  timeout: async () => {},
  timeoutWarning: "",
};

const TIME_UP = "Time's up on this word.";

export async function guessAs(ctx: MutationCtx, id: Id<"matches">, word: string, round: number, row: number, as?: Id<"users">) {
  const { userId, match, seat } = await seated(ctx, id, { game: "wordle", as });
  const s0 = match.state as WordleState;
  if (s0.round !== round || s0.players[seat].rows !== row) throw new Error("That changed while you were looking. Try again.");
  if (s0.deadline && Date.now() >= s0.deadline) throw new Error(TIME_UP);
  const { words } = await readSecret<Words>(ctx, id, undefined, { words: [] });
  const { s, mine } = step(s0, await mineOf(ctx, match, userId, s0), seat, word, words[s0.round]);
  await writeSecret(ctx, id, userId, mine);
  await clearDraft(ctx, id, userId);
  const marks = mine.marks.at(-1)!;
  if (roundDone(s)) await resolve(ctx, match, s);
  else await nudgeLast(ctx, match, await save(ctx, match, s), s);
  return { marks, done: s.players[seat].done, won: s.players[seat].won };
}

export async function pickAs(ctx: MutationCtx, id: Id<"matches">, round: number, cart: Cart, as?: Id<"users">) {
  const { match, seat } = await seated(ctx, id, { game: "wordle", as });
  const s0 = match.state as WordleState;
  if (s0.round !== round) throw new Error("That shop has closed.");
  if (s0.deadline && Date.now() >= s0.deadline) throw new Error(TIME_UP);
  const before = await minesOf(ctx, match, s0);
  const { s, mines, bumped } = choose(s0, before, seat, cart);
  for (const i of new Set([seat, ...bumped.map((b) => b.seat)])) await writeSecret(ctx, id, match.players[i].userId, mines[i]);
  if (roundDone(s)) return await resolve(ctx, match, s);
  const after = await save(ctx, match, s);
  await tellBumped(ctx, after, s, bumped);
  await nudgeLast(ctx, match, after, s);
}

export const guess = mutation({
  args: { id: v.id("matches"), word: v.string(), round: v.number(), row: v.number() },
  handler: async (ctx, { id, word, round, row }) => await guessAs(ctx, id, word, round, row),
});

export const pick = mutation({
  args: { id: v.id("matches"), round: v.number(), item: v.union(v.string(), v.null()), target: v.optional(v.number()) },
  handler: async (ctx, { id, round, item, target }) => {
    if (item !== null && !isItem(item)) throw new Error("That's not in the shop.");
    await pickAs(ctx, id, round, item === null ? [] : [{ item, target: target ?? -1 }]);
  },
});

export async function playAs(ctx: MutationCtx, id: Id<"matches">, round: number, item: string, rush: boolean, as?: Id<"users">) {
  const { userId, match, seat } = await seated(ctx, id, { game: "wordle", as });
  const s0 = match.state as WordleState;
  if (s0.round !== round) throw new Error("That word has closed.");
  if (s0.deadline && Date.now() >= s0.deadline) throw new Error(TIME_UP);
  if (!isItem(item)) throw new Error("That's not a card you can play.");
  const { words } = await readSecret<Words>(ctx, id, undefined, { words: [] });
  const { s, mine } = playCard(s0, await mineOf(ctx, match, userId, s0), seat, item, words[s0.round], rush, Math.random);
  await writeSecret(ctx, id, userId, mine);
  if (
    s0.players[seat].max !== s.players[seat].max ||
    s0.players[seat].coins !== s.players[seat].coins ||
    s0.players[seat].effects.length !== s.players[seat].effects.length
  )
    await save(ctx, match, s);
}

export const play = mutation({
  args: { id: v.id("matches"), round: v.number(), item: v.string(), rush: v.optional(v.boolean()) },
  handler: async (ctx, { id, round, item, rush }) => await playAs(ctx, id, round, item, rush ?? false),
});

export const shop = mutation({
  args: { id: v.id("matches"), round: v.number(), cart: v.array(v.object({ item: v.string(), target: v.number() })) },
  handler: async (ctx, { id, round, cart }) => {
    const items: Cart = [];
    for (const x of cart) {
      if (!isItem(x.item)) throw new Error("That's not in the shop.");
      items.push({ item: x.item, target: x.target });
    }
    await pickAs(ctx, id, round, items);
  },
});

export const typing = mutation({
  args: { id: v.id("matches"), letters: v.number() },
  handler: async (ctx, { id, letters }) => {
    const { userId, match, seat } = await seated(ctx, id, { game: "wordle" });
    const s = match.state as WordleState;
    const n = Math.max(0, Math.min(5, Math.floor(letters)));
    if (s.players[seat].done) return;
    const row = s.players[seat].rows;
    const had = await ctx.db
      .query("drafts")
      .withIndex("by_match_user", (q) => q.eq("matchId", id).eq("userId", userId))
      .unique();
    const was = had?.data as { round: number; row: number } | undefined;
    if (was?.round === s.round && was.row === row && had?.count === n) return;
    await writeDraft(ctx, id, userId, { round: s.round, row }, n);
  },
});

type Row = { letters: string; marks: string } | { fog: true };

export const board = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const match = await ctx.db.get(id);
    if (!match || !match.mode.startsWith("wordle:") || match.status === "waiting") return null;
    const s = match.state as WordleState;
    if (!s) return null;
    const seat = seatOf(match, userId);
    const me = seat >= 0 ? s.players[seat] : null;
    const mines = await minesOf(ctx, match, s);
    const mine = seat >= 0 ? mines[seat] : blankMine(s.round);
    const rows: Row[] = mine.guesses.map((g, i) => (me && !s.over && fogged(me, i) ? { fog: true } : { letters: g, marks: mine.marks[i] }));
    const seeOthers = s.over || !!me?.done;
    const others: (string[] | null)[] = await Promise.all(
      match.players.map(async (p, i) => {
        if (i === seat || !seeOthers) return null;
        return mines[i].marks;
      }),
    );
    const typingNow = (await draftsOf(ctx, id))
      .filter((d) => d.userId !== userId)
      .map((d) => ({ seat: seatOf(match, d.userId), letters: d.count, ...(d.data as { round: number; row: number }) }))
      .filter((d) => d.seat >= 0 && d.round === s.round && d.row === s.players[d.seat].rows && !s.players[d.seat].done)
      .map((d) => ({ seat: d.seat, letters: d.letters }));
    return {
      round: s.round,
      seat,
      rows,
      hint: hintsOf(mine).at(0) ?? null,
      hints: hintsOf(mine),
      clue: cluesOf(mine).at(0) ?? null,
      clues: cluesOf(mine),
      hand: handOf(mine),
      pick: mine.pick,
      cart: cartOf(mine),
      lost: mine.lost ?? [],
      left: seat >= 0 ? leftForSeat(s, mines, seat) : null,
      jammed: me ? jammed(me) : "",
      others,
      typing: typingNow,
    };
  },
});

export const deadline = internalMutation({
  args: { id: v.id("matches"), round: v.number() },
  handler: async (ctx, { id, round }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active") return;
    const s = match.state as WordleState;
    if (s.over || s.round !== round) return;
    await resolve(ctx, match, s, true);
  },
});

export const remind = internalMutation({
  args: { id: v.id("matches"), round: v.number(), strikes: v.number() },
  handler: async (ctx, { id, round, strikes }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active") return;
    const s = match.state as WordleState;
    if (s.over || s.round !== round) return;
    const left = s.deadline ? s.deadline - Date.now() : null;
    const hours = left === null ? null : Math.max(1, Math.round(left / HOUR_MS));
    for (const seat of waitingOn(s)) {
      const done = s.players[seat].done;
      await notifyMatch(ctx, match.players[seat].userId, match, {
        title: done ? "Still shopping?" : `Word ${s.round + 1} is waiting`,
        body: `${done ? "Pick something or pass so the next word can start." : "Your word is still open."}${hours ? ` ${hours}h left.` : ""}`,
      });
    }
    const wait = strikes + 1 >= EAGER_REMINDERS ? REMIND_LATER_MS : REMIND_MS;
    if (left !== null && left <= wait) return;
    await ctx.scheduler.runAfter(wait, internal.wordle.remind, { id, round, strikes: strikes + 1 });
  },
});
