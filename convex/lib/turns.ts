import type { FunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { REMINDER_MS } from "../modes";
import { notifyMatch } from "../notify";

export async function scheduleReminder(ctx: MutationCtx, matchId: Id<"matches">, moveCount: number, strikes = 0) {
  await ctx.scheduler.runAfter(REMINDER_MS, internal.matches.remind, { id: matchId, moveCount, strikes });
}

export type TurnTimer = { at: number; fn: FunctionReference<"mutation", "internal", { id: Id<"matches">; moveCount: number }> };

export async function armTurn(ctx: MutationCtx, match: Pick<Doc<"matches">, "_id" | "moveCount">, timer?: TurnTimer | null) {
  if (timer) await ctx.scheduler.runAt(timer.at, timer.fn, { id: match._id, moveCount: match.moveCount });
  else await scheduleReminder(ctx, match._id, match.moveCount);
}

type Pass = {
  state: unknown;
  turn: Id<"users">;
  by: Id<"users"> | null;
  push?: { title: string; body: string };
  timer?: TurnTimer | null;
  patch?: Partial<Doc<"matches">>;
  newDecision?: boolean;
};

export async function passTurn(ctx: MutationCtx, match: Doc<"matches">, { state, turn, by, push, timer, patch, newDecision }: Pass) {
  const fresh = turn !== match.turn || by === null || by === match.turn || !!newDecision;
  const changes = { ...patch, state, turn, moveCount: fresh ? match.moveCount + 1 : match.moveCount, lastActivityAt: Date.now() };
  await ctx.db.patch(match._id, changes);
  const after = { ...match, ...changes };
  if (fresh && push && turn !== by) await notifyMatch(ctx, turn, match, push);
  if (fresh) await armTurn(ctx, after, timer);
  return { match: after, fresh };
}

export async function startPushes(
  ctx: MutationCtx,
  match: Doc<"matches">,
  push: (player: Doc<"matches">["players"][number]) => { title: string; body: string } | null,
) {
  if (match.rematchOf) return;
  for (const p of match.players) {
    const m = push(p);
    if (m) await notifyMatch(ctx, p.userId, match, m);
  }
}
