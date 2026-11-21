import { cardName } from "../../../convex/uno/cards";
import type { UnoState } from "../../../convex/uno/engine";
import type { GameSummary } from "../summary";

export const unoSummary: GameSummary = {
  lastMove: (match) => {
    const s = match.state as UnoState | null;
    if (!s) return null;
    return s.rules.goal ? `Hand ${s.hand}, ${cardName(s.top)}` : cardName(s.top);
  },
  points: (match, seat) => {
    const s = match.state as UnoState | null;
    if (!s) return null;
    return s.rules.goal ? (s.scores[seat] ?? null) : null;
  },
  pointsUnit: "pts",
};
