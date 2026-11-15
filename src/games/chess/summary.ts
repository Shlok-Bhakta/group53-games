import type { ClassicState } from "../../../convex/chess";
import type { FourState } from "../../../convex/chess/four/classic";
import type { GameSummary } from "../summary";

export const chessSummary: GameSummary = {
  lastMove: (match) => {
    if (match.mode === "chess:classic") return (match.state as ClassicState).moves.at(-1)?.san ?? null;
    if (match.mode === "chess:four") return (match.state as FourState).moves.at(-1)?.text ?? null;
    return null;
  },
  points: (match, seat) => {
    if (match.mode !== "chess:four") return null;
    const color = match.players[seat].color as keyof FourState["points"];
    return (match.state as FourState).points[color];
  },
  pointsUnit: "pts",
};
