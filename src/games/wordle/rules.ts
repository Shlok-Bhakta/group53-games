import { settingsOf, type ModeKey, type Settings } from "../../../convex/modes";
import { BASE_PAY, ITEMS, ITEM_KEYS, MAX_CART, MAX_HAND, ROWS, SOLVE_PAY, START_COINS, roundsFor } from "../../../convex/wordle/engine";

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
          `Done with your word? Fill a cart with up to ${MAX_CART} things from the shop, or pass. Each word the shop gets a random stock, and some things sell out before anyone shops.`,
          "Whoever had the fewest coins going into the word shops first. What's left for you already leaves out what they've claimed, and if one of them takes the last of something in your cart, you get those coins back and shop again. The shop never says who claimed what, and nobody's told what hit them until the next word starts.",
          `Things you throw land on that player's next word. Things for you are cards: they go in your hand (${MAX_HAND} at most, kept from word to word) and you play them during a word, whenever you need them. Stuck mid-word with no card? Hint, Clue and Extra row can be bought on the spot for half again their price.`,
          "Coins come off when the shop closes: until then, the coins shown next to your cart are what you'll have left.",
          ...ITEM_KEYS.map((k) => `${ITEMS[k].name} (${ITEMS[k].price}): ${ITEMS[k].text}`),
        ]
      : []),
    `You see everyone's colors once you've finished the word yourself, and their letters once the word closes.${time ? ` ${time}` : ""}`,
  ];
}
