import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { finishBySeats } from "./matches";
import { settingsOf } from "./modes";
import { notifyMatch } from "./notify";
import type { GameHooks } from "./games";
import { SEAT_COLORS, seatOf, seated } from "./lib/seats";
import { displayName } from "./lib/people";
import { mySecret, readSecret, writeSecret } from "./lib/secrets";
import { passTurn, startPushes } from "./lib/turns";
import {
  act as step,
  actor,
  newGame,
  standings,
  waitingOn,
  type Action,
  type Dev,
  type Game,
  type Held,
  type HexState,
  type Rules,
} from "./hexhaven/engine";
import { handText, resName, say } from "./hexhaven/text";

export const REMIND_MS = 4 * 60 * 60 * 1000;
const REMIND_LATER_MS = 12 * 60 * 60 * 1000;
const EAGER_REMINDERS = 4;
const SEEN_CHECKED = new Set<Action["k"]>(["buy", "bank", "offer", "plenty", "corner"]);

export function rulesOf(mode: string, raw: Doc<"matches">["settings"]): Rules {
  const s = settingsOf(mode, raw);
  return { points: s.points, limit: s.limit, friendly: s.friendly === 1, balanced: s.balanced === 1 };
}

export async function load(ctx: MutationCtx, match: Doc<"matches">): Promise<Game> {
  const deck = await readSecret<Dev[]>(ctx, match._id, undefined, []);
  const held = await Promise.all(match.players.map((p) => readSecret<Held[]>(ctx, match._id, p.userId, [])));
  return { s: match.state as HexState, deck, held, events: [] };
}

async function save(ctx: MutationCtx, match: Doc<"matches">, before: Game | null, g: Game) {
  if (!before || before.deck.length !== g.deck.length) await writeSecret(ctx, match._id, undefined, g.deck);
  for (const [i, p] of match.players.entries())
    if (!before || JSON.stringify(before.held[i]) !== JSON.stringify(g.held[i])) await writeSecret(ctx, match._id, p.userId, g.held[i]);
}

async function commit(ctx: MutationCtx, match: Doc<"matches">, before: Game | null, g: Game, by: Id<"users"> | null) {
  await save(ctx, match, before, g);
  if (g.s.phase.k === "over") {
    const moveCount = match.moveCount + 1;
    await ctx.db.patch(match._id, { state: g.s, moveCount, lastActivityAt: Date.now() });
    const ended = { ...match, state: g.s, moveCount };
    const outs = g.events.some((e) => e.t === "out");
    const reason = !outs ? "points" : match.players.length === 2 ? "resign" : "last_player";
    await finishBySeats(ctx, ended, standings(g), reason);
    return;
  }
  const turn = match.players[actor(g.s)].userId;
  const { match: after, fresh } = await passTurn(ctx, match, {
    state: g.s,
    turn,
    by,
    timer: { at: Date.now() + REMIND_MS, fn: internal.hexhaven.remind },
  });
  if (!before) {
    const name = await displayName(ctx, turn);
    await startPushes(ctx, match, (p) => ({
      title: "Hexhaven is on",
      body: p.userId === turn ? "You place first." : `${name} places first.`,
    }));
    return;
  }
  await tell(ctx, after, g, by, fresh);
}

function upNext(s: HexState): { title: string; body: string } {
  const ph = s.phase;
  if (ph.k === "setup")
    return {
      title: "Your turn to settle",
      body: ph.i >= s.players.length ? "Place your second village and road." : "Place your first village and road.",
    };
  if (ph.k === "discard") return { title: "The bandit's here", body: "A 7 came up. Give back half your cards." };
  return { title: "Your turn", body: "Your roll." };
}

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
    if (e.t === "roll" && s.phase.k === "discard")
      for (const seat of waitingOn(s)) {
        const owe = s.phase.owe[seat];
        put(seat, 0, `${names[e.seat]} rolled a 7`, `Give back ${owe} card${owe === 1 ? "" : "s"}.`);
      }
    if (e.t === "offer") {
      const o = e.offer;
      const to = o.to >= 0 ? [o.to] : s.players.map((_, i) => i).filter((i) => i !== o.from);
      for (const seat of to) put(seat, 1, `${names[o.from]} wants to trade`, `Their ${handText(o.give)} for your ${handText(o.get)}.`);
    }
    if (e.t === "steal") put(e.from, 2, `${names[e.seat]} robbed you`, `Their bandit took your ${resName(e.r)}.`);
    if (e.t === "play" && e.card === "corner")
      for (const seat of s.players.keys())
        if (seat !== e.seat) put(seat, 2, `${names[e.seat]} cornered ${resName(e.r ?? 0)}`, "They took every one you had.");
    if (e.t === "traded")
      put(e.offer.from, 3, `${names[e.by]} took your trade`, `Your ${handText(e.offer.give)} for their ${handText(e.offer.get)}.`);
    if (e.t === "untrade" && e.why === "reject" && e.offer.to >= 0)
      put(e.offer.from, 3, `${names[e.by]} turned your trade down`, `Your ${handText(e.offer.give)} for their ${handText(e.offer.get)}.`);
  }
  if (fresh && s.phase.k !== "discard") {
    const up = actor(s);
    const nameFor = (seat: number) => (seat === up ? "you" : names[seat]);
    const lines = g.events.map((e) => say(e, nameFor)).filter((x): x is string => !!x);
    const next = upNext(s);
    const recap = s.phase.k === "roll" ? lines.slice(-2).join(" ") : "";
    put(up, 0, next.title, recap ? `${recap} ${next.body}` : next.body);
  }
  for (const [seat, p] of pushes) await notifyMatch(ctx, match.players[seat].userId, match, { title: p.title, body: p.body });
}

export const hexhavenHooks: GameHooks = {
  seats: (_mode, n) => SEAT_COLORS.slice(0, n),
  start: async (ctx, match) => {
    const g = newGame(match.players.length, rulesOf(match.mode, match.settings), Math.random);
    await commit(ctx, { ...match, state: g.s }, null, g, null);
  },
  resign: async (ctx, match, userId) => {
    const seat = seatOf(match, userId);
    const s = match.state as HexState;
    if (seat < 0 || s.players[seat].out) return;
    const before = await load(ctx, match);
    await commit(ctx, match, before, step(before, seat, { k: "resign" }), userId);
  },
  timeout: async () => {},
  timeoutWarning: "",
};

export const remind = internalMutation({
  args: { id: v.id("matches"), moveCount: v.number(), strikes: v.optional(v.number()) },
  handler: async (ctx, { id, moveCount, strikes = 0 }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || match.moveCount !== moveCount) return;
    const s = match.state as HexState;
    const ph = s.phase;
    const body =
      ph.k === "setup"
        ? "Everyone's waiting on you to place your village."
        : ph.k === "discard"
          ? "A 7 came up. Give back half your cards."
          : ph.k === "roll"
            ? "Everyone's waiting on your roll."
            : "Everyone's waiting on you to finish your turn.";
    for (const seat of waitingOn(s)) await notifyMatch(ctx, match.players[seat].userId, match, { title: "Still your move", body });
    await ctx.scheduler.runAfter(strikes + 1 >= EAGER_REMINDERS ? REMIND_LATER_MS : REMIND_MS, internal.hexhaven.remind, {
      id,
      moveCount,
      strikes: strikes + 1,
    });
  },
});

const hand = v.array(v.number());
export const action = v.union(
  v.object({ k: v.union(v.literal("village"), v.literal("road"), v.literal("town")), at: v.number() }),
  v.object({
    k: v.union(v.literal("roll"), v.literal("buy"), v.literal("knight"), v.literal("roads"), v.literal("end"), v.literal("doneRoads")),
  }),
  v.object({ k: v.literal("discard"), res: hand }),
  v.object({ k: v.literal("bandit"), hex: v.number(), from: v.number() }),
  v.object({ k: v.literal("plenty"), a: v.number(), b: v.number() }),
  v.object({ k: v.literal("corner"), r: v.number() }),
  v.object({ k: v.literal("bank"), give: v.number(), get: v.number() }),
  v.object({ k: v.literal("offer"), to: v.number(), give: hand, get: hand }),
  v.object({ k: v.union(v.literal("accept"), v.literal("reject"), v.literal("withdraw")), id: v.number() }),
);

export async function play(ctx: MutationCtx, id: Id<"matches">, a: Action, as?: Id<"users">, seen?: number) {
  const { userId, match, seat } = await seated(ctx, id, { game: "hexhaven", as });
  const s = match.state as HexState;
  if (seen !== undefined && SEEN_CHECKED.has(a.k) && seen !== s.seq) throw new Error("That changed while you were looking. Try again.");
  const before = await load(ctx, match);
  await commit(ctx, match, before, step(before, seat, a), userId);
}

export const move = mutation({
  args: { id: v.id("matches"), action, seen: v.optional(v.number()) },
  handler: async (ctx, { id, action, seen }) => await play(ctx, id, action as Action, undefined, seen),
});

export const cards = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => await mySecret<Held[]>(ctx, id),
});
