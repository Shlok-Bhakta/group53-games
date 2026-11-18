import type { GameDef, ModeDef, Setting } from "../modeKit";

export const HEXHAVEN_GAME = {
  name: "Catan",
  path: "/catan",
  reasons: {
    points: { label: "First to the points", push: "first to the points", won: "by reaching the points first" },
  },
} as const satisfies GameDef;

const HEXHAVEN: Setting[] = [
  {
    key: "points",
    label: "Points to win",
    short: "{} points to win",
    options: [8, 10, 12, 15].map((v) => ({ value: v, label: String(v) })),
    default: 10,
  },
  {
    key: "limit",
    label: "Hand limit on a 7",
    short: "Hand limit {}",
    options: [
      { value: 7, label: "7 cards" },
      { value: 9, label: "9 cards" },
    ],
    default: 7,
  },
  {
    key: "friendly",
    label: "Friendly robber",
    short: "Friendly robber {}",
    options: [
      { value: 0, label: "Off" },
      { value: 1, label: "On" },
    ],
    default: 0,
  },
  {
    key: "balanced",
    label: "Numbers",
    short: "{} numbers",
    options: [
      { value: 1, label: "Balanced" },
      { value: 0, label: "Wild" },
    ],
    default: 1,
  },
];

export const HEXHAVEN_MODES = {
  "hexhaven:classic": {
    game: "hexhaven",
    name: "Classic",
    title: "Catan",
    kind: "async",
    players: 6,
    minPlayers: 2,
    board: "hexhaven",
    slug: "classic",
    blurb: "Settle the island, build roads and cities, trade what you've got for what you need. Take your turn whenever.",
    wants: "a game of Catan",
    settings: HEXHAVEN,
  },
} as const satisfies Record<`hexhaven:${string}`, ModeDef>;
