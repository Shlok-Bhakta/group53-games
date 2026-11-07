import type { FunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { REMINDER_MS } from "../modes";
import { notifyMatch } from "../notify";

// Turns in turn-based games. Every move bumps matches.moveCount, and the clock it arms (the 8-hour reminder,
// or a live game's turn timer) carries the count it was set for and does nothing once anyone has moved, so
// clocks never need cancelling.

// Re-arms the "it's your move" reminder (matches.remind). `strikes` counts the reminders already sent for
// this move, toward the game's "Time to move".
export async function scheduleReminder(ctx: MutationCtx, matchId: Id<"matches">, moveCount: number, strikes = 0) {
  await ctx.scheduler.runAfter(REMINDER_MS, internal.matches.remind, { id: matchId, moveCount, strikes });
}

// A live game's turn timer: `fn` runs at `at` with the match and the move count it was set for.
export type TurnTimer = { at: number; fn: FunctionReference<"mutation", "internal", { id: Id<"matches">; moveCount: number }> };

// Starts the clock on whoever's move it is: the reminder, or `timer`.
export async function armTurn(ctx: MutationCtx, match: Pick<Doc<"matches">, "_id" | "moveCount">, timer?: TurnTimer | null) {
  if (timer) await ctx.scheduler.runAt(timer.at, timer.fn, { id: match._id, moveCount: match.moveCount });
  else await scheduleReminder(ctx, match._id, match.moveCount);
}

type Pass = {
  // The new matches.state, and who moves next.
  state: unknown;
  turn: Id<"users">;
  // Who made the move, or null when the game made it for the player to move (their time ran out).
  by: Id<"users"> | null;
  // For the next player, unless they made the move themselves.
  push?: { title: string; body: string };
  timer?: TurnTimer | null;
  // Anything else to change on the match.
  patch?: Partial<Doc<"matches">>;
};

// Saves a move and hands the turn on: a new move count, a push for the next player, and their clock. A move
// by someone who isn't on turn (a resignation) that leaves the turn where it was changes none of those, so
// the player to move keeps the reminder and strikes they had. `fresh` says which it was.
export async function passTurn(ctx: MutationCtx, match: Doc<"matches">, { state, turn, by, push, timer, patch }: Pass) {
  const fresh = turn !== match.turn || by === null || by === match.turn;
  const changes = { ...patch, state, turn, moveCount: fresh ? match.moveCount + 1 : match.moveCount, lastActivityAt: Date.now() };
  await ctx.db.patch(match._id, changes);
  const after = { ...match, ...changes };
  if (fresh && push && turn !== by) await notifyMatch(ctx, turn, match, push);
  if (fresh) await armTurn(ctx, after, timer);
  return { match: after, fresh };
}

// A game's opening pushes: `push` says what each player gets, if anything. Rematches start with everyone
// already looking at the game, so they get none.
export async function startPushes(ctx: MutationCtx, match: Doc<"matches">, push: (player: Doc<"matches">["players"][number]) => { title: string; body: string } | null) {
  if (match.rematchOf) return;
  for (const p of match.players) {
    const m = push(p);
    if (m) await notifyMatch(ctx, p.userId, match, m);
  }
}
