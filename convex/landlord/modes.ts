import type { GameDef, ModeDef, Setting } from "../modeKit";

export const LANDLORD_GAME = {
  name: "Monopoly",
  path: "/monopoly",
  reasons: {
    richest: { label: "Richest at the end", push: "the richest at the end", won: "as the richest" },
    last_player: { label: "Last one standing", push: "everyone else went bankrupt", won: "as the last one standing" },
  },
} as const satisfies GameDef;

const LANDLORD: Setting[] = [
  {
    key: "cash",
    label: "Starting cash",
    short: "{} to start",
    options: [1000, 1500, 2000, 2500, 3000].map((v) => ({ value: v, label: `$${v.toLocaleString("en-US")}` })),
    default: 1500,
  },
  {
    key: "game",
    label: "Game",
    short: "{}",
    options: [
      { value: 0, label: "Classic" },
      { value: 1, label: "Short game" },
    ],
    default: 0,
  },
  {
    key: "rounds",
    label: "Rounds",
    short: "{} rounds",
    options: [
      { value: 0, label: "No limit" },
      { value: 10, label: "10" },
      { value: 20, label: "20" },
      { value: 30, label: "30" },
    ],
    default: 0,
  },
  {
    key: "auctions",
    label: "Auctions",
    short: "Auctions {}",
    options: [
      { value: 1, label: "On" },
      { value: 0, label: "Off" },
    ],
    default: 1,
  },
  {
    key: "pot",
    label: "Free Parking jackpot",
    short: "Jackpot: {}",
    options: [
      { value: 0, label: "Off" },
      { value: 1, label: "Taxes and fines" },
      { value: 2, label: "Plus $500" },
    ],
    default: 0,
  },
  {
    key: "goDouble",
    label: "Landing on GO",
    short: "Landing on GO pays {}",
    options: [
      { value: 0, label: "$200" },
      { value: 1, label: "$400" },
    ],
    default: 0,
  },
  {
    key: "jailRent",
    label: "Rent from jail",
    short: "Rent from jail: {}",
    options: [
      { value: 1, label: "Yes" },
      { value: 0, label: "No" },
    ],
    default: 1,
  },
  {
    key: "firstLap",
    label: "Buying on the first lap",
    short: "First-lap buying: {}",
    options: [
      { value: 0, label: "Yes" },
      { value: 1, label: "No" },
    ],
    default: 0,
  },
  {
    key: "speed",
    label: "Speed die",
    short: "Speed die {}",
    options: [
      { value: 0, label: "Off" },
      { value: 1, label: "On" },
    ],
    default: 0,
  },
  {
    key: "limited",
    label: "Houses and hotels",
    short: "{} buildings",
    options: [
      { value: 1, label: "32 and 12" },
      { value: 0, label: "Unlimited" },
    ],
    default: 1,
  },
];

export const LANDLORD_MODES = {
  "landlord:classic": {
    game: "landlord",
    name: "Classic",
    title: "Monopoly",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "landlord",
    slug: "classic",
    blurb: "Buy streets, build houses, bankrupt your friends. Take your turn whenever; trade and build any time.",
    wants: "a game of Monopoly",
    settings: LANDLORD,
  },
} as const satisfies Record<`landlord:${string}`, ModeDef>;
