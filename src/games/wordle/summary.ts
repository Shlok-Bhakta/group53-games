import type { WordleState } from "../../../convex/wordle/engine";
import type { GameSummary } from "../summary";

export const wordleSummary: GameSummary = {
  lastMove: (match) => {
    const s = match.state as WordleState | null;
    if (!s) return null;
    return s.over ? `${s.history.length} words` : `Word ${s.round + 1}`;
  },
  points: (match, seat) => {
    const s = match.state as WordleState | null;
    return s?.players[seat]?.solved ?? null;
  },
  pointsUnit: "words",
};
