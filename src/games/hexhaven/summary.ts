import { publicPoints, type HexState } from "../../../convex/hexhaven/engine";
import type { GameSummary } from "../summary";

export const hexhavenSummary: GameSummary = {
  lastMove: (match) => {
    const s = match.state as HexState | null;
    if (!s) return null;
    return s.phase.k === "setup" ? "Settling" : `Turn ${s.turn}`;
  },
  points: (match, seat) => {
    const s = match.state as HexState | null;
    const p = s?.players[seat];
    return s && p ? (p.points ?? publicPoints(s, seat)) : null;
  },
  pointsUnit: "pts",
};
