import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { finishBySeats } from "./matches";
import { MODES, settingsOf, type ModeKey } from "./modes";
import { notifyMatch } from "./notify";
import type { GameHooks } from "./games";
import { SEAT_COLORS, seatOf, seated } from "./lib/seats";
import { displayName } from "./lib/people";
import { mySecret, readSecret, writeSecret } from "./lib/secrets";
import { passTurn, startPushes } from "./lib/turns";
import { isColor, type Card } from "./uno/cards";
import { act, alive, autoTurn, inHand, leave, newGame, standings, type Action, type Table, type UnoState } from "./uno/engine";
import { unoRules } from "./uno/modes";
import { askText, entryText } from "./uno/text";

export type { UnoState } from "./uno/engine";

export const IDLE_OUT = 3;
const REPLAY_MOVES = 60;

type Shoe = { deck: Card[]; discard: Card[]; drawn: Card | null; bluff: boolean };
export type UnoHand = { cards: Card[]; hand: number; drawn: Card | null };

const rulesOf = (match: Doc<"matches">) => unoRules(match.mode, settingsOf(match.mode, match.settings));

export async function load(ctx: QueryCtx, match: Doc<"matches">): Promise<Table> {
  const shoe = await readSecret<Shoe>(ctx, match._id, undefined, { deck: [], discard: [], drawn: null, bluff: false });
  const hands = await Promise.all(
    match.players.map(async (p) => (await readSecret<UnoHand | null>(ctx, match._id, p.userId, null))?.cards ?? []),
  );
  return { state: match.state as UnoState, hidden: { ...shoe, hands } };
}

const handOf = (t: Table, seat: number): UnoHand => ({
  cards: t.hidden.hands[seat] ?? [],
  hand: t.state.hand,
  drawn: t.state.turn === seat && t.state.drew ? t.hidden.drawn : null,
});

async function save(ctx: MutationCtx, match: Doc<"matches">, before: Table | null, after: Table) {
  const { deck, discard, drawn, bluff } = after.hidden;
  await writeSecret<Shoe>(ctx, match._id, undefined, { deck, discard, drawn, bluff });
  for (const [i, p] of match.players.entries()) {
    const mine = handOf(after, i);
    if (before && JSON.stringify(handOf(before, i)) === JSON.stringify(mine)) continue;
    await writeSecret<UnoHand>(ctx, match._id, p.userId, mine);
  }
}

function reasonFor(match: Doc<"matches">, s: UnoState) {
  const last = s.last && s.last.hand === s.hand ? s.last : null;
  if (!last) return match.players.length === 2 ? "resign" : "last_player";
  if (s.rules.goal > 0) return "points";
  return last.cards[last.winner] > 0 ? "mercy" : "out";
}

async function record(ctx: MutationCtx, match: Doc<"matches">, before: Table | null, s: UnoState, by: Id<"users"> | null) {
  const row = (state: UnoState, from: number, seat: number) =>
    ctx.db.insert("unoLog", {
      matchId: match._id,
      seq: state.seq,
      by: seat,
      state: { ...state, log: state.log.filter((e) => e.seq > from) },
      at: Date.now(),
    });
  const logged = await ctx.db
    .query("unoLog")
    .withIndex("by_match", (q) => q.eq("matchId", match._id))
    .first();
  if (before && !logged) await row({ ...before.state, log: [] }, Infinity, -1);
  await row(s, before?.state.seq ?? -1, by ? seatOf(match, by) : -1);
}

async function commit(ctx: MutationCtx, match: Doc<"matches">, before: Table | null, after: Table, by: Id<"users"> | null, quiet: boolean) {
  await save(ctx, match, before, after);
  const s = after.state;
  await record(ctx, match, before, s, by);
  if (s.over) {
    const moveCount = match.moveCount + 1;
    await ctx.db.patch(match._id, { state: s, moveCount, lastActivityAt: Date.now() });
    await finishBySeats(ctx, { ...match, state: s, moveCount }, standings(s), reasonFor(match, s));
    return;
  }
  const { fresh } = await passTurn(ctx, match, { state: s, turn: match.players[s.turn].userId, by, newDecision: !quiet });
  await tell(ctx, match, before, after, by, fresh);
}

async function tell(ctx: MutationCtx, match: Doc<"matches">, before: Table | null, after: Table, by: Id<"users"> | null, fresh: boolean) {
  const s = after.state;
  const names = await Promise.all(match.players.map((p) => displayName(ctx, p.userId)));
  const up = s.turn;
  if (!before) {
    const title = `${MODES[match.mode as ModeKey].title} is on`;
    await startPushes(ctx, match, (p) => {
      const seat = seatOf(match, p.userId);
      return { title, body: seat === up ? `You're first. ${askText(s, seat)}` : `${names[up]} goes first.` };
    });
    return;
  }
  const b = before.state;
  const happened = s.log.filter((e) => e.seq > b.seq);
  const pushes = new Map<number, { title: string; body: string }>();
  const nameFor = (to: number) => (i: number) => (i === to ? "you" : names[i]);
  const hit = (seat: number, title: string, body: string) => {
    if (!pushes.has(seat)) pushes.set(seat, { title, body });
  };
  for (const e of happened) {
    if (e.kind === "swap" && e.target !== undefined)
      hit(e.target, `${names[e.seat]} swapped hands with you`, `You have ${s.counts[e.target]} cards now.`);
    if (e.kind === "rotate")
      for (const i of inHand(s))
        if (i !== e.seat) hit(i, `${names[e.seat]} played a 0`, `Every hand moved along. You have ${s.counts[i]} cards now.`);
    if (e.kind === "catch" && e.target !== undefined) hit(e.target, `${names[e.seat]} caught you without UNO`, `+${e.n ?? 2} cards.`);
    if (e.kind === "challenge" && e.guilty && e.target !== undefined)
      hit(e.target, `${names[e.seat]} called your bluff`, `+${e.n ?? 4} cards.`);
    if (e.kind === "take" && e.seat !== up && happened.some((x) => x.kind === "play" || x.kind === "jump")) {
      const hitter = happened.find((x) => x.kind === "play" || x.kind === "jump")!;
      hit(e.seat, `${names[hitter.seat]} hit you with +${e.n}`, "And you're skipped.");
    }
    if (e.kind === "mercy") hit(e.seat, "You're out of this hand", `${e.n} cards: the mercy rule got you.`);
  }
  if (b.hand !== s.hand && s.last) {
    const r = s.last;
    for (const i of alive(s)) {
      if (i === r.winner) hit(i, `You won hand ${r.hand}`, `+${r.points}. ${s.scores[i]} of ${s.rules.goal} now.`);
      else hit(i, `${names[r.winner]} won hand ${r.hand}`, `+${r.points} for them. Hand ${s.hand} is dealt.`);
    }
  }
  if (s.forgot !== null && b.forgot !== s.forgot)
    for (const i of inHand(s))
      if (i !== s.forgot) hit(i, `${names[s.forgot]} forgot to call UNO`, "Catch them before the next move and they draw 2.");
  if (fresh) {
    const last = [...happened].reverse().find((e) => e.kind !== "uno" && e.kind !== "catch" && e.kind !== "mercy");
    const had = pushes.get(up);
    const title = had?.title ?? (last ? cap(entryText(last, nameFor(up))) : "Your move");
    pushes.set(up, { title, body: askText(s, up) });
  }
  for (const [seat, push] of pushes) {
    const userId = match.players[seat].userId;
    if (userId === by) continue;
    await notifyMatch(ctx, userId, match, push);
  }
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

export const unoHooks: GameHooks = {
  seats: (_mode, n) => SEAT_COLORS.slice(0, n),
  start: async (ctx, match) => {
    const t = newGame(match.players.length, rulesOf(match), Math.random);
    await commit(ctx, { ...match, state: t.state }, null, t, null, false);
  },
  resign: async (ctx, match, userId) => {
    const seat = seatOf(match, userId);
    const s = match.state as UnoState;
    if (seat < 0 || s.out.some((o) => o.seat === seat && o.reason !== "mercy")) return;
    const before = await load(ctx, match);
    await commit(ctx, match, before, leave(before, seat, "resign", Math.random), userId, s.turn !== seat);
  },
  timeout: async (ctx, match, userId) => {
    const seat = seatOf(match, userId);
    if (seat < 0 || (match.state as UnoState).turn !== seat) return;
    const before = await load(ctx, match);
    let after = autoTurn(before, seat, Math.random);
    const gone = (after.state.idle[seat] ?? 0) >= IDLE_OUT && !after.state.over;
    if (gone) after = leave(after, seat, "idle", Math.random);
    await commit(ctx, match, before, after, null, false);
    if (gone)
      await notifyMatch(ctx, userId, match, { title: "You're out of the game", body: `Your time ran out ${IDLE_OUT} turns in a row.` });
  },
  timeoutWarning: "or we draw for you",
};

const colorArg = v.optional(v.union(v.literal("r"), v.literal("y"), v.literal("g"), v.literal("b")));

export async function moveAs(ctx: MutationCtx, id: Id<"matches">, seq: number, action: Action, as?: Id<"users">) {
  const { userId, match, seat } = await seated(ctx, id, { game: "uno", as });
  const s = match.state as UnoState;
  const offTurn = action.kind === "catch" || action.kind === "uno";
  if (seq !== s.seq) throw new Error("That changed while you were looking. Have another look.");
  const before = await load(ctx, match);
  const after = act(before, seat, action, Math.random);
  await commit(ctx, match, before, after, userId, offTurn);
  return { seq: after.state.seq };
}

export const move = mutation({
  args: {
    id: v.id("matches"),
    seq: v.number(),
    kind: v.union(
      v.literal("play"),
      v.literal("draw"),
      v.literal("pass"),
      v.literal("take"),
      v.literal("challenge"),
      v.literal("roulette"),
      v.literal("catch"),
      v.literal("uno"),
    ),
    card: v.optional(v.string()),
    color: colorArg,
    target: v.optional(v.number()),
    uno: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, seq, kind, card, color, target, uno }) => {
    let action: Action;
    if (kind === "play") action = { kind, card: card ?? "", color, target, uno };
    else if (kind === "roulette") {
      if (!color || !isColor(color)) throw new Error("Pick a color.");
      action = { kind, color };
    } else if (kind === "catch") action = { kind, seat: target ?? -1 };
    else action = { kind };
    return await moveAs(ctx, id, seq, action);
  },
});

export const hand = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => await mySecret<UnoHand>(ctx, id, "uno"),
});

export const log = query({
  args: { id: v.id("matches"), from: v.optional(v.number()) },
  handler: async (ctx, { id, from }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const rows = () => ctx.db.query("unoLog");
    let start: Doc<"unoLog"> | null = null;
    if (from === undefined) {
      const match = await ctx.db.get(id);
      const seat = match && userId ? seatOf(match, userId) : -1;
      for await (const r of rows()
        .withIndex("by_match", (q) => q.eq("matchId", id))
        .order("desc")) {
        start = r;
        if (seat >= 0 && r.by === seat) break;
      }
    } else
      start =
        (await rows()
          .withIndex("by_match", (q) => q.eq("matchId", id).lte("seq", from))
          .order("desc")
          .first()) ??
        (await rows()
          .withIndex("by_match", (q) => q.eq("matchId", id))
          .first());
    if (!start) return null;
    const after = await rows()
      .withIndex("by_match", (q) => q.eq("matchId", id).gt("seq", start.seq))
      .collect();
    const kept = after.slice(-REPLAY_MOVES);
    const first = after.length > kept.length ? after[after.length - kept.length - 1] : start;
    return {
      start: { seq: first.seq, state: first.state as UnoState },
      moves: kept.map((r) => ({ seq: r.seq, by: r.by, state: r.state as UnoState })),
    };
  },
});
