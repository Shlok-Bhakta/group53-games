import { settingsOf, type ModeKey, type Settings } from "../../../convex/modes";
import { BASE_PAY, ITEMS, ITEM_KEYS, ROWS, SOLVE_PAY, START_COINS, roundsFor } from "../../../convex/wordle/engine";

export function wordleRules(mode: ModeKey, raw: Settings): string[] {
  const s = settingsOf(mode, raw);
  const time = s.wordTime
    ? `Each word stays open for ${s.wordTime === 24 ? "a day" : `${s.wordTime} hours`}; anyone not done by then misses it.`
    : "";
  return [
    `Everyone gets the same five-letter word and ${ROWS} guesses, all at once. Play whenever: the next word opens when the last of you is done.`,
    "Green is the right letter in the right spot, yellow is in the word somewhere else, gray isn't in it.",
    `First to solve ${s.goal} words wins. If nobody gets there in ${roundsFor(s.goal)} words, the most solved wins. Ties go to fewer guesses, then more coins.`,
    `You start with ${START_COINS} coins. Each word pays ${BASE_PAY}, plus 1 for every letter you turned green, plus ${SOLVE_PAY} and 1 for every guess you had left if you solved it.`,
    ...(s.shop
      ? [
          "Done with your word? Buy one thing from the shop, or pass. Everyone picks without seeing the others' picks.",
          "When the shop closes, whoever has the fewest coins buys first. Anything that sells out before your turn costs you nothing.",
          ...ITEM_KEYS.map((k) => `${ITEMS[k].name} (${ITEMS[k].price}): ${ITEMS[k].text}`),
        ]
      : []),
    `You see everyone's colors once you've finished the word yourself, and their letters once the word closes.${time ? ` ${time}` : ""}`,
  ];
}
