import type { ModeKey, Settings } from "../../../convex/modes";

const time = (s: number) => (s === 60 ? "1-minute" : s % 60 ? `${s}-second` : `${s / 60}-minute`);
const days = (hours: number) => (hours === 24 ? "a day" : `${hours / 24} days`);

// How to play, with the game's settings filled in.
export function scrabbleRules(mode: ModeKey, s: Settings): string[] {
  const live = mode === "scrabble:live";
  return [
    "2 to 8 players. Take turns making words across or down, crossword-style. The first word goes through the centre star.",
    `Everyone holds ${s.rack ?? 7} tiles. Use all of them in one go for +50.`,
    s.wild
      ? "Wild bonuses: a tile on a bonus square keeps it, so every later word through that tile scores it again."
      : "Bonus squares count once, the turn you cover them: 2L and 3L multiply a letter, 2W and 3W the whole word.",
    "Plan any time: lay tiles out on the board while you wait. They stay put until you play, or until someone takes the square.",
    "Swap tiles or pass instead of playing. Blank tiles play as any letter and score nothing.",
    live
      ? `Each turn has a ${time(s.turnTime ?? 90)} timer. Run out and your turn is skipped.`
      : s.moveTime
        ? `We ping you when it's your turn. Sit on it for ${days(s.moveTime)} and we skip you.`
        : "We ping you when it's your turn, and again every 8 hours if you forget.",
    s.rounds
      ? `It ends after ${s.rounds} rounds, when someone runs out of tiles with the bag empty, or when everyone passes twice. Leftover tiles count against you.`
      : "It ends when someone runs out of tiles with the bag empty, or when everyone passes twice in a row. Leftover tiles count against you.",
  ];
}
