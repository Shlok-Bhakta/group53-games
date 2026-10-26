// How a game ended, as shown to players.
export const REASONS: Record<string, string> = {
  checkmate: "Checkmate",
  resign: "By resignation",
  stalemate: "Stalemate",
  repetition: "Threefold repetition",
  insufficient: "Insufficient material",
  fifty: "Fifty-move rule",
  agreement: "Draw agreed",
  king: "King captured",
  both_kings: "Both kings fell at once",
  no_progress: "90 seconds with no captures or pawn moves",
  last_player: "Last one standing",
  last_king: "Last king standing",
  timeout: "Timed out",
  went_out: "Went out",
  passes: "Everyone passed twice",
  rounds: "Last round played",
};

export const reasonText = (reason: string, mode: string) => (reason === "fifty" && mode === "chess:four" ? "Fifty quiet rounds" : (REASONS[reason] ?? reason));

// "Chris", "Chris and Sam", "Chris, Sam and Alex".
export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "nobody";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
