import { moveTime, type GameDef, type ModeDef, type Setting } from "../modeKit";

export const POKER_GAME = {
  name: "Poker",
  path: "/poker",
  reasons: { hands: { label: "Last hand played", push: "the last hand" } },
} as const satisfies GameDef;

const BETTING = { noLimit: 0, potLimit: 1 } as const;

const poker = (betting: number): Setting[] => [
  {
    key: "stack",
    label: "Chips",
    short: "{} chips",
    options: [
      { value: 500, label: "500" },
      { value: 1000, label: "1,000" },
      { value: 2000, label: "2,000" },
    ],
    default: 1000,
  },
  {
    key: "hands",
    label: "Hands",
    short: "{} hands",
    options: [
      { value: 0, label: "No limit" },
      { value: 5, label: "5" },
      { value: 10, label: "10" },
      { value: 20, label: "20" },
    ],
    default: 0,
  },
  {
    key: "blinds",
    label: "Blinds go up every",
    short: "Blinds up: {}",
    options: [
      { value: 2, label: "2 hands" },
      { value: 3, label: "3 hands" },
      { value: 5, label: "5 hands" },
      { value: 0, label: "Never" },
    ],
    default: 3,
  },
  {
    key: "blindsBy",
    label: "Blinds multiply by",
    short: "Blinds {}",
    options: [
      { value: 1.25, label: "×1.25" },
      { value: 1.5, label: "×1.5" },
      { value: 2, label: "×2" },
      { value: 3, label: "×3" },
    ],
    default: 2,
  },
  {
    key: "betting",
    label: "Betting",
    short: "{}",
    options: [
      { value: BETTING.noLimit, label: "No limit" },
      { value: BETTING.potLimit, label: "Pot limit" },
    ],
    default: betting,
  },
  moveTime(24),
];

export const POKER_MODES = {
  "poker:holdem": {
    game: "poker",
    name: "Hold'em",
    title: "Texas Hold'em",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "poker",
    slug: "holdem",
    blurb: "Two cards each, five on the table. Bet, bluff, and take everyone's chips over the day.",
    settings: poker(BETTING.noLimit),
  },
  "poker:omaha": {
    game: "poker",
    name: "Omaha",
    title: "Omaha",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "poker",
    slug: "omaha",
    blurb: "Four cards each, and you use exactly two of them. Bigger hands, pot-limit betting.",
    settings: poker(BETTING.potLimit),
  },
  "poker:short": {
    game: "poker",
    name: "Short Deck",
    title: "Short Deck Hold'em",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "poker",
    slug: "short",
    blurb: "Hold'em with the 2s to 5s taken out. A flush beats a full house.",
    settings: poker(BETTING.noLimit),
  },
  "poker:draw": {
    game: "poker",
    name: "5-Card Draw",
    title: "five-card draw",
    kind: "async",
    players: 6,
    minPlayers: 2,
    board: "poker",
    slug: "draw",
    blurb: "Five cards each and no board. Bet, swap what you don't want, bet again.",
    settings: poker(BETTING.noLimit),
  },
} as const satisfies Record<`poker:${string}`, ModeDef>;
