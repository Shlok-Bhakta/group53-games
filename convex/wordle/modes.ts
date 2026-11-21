import type { GameDef, ModeDef, Setting } from "../modeKit";

export const WORDLE_GAME = {
  name: "PvP Wordle",
  path: "/wordle",
  reasons: {
    words: {
      label: "Most words, fewest guesses",
      push: "most words in the fewest guesses",
      won: "with the most words in the fewest guesses",
    },
    rounds: { label: "Out of words", push: "out of words", won: "with the most words solved" },
  },
} as const satisfies GameDef;

const WORDLE: Setting[] = [
  {
    key: "goal",
    label: "Words to win",
    short: "First to {} words",
    options: [3, 5, 7].map((v) => ({ value: v, label: String(v) })),
    default: 5,
  },
  {
    key: "wordTime",
    label: "Time per word",
    short: "{} per word",
    options: [
      { value: 0, label: "No limit" },
      { value: 12, label: "12 hours" },
      { value: 24, label: "1 day" },
      { value: 48, label: "2 days" },
    ],
    default: 24,
  },
  {
    key: "shop",
    label: "Shop",
    short: "Shop {}",
    options: [
      { value: 1, label: "On" },
      { value: 0, label: "Off" },
    ],
    default: 1,
  },
];

export const WORDLE_MODES = {
  "wordle:classic": {
    game: "wordle",
    name: "Classic",
    title: "PvP Wordle",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "wordle",
    slug: "classic",
    blurb: "Everyone gets the same word. Solve it, earn coins, then buy fog, jams and short fuses to throw at the others.",
    wants: "a game of PvP Wordle",
    settings: WORDLE,
  },
} as const satisfies Record<`wordle:${string}`, ModeDef>;
