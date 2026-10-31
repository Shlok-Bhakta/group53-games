import type { Id } from "../../convex/_generated/dataModel";
import type { ClassicState } from "../../convex/chess";
import type { FourState } from "../../convex/chess/four/classic";
import type { ScrabbleState } from "../../convex/scrabble/engine";
import type { MatchView } from "../../convex/matches";
import type { PokerState } from "../../convex/poker/engine";
import { actionLabel } from "../../convex/poker/text";

// Small per-game facts the shared screens show, without pulling in any game's components.

// The latest move, for a game's row in a list: "Nf3", "QUIZ 42".
export function lastMove(match: MatchView): string | null {
  if (match.mode === "chess:classic") return (match.state as ClassicState).moves.at(-1)?.san ?? null;
  if (match.mode === "chess:four") return (match.state as FourState).moves.at(-1)?.text ?? null;
  if (match.mode.startsWith("scrabble:")) {
    const m = (match.state as ScrabbleState | null)?.moves.at(-1);
    if (!m) return null;
    return m.kind === "play" ? `${m.words![0].word} ${m.score}` : m.kind === "swap" ? "swapped" : m.kind === "pass" ? "passed" : m.kind === "timeout" ? "ran out of time" : "resigned";
  }
  if (match.mode.startsWith("poker:")) {
    const s = match.state as PokerState | null;
    const e = s?.log.filter((x) => x.kind !== "blind").at(-1);
    if (!s) return null;
    return e ? `${actionLabel(e)}${e.amount && e.kind !== "draw" ? ` ${e.amount}` : ""}` : `Hand ${s.hand}`;
  }
  return null;
}

// A player's points at the end, for the standings, in games that keep score.
export function pointsOf(match: MatchView, userId: Id<"users">): number | null {
  const seat = match.players.findIndex((p) => p.userId === userId);
  if (seat < 0) return null;
  if (match.mode === "chess:four") {
    const color = match.players[seat].color as keyof FourState["points"];
    return (match.state as FourState).points[color];
  }
  if (match.mode.startsWith("scrabble:")) return (match.state as ScrabbleState).scores[seat] ?? null;
  if (match.mode.startsWith("poker:")) return (match.state as PokerState).stacks[seat] ?? null;
  return null;
}
