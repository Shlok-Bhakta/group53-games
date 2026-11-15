import type { Id } from "../../convex/_generated/dataModel";
import type { MatchView } from "../../convex/matches";
import { gameOf, isMode } from "../../convex/modes";
import { GAME_UI } from ".";

export type GameSummary = {
  lastMove: (match: MatchView) => string | null;
  points: (match: MatchView, seat: number) => number | null;
  pointsUnit: string;
};

const DEFAULT_POINTS_UNIT = "pts";

function summaryOf(match: MatchView): GameSummary | null {
  return isMode(match.mode) ? GAME_UI[gameOf(match.mode)].summary : null;
}

export function lastMove(match: MatchView): string | null {
  return summaryOf(match)?.lastMove(match) ?? null;
}

export function pointsOf(match: MatchView, userId: Id<"users">): number | null {
  const seat = match.players.findIndex((p) => p.userId === userId);
  if (seat < 0) return null;
  return summaryOf(match)?.points(match, seat) ?? null;
}

export function pointsUnit(match: MatchView): string {
  return summaryOf(match)?.pointsUnit ?? DEFAULT_POINTS_UNIT;
}
