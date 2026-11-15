import type { PokerState } from "../../../convex/poker/engine";
import { actionLabel } from "../../../convex/poker/text";
import type { GameSummary } from "../summary";

export const pokerSummary: GameSummary = {
  lastMove: (match) => {
    const s = match.state as PokerState | null;
    const e = s?.log.filter((x) => x.kind !== "blind").at(-1);
    if (!s) return null;
    return e ? `${actionLabel(e)}${e.amount && e.kind !== "draw" ? ` ${e.amount}` : ""}` : `Hand ${s.hand}`;
  },
  points: (match, seat) => (match.state as PokerState).stacks[seat] ?? null,
  pointsUnit: "chips",
};
