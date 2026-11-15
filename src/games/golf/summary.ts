import { totals, type GolfState } from "../../../convex/golf/round";
import type { GameSummary } from "../summary";

export const golfSummary: GameSummary = {
  lastMove: (match) => {
    const s = match.state as GolfState | null;
    return s && s.hole >= 0 ? `Hole ${s.hole + 1} of ${s.total}` : null;
  },
  points: (match, seat) => totals(match.state as GolfState, match.players.length)[seat] ?? null,
  pointsUnit: "strokes",
};
