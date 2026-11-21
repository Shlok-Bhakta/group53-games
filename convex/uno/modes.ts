import { moveTime, type GameDef, type ModeDef, type Setting } from "../modeKit";
import type { Rules, Stacking } from "./engine";

export const UNO_GAME = {
  name: "Uno",
  path: "/uno",
  reasons: {
    out: { label: "Went out first", push: "out of cards first", won: "by going out first" },
    points: { label: "Reached the points", push: "first to the points", won: "by reaching the points first" },
    mercy: { label: "Last one standing", push: "everyone else hit the mercy rule", won: "as the last one standing" },
  },
} as const satisfies GameDef;

const onOff = (key: string, label: string, short: string, on: boolean): Setting => ({
  key,
  label,
  short,
  options: [
    { value: 1, label: "On" },
    { value: 0, label: "Off" },
  ],
  default: on ? 1 : 0,
});

const hand: Setting = {
  key: "hand",
  label: "Starting hand",
  short: "{} cards each",
  options: [5, 7, 10].map((v) => ({ value: v, label: String(v) })),
  default: 7,
};

const decks: Setting = {
  key: "decks",
  label: "Decks",
  short: "{}",
  options: [
    { value: 1, label: "One" },
    { value: 2, label: "Double deck" },
  ],
  default: 1,
};

const mercy = (on: number): Setting => ({
  key: "mercy",
  label: "Mercy rule",
  short: "Mercy: {}",
  options: [
    { value: 0, label: "Off" },
    { value: 20, label: "Out at 20" },
    { value: 25, label: "Out at 25" },
    { value: 30, label: "Out at 30" },
  ],
  default: on,
});

const goal = (points: number[]): Setting => ({
  key: "goal",
  label: "Play to",
  short: "Play to {}",
  options: [{ value: 0, label: "One hand" }, ...points.map((v) => ({ value: v, label: `${v.toLocaleString("en-US")} pts` }))],
  default: 0,
});

const CLASSIC: Setting[] = [
  hand,
  decks,
  {
    key: "stack",
    label: "Stacking draws",
    short: "Stacking: {}",
    options: [
      { value: 0, label: "Off" },
      { value: 1, label: "Same card" },
      { value: 2, label: "Same or bigger" },
    ],
    default: 0,
  },
  {
    key: "drawUntil",
    label: "Can't play?",
    short: "{}",
    options: [
      { value: 0, label: "Draw one" },
      { value: 1, label: "Draw till you can" },
    ],
    default: 0,
  },
  onOff("sevenZero", "7 swaps, 0 passes", "7-0 {}", false),
  onOff("jumpIn", "Jump-in", "Jump-in {}", false),
  onOff("challenge", "Challenge a Wild Draw 4", "Challenges {}", true),
  onOff("unoCall", "Call UNO or draw 2", "UNO calls {}", true),
  onOff("forcePlay", "Must play if you can", "Forced play {}", false),
  onOff("powerFinish", "Go out on a power card", "Power finish {}", true),
  mercy(0),
  goal([250, 500]),
  moveTime(24),
];

const NO_MERCY: Setting[] = [
  hand,
  decks,
  onOff("sevenZero", "7 swaps, 0 passes", "7-0 {}", true),
  onOff("jumpIn", "Jump-in", "Jump-in {}", false),
  onOff("unoCall", "Call UNO or draw 2", "UNO calls {}", true),
  onOff("powerFinish", "Go out on a power card", "Power finish {}", true),
  mercy(25),
  goal([500, 1000]),
  moveTime(24),
];

export const UNO_MODES = {
  "uno:classic": {
    game: "uno",
    name: "Classic",
    title: "Uno",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "uno",
    slug: "classic",
    blurb:
      "Match the color or the number, hit people with Draw 4s, and get rid of your hand first. Every house rule you've argued about is a setting.",
    wants: "a game of Uno",
    settings: CLASSIC,
  },
  "uno:nomercy": {
    game: "uno",
    name: "No Mercy",
    title: "No Mercy Uno",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "uno",
    slug: "nomercy",
    blurb:
      "168 cards of Draw 6s, Draw 10s, Skip Everyone and Color Roulette. Stack anything, draw till you can play, and hit 25 cards and you're out.",
    wants: "a game of No Mercy Uno",
    settings: NO_MERCY,
  },
} as const satisfies Record<`uno:${string}`, ModeDef>;

export function unoRules(mode: string, s: Record<string, number>): Rules {
  const noMercy = mode === "uno:nomercy";
  const on = (key: string, fallback: boolean) => (key in s ? s[key] === 1 : fallback);
  return {
    deck: noMercy ? "nomercy" : "classic",
    decks: s.decks ?? 1,
    hand: s.hand ?? 7,
    stack: noMercy ? 2 : ((s.stack ?? 0) as Stacking),
    drawUntil: noMercy || s.drawUntil === 1,
    sevenZero: on("sevenZero", noMercy),
    jumpIn: on("jumpIn", false),
    unoCall: on("unoCall", true),
    challenge: !noMercy && on("challenge", true),
    forcePlay: !noMercy && on("forcePlay", false),
    powerFinish: on("powerFinish", true),
    mercy: s.mercy ?? (noMercy ? 25 : 0),
    goal: s.goal ?? 0,
  };
}
