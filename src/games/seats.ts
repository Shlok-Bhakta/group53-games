// Seat colors shared by every game: four-player chess armies, Scrabble players' tiles. "dead" is an army
// that's out.
export const SEAT_COLORS: Record<string, string> = {
  red: "#e0503f",
  blue: "#3f7be0",
  yellow: "#e8b928",
  green: "#3faa5a",
  purple: "#9b5de5",
  orange: "#f08a24",
  teal: "#1fb5a8",
  pink: "#e8559a",
  dead: "#9aa0a6",
};

// A player's seat color, grey once they're out or if they haven't got a seat color.
export const seatColor = (player: { color?: string } | undefined, out = false) => SEAT_COLORS[out ? "dead" : (player?.color ?? "dead")] ?? SEAT_COLORS.dead;
