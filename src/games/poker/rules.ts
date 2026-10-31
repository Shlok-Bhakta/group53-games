import type { ModeKey, Settings } from "../../../convex/modes";

const days = (hours: number) => (hours === 24 ? "a day" : `${hours / 24} days`);

// How to play, with the game's settings filled in.
export function pokerRules(mode: ModeKey, s: Settings): string[] {
  const stack = s.stack ?? 1000;
  const sb = Math.max(1, Math.round(stack / 100));
  const pot = s.betting === 1;
  const lines: string[] = [];
  if (mode === "poker:draw") {
    lines.push("2 to 6 players. Everyone gets five cards, face down, and there's no board.");
    lines.push("Bet, then swap any of your cards for new ones from the deck, then bet again. Best five cards wins.");
  } else if (mode === "poker:omaha") {
    lines.push("2 to 8 players. Everyone gets four cards; five more come out on the table: three on the flop, then the turn, then the river.");
    lines.push("Your hand is exactly two of your four cards and exactly three from the table. Not one, not three.");
  } else {
    lines.push("2 to 8 players. Everyone gets two cards; five more come out on the table: three on the flop, then the turn, then the river.");
    lines.push("Your hand is the best five of your two and the table's five. There's a round of betting before each card comes out and one at the end.");
    if (mode === "poker:short")
      lines.push("Short Deck: the 2s to 5s are gone, so it's 36 cards. A flush beats a full house, three of a kind beats a straight, and A-6-7-8-9 is a straight.");
  }
  lines.push(
    "Hands, best first: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card.",
    `Everyone starts with ${stack.toLocaleString("en-US")} chips. Blinds start at ${sb}/${sb * 2}${s.blinds ? ` and double every ${s.blinds} hands` : ""}.`,
    pot ? "Pot limit: the most you can raise is the size of the pot after you call." : "No limit: you can bet everything you have at any time.",
    "Not your turn? Line up Check/Fold or Call and it plays itself the moment the action reaches you.",
    s.moveTime ? `We ping you when it's your move. Sit on it for ${days(s.moveTime)} and we check or fold for you.` : "We ping you when it's your move, and again every 8 hours if you forget.",
    s.hands
      ? `Run out of chips and you're out. After ${s.hands} hands, most chips wins; it ends sooner if one player takes everything.`
      : "Run out of chips and you're out. Last one with chips wins.",
  );
  return lines;
}
