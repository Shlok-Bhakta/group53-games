import { moveTime, type GameDef, type ModeDef, type Setting } from "../modeKit";

export const SCRABBLE_GAME = {
  name: "Scrabble",
  path: "/scrabble",
  reasons: {
    went_out: { label: "Went out", push: "someone went out" },
    passes: { label: "Everyone passed twice", push: "everyone passed" },
    rounds: { label: "Last round played", push: "the last round" },
  },
} as const satisfies GameDef;

const SCRABBLE: Setting[] = [
  {
    key: "rack",
    label: "Tiles in hand",
    short: "{} tiles",
    options: [
      { value: 5, label: "5" },
      { value: 7, label: "7" },
      { value: 9, label: "9" },
    ],
    default: 7,
  },
  {
    key: "bag",
    label: "Tiles in the bag",
    short: "{} bag",
    options: [
      { value: 50, label: "Half" },
      { value: 100, label: "100" },
      { value: 150, label: "150" },
      { value: 200, label: "200" },
    ],
    default: 100,
  },
  {
    key: "board",
    label: "Board",
    short: "{} board",
    options: [
      { value: 15, label: "15×15" },
      { value: 21, label: "21×21" },
    ],
    default: 15,
  },
  {
    key: "rules",
    label: "Rules",
    short: "{} rules",
    options: [
      { value: 0, label: "Scrabble" },
      { value: 1, label: "Letter League" },
    ],
    default: 0,
  },
  {
    key: "rounds",
    label: "Rounds",
    short: "{} rounds",
    options: [
      { value: 0, label: "No limit" },
      { value: 5, label: "5" },
      { value: 10, label: "10" },
      { value: 15, label: "15" },
    ],
    default: 0,
  },
];

export const SCRABBLE_MODES = {
  "scrabble:classic": {
    game: "scrabble",
    name: "Classic",
    title: "Scrabble",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "scrabble",
    slug: "classic",
    blurb: "Take turns over the day. Plan your words on the board while you wait.",
    settings: [...SCRABBLE, moveTime(0)],
  },
  "scrabble:live": {
    game: "scrabble",
    name: "Live",
    title: "live Scrabble",
    kind: "realtime",
    players: 8,
    minPlayers: 2,
    board: "scrabble",
    slug: "live",
    blurb: "Everyone on at once, with a timer on every turn.",
    settings: [
      ...SCRABBLE,
      {
        key: "turnTime",
        label: "Turn timer",
        short: "{} turns",
        options: [
          { value: 30, label: "30s" },
          { value: 60, label: "1m" },
          { value: 90, label: "90s" },
          { value: 120, label: "2m" },
          { value: 180, label: "3m" },
        ],
        default: 90,
      },
    ],
  },
} as const satisfies Record<`scrabble:${string}`, ModeDef>;
