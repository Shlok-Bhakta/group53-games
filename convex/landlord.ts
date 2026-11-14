import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { finishBySeats } from "./matches";
import { settingsOf } from "./modes";
import { notifyMatch } from "./notify";
import type { GameHooks } from "./games";
import { SEAT_COLORS, seatOf, seated } from "./lib/seats";
import { displayName } from "./lib/people";
import { readSecret, writeSecret } from "./lib/secrets";
import { passTurn, startPushes } from "./lib/turns";
import { act as step, actor, newGame, standings, type Action, type Decks, type Ev, type Game, type MonoState, type Rules } from "./landlord/engine";
import { money, say, sideText, squareName } from "./landlord/text";

// Landlord, the property-trading game, on the shared match framework. Async with no time limit: every move
// pushes whoever the game's now waiting on, and they're pinged again every few hours until they act. The
// public state is matches.state; the order of the card decks is the game's secret. Every move also goes in
// `landlordLog` with what it did, so a phone can play back everything since it last looked.

export type { MonoState } from "./landlord/engine";

// How often the game nudges whoever it's waiting on, at first, and once they've been nudged a few times.
export const REMIND_MS = 4 * 60 * 60 * 1000;
const REMIND_LATER_MS = 12 * 60 * 60 * 1000;
const EAGER_REMINDERS = 4;

export function rulesOf(mode: string, raw: Doc<"matches">["settings"]): Rules {
  const s = settingsOf(mode, raw);
  return {
    cash: s.cash,
    auctions: s.auctions === 1,
    pot: s.pot as Rules["pot"],
    goDouble: s.goDouble === 1,
    jailRent: s.jailRent === 1,
    firstLap: s.firstLap === 1,
    speed: s.speed === 1,
    limited: s.limited === 1,
    short: s.game === 1,
    rounds: s.rounds,
  };
}

async function load(ctx: MutationCtx, match: Doc<"matches">): Promise<Game> {
  const decks = await readSecret<Decks>(ctx, match._id, undefined, { chance: [], chest: [] });
  return { s: match.state as MonoState, decks, events: [] };
}

// Saves a move: the decks, the log, then either the result or the turn and the pushes.
async function commit(ctx: MutationCtx, match: Doc<"matches">, g: Game, by: Id<"users"> | null, first = false) {
  await writeSecret(ctx, match._id, undefined, g.decks);
  const seat = by ? seatOf(match, by) : -1;
  await ctx.db.insert("landlordLog", { matchId: match._id, seq: g.s.seq - g.events.length, by: seat, events: g.events, state: g.s, at: Date.now() });
  if (g.s.phase.k === "over") {
    const moveCount = match.moveCount + 1;
    await ctx.db.patch(match._id, { state: g.s, moveCount, lastActivityAt: Date.now() });
    const ended = { ...match, state: g.s, moveCount };
    const resigned = g.events.some((e) => e.t === "out") && by !== null && match.players.length === 2;
    await finishBySeats(ctx, ended, standings(g.s), g.s.rules.short || g.s.rules.rounds ? "richest" : resigned ? "resign" : "last_player");
    return;
  }
  const turn = match.players[actor(g.s)].userId;
  const { match: after, fresh } = await passTurn(ctx, match, { state: g.s, turn, by, timer: { at: Date.now() + REMIND_MS, fn: internal.landlord.remind } });
  if (first) {
    const name = await displayName(ctx, turn);
    await startPushes(ctx, match, (p) => ({ title: "Landlord is on", body: p.userId === turn ? "You roll first." : `${name} rolls first.` }));
    return;
  }
  await tell(ctx, after, g, by, fresh);
}

// What each player hears about a move, one push each, the most pressing: a decision that's now theirs, an
// offer, an auction, a trade answered, rent coming in, someone going bankrupt.
async function tell(ctx: MutationCtx, match: Doc<"matches">, g: Game, by: Id<"users"> | null, fresh: boolean) {
  const names = await Promise.all(match.players.map((p) => displayName(ctx, p.userId)));
  const s = g.s;
  const pushes = new Map<number, { rank: number; title: string; body: string }>();
  const put = (seat: number, rank: number, title: string, body: string) => {
    if (seat < 0 || match.players[seat].userId === by || s.players[seat].out) return;
    const had = pushes.get(seat);
    if (!had || had.rank > rank) pushes.set(seat, { rank, title, body });
  };
  for (const e of g.events) {
    const nameFor = (reader: number) => (seat: number) => (seat === reader ? "you" : names[seat]);
    if (e.t === "offer") put(e.trade.to, 1, `${names[e.trade.from]} sent you a trade`, `Their ${sideText(e.trade.give)} for your ${sideText(e.trade.get)}.`);
    if (e.t === "auction") for (const seat of e.in) put(seat, 2, `Auction: ${squareName(e.pos)}`, "Bid or drop out.");
    if (e.t === "bid") for (const seat of auctionIn(s)) if (seat !== e.seat) put(seat, 2, `${names[e.seat]} bid ${money(e.amount)}`, `On ${auctionName(s)}. Raise it or drop out.`);
    if (e.t === "traded") put(e.trade.from, 3, `${names[e.trade.to]} took your trade`, `Your ${sideText(e.trade.give)} for their ${sideText(e.trade.get)}.`);
    if (e.t === "untrade" && e.why === "reject") put(e.trade.from, 3, `${names[e.by]} turned your trade down`, `Your ${sideText(e.trade.give)} for their ${sideText(e.trade.get)}.`);
    if (e.t === "pay" && e.why === "rent" && e.to >= 0) put(e.to, 4, `${names[e.from]} paid you ${money(e.amount)}`, "Rent.");
    if (e.t === "out") for (const seat of s.players.keys()) if (seat !== e.seat) put(seat, 5, `${names[e.seat]} went bankrupt`, say(e, nameFor(seat)) ?? "");
  }
  // Whoever has to act now, if that's new: what happened since, and what's theirs to do.
  const up = actor(s);
  if (fresh) {
    const ph = s.phase;
    const nameFor = (seat: number) => (seat === up ? "you" : names[seat]);
    const lines = g.events.map((e) => say(e, nameFor)).filter((x): x is string => !!x);
    const recap = lines.slice(-2).join(" ").replace(/^./, (c) => c.toUpperCase());
    if (ph.k === "debt") put(up, 0, `You owe ${money(ph.amount)}`, "Sell, mortgage or trade to raise it, or go bankrupt.");
    else if (ph.k === "auction") put(up, 0, `Auction: ${squareName(ph.pos)}`, ph.leader >= 0 ? `${names[ph.leader]} leads at ${money(ph.high)}. Raise it or drop out.` : "Bid or drop out.");
    else put(up, 0, "Your turn", recap || "Your roll.");
  }
  for (const [seat, p] of pushes) await notifyMatch(ctx, match.players[seat].userId, match, { title: p.title, body: p.body });
}

const auctionIn = (s: MonoState) => (s.phase.k === "auction" ? s.phase.in : []);
const auctionName = (s: MonoState) => (s.phase.k === "auction" ? squareName(s.phase.pos) : "it");

// --- Start and resign ---

export const landlordHooks: GameHooks = {
  seats: (_mode, n) => SEAT_COLORS.slice(0, n),
  start: async (ctx, match) => {
    const g = newGame(match.players.length, rulesOf(match.mode, match.settings));
    await commit(ctx, { ...match, state: g.s }, g, null, true);
  },
  resign: async (ctx, match, userId) => {
    const seat = seatOf(match, userId);
    const s = match.state as MonoState;
    if (seat < 0 || s.players[seat].out) return;
    const g = step(await load(ctx, match), seat, { k: "resign" });
    await commit(ctx, match, g, userId);
  },
  // No time limit, so nothing ever runs out.
  timeout: async () => {},
  timeoutWarning: "",
};

// The nudge: whoever the game's waiting on (in an auction, everyone still bidding but the leader), again
// later if they still haven't.
export const remind = internalMutation({
  args: { id: v.id("matches"), moveCount: v.number(), strikes: v.optional(v.number()) },
  handler: async (ctx, { id, moveCount, strikes = 0 }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount) return;
    const s = match.state as MonoState;
    const ph = s.phase;
    const waiting = ph.k === "auction" ? ph.in.filter((x) => x !== ph.leader) : [actor(s)];
    const body =
      ph.k === "auction" ? `${squareName(ph.pos)} is up for auction${ph.leader >= 0 ? `, ${money(ph.high)} to beat` : ""}.`
      : ph.k === "debt" ? `You owe ${money(ph.amount)}. Raise it or go bankrupt.`
      : ph.k === "buy" ? `Buy ${squareName(ph.pos)}, or put it up for auction.`
      : "Everyone's waiting on your roll.";
    for (const seat of waiting) await notifyMatch(ctx, match.players[seat].userId, match, { title: "Still your move", body });
    await ctx.scheduler.runAfter(strikes + 1 >= EAGER_REMINDERS ? REMIND_LATER_MS : REMIND_MS, internal.landlord.remind, { id, moveCount, strikes: strikes + 1 });
  },
});

// --- Moves ---

const side = v.object({ cash: v.number(), props: v.array(v.number()), free: v.array(v.union(v.literal("chance"), v.literal("chest"))) });
export const action = v.union(
  v.object({ k: v.union(v.literal("roll"), v.literal("payJail"), v.literal("cardJail"), v.literal("buy"), v.literal("decline"), v.literal("fold"), v.literal("pay"), v.literal("bankrupt")) }),
  v.object({ k: v.literal("bid"), amount: v.number() }),
  v.object({ k: v.literal("bus"), choice: v.union(v.literal(0), v.literal(1), v.literal(2)) }),
  v.object({ k: v.union(v.literal("pick"), v.literal("build"), v.literal("sell"), v.literal("sellAll"), v.literal("mortgage"), v.literal("unmortgage")), pos: v.number() }),
  v.object({ k: v.literal("offer"), to: v.number(), give: side, get: side, lift: v.optional(v.array(v.number())) }),
  v.object({ k: v.literal("accept"), id: v.number(), lift: v.optional(v.array(v.number())) }),
  v.object({ k: v.union(v.literal("reject"), v.literal("withdraw")), id: v.number() }),
);

export async function play(ctx: MutationCtx, id: Id<"matches">, a: Action, as?: Id<"users">) {
  const { userId, match, seat } = await seated(ctx, id, { game: "landlord", as });
  const g = step(await load(ctx, match), seat, a);
  await commit(ctx, match, g, userId);
}

export const move = mutation({
  args: { id: v.id("matches"), action },
  handler: async (ctx, { id, action }) => await play(ctx, id, action as Action),
});

// --- What phones read ---

// Everything that's happened since `from` (an event number): the state just before, and each move after it.
// A phone opening the game asks from where it last looked, and plays the rest back. One that's never looked
// (no `from`) gets everything since the player's own last move.
export const log = query({
  args: { id: v.id("matches"), from: v.optional(v.number()) },
  handler: async (ctx, { id, from }) => {
    const end = (r: Doc<"landlordLog">) => r.seq + (r.events as Ev[]).length;
    const rows = ctx.db.query("landlordLog");
    let startRow: Doc<"landlordLog"> | null = null;
    if (from === undefined) {
      const userId = await getAuthUserId(ctx);
      const match = await ctx.db.get(id);
      const seat = match && userId ? seatOf(match, userId) : -1;
      for await (const r of rows.withIndex("by_match", (q) => q.eq("matchId", id)).order("desc")) {
        startRow = r;
        if (seat >= 0 && r.by === seat) break;
      }
    } else {
      // The last move that had finished by `from`, or with nothing that early, the opening.
      const earlier = await rows.withIndex("by_match", (q) => q.eq("matchId", id).lte("seq", from)).order("desc").take(2);
      startRow = earlier.find((r) => end(r) <= from) ?? (await ctx.db.query("landlordLog").withIndex("by_match", (q) => q.eq("matchId", id)).first());
    }
    if (!startRow) return null;
    const after = await ctx.db
      .query("landlordLog")
      .withIndex("by_match", (q) => q.eq("matchId", id).gt("seq", startRow.seq))
      .collect();
    return {
      start: { seq: end(startRow), state: startRow.state as MonoState },
      moves: after.map((r) => ({ seq: r.seq, by: r.by, events: r.events as Ev[], at: r.at })),
    };
  },
});
