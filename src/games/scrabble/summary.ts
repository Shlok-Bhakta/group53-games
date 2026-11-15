import type { ScrabbleState } from "../../../convex/scrabble/engine";
import type { GameSummary } from "../summary";

type Move = ScrabbleState["moves"][number];

const QUIET_MOVE: Record<Exclude<Move["kind"], "play">, string> = {
  swap: "swapped",
  pass: "passed",
  timeout: "ran out of time",
  resign: "resigned",
};

export const scrabbleSummary: GameSummary = {
  lastMove: (match) => {
    const m = (match.state as ScrabbleState | null)?.moves.at(-1);
    if (!m) return null;
    return m.kind === "play" ? `${m.words![0].word} ${m.score}` : QUIET_MOVE[m.kind];
  },
  points: (match, seat) => (match.state as ScrabbleState).scores[seat] ?? null,
  pointsUnit: "pts",
};
