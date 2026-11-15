import { moveTime, type GameDef, type ModeDef, type Setting } from "../modeKit";

export const CHESS_GAME = {
  name: "Chess",
  path: "/chess",
  reasons: {
    checkmate: { label: "Checkmate", push: "checkmate", won: "by checkmate" },
    stalemate: { label: "Stalemate", push: "stalemate" },
    repetition: { label: "Threefold repetition", push: "threefold repetition" },
    insufficient: { label: "Insufficient material", push: "insufficient material" },
    fifty: { label: "Fifty-move rule", push: "fifty-move rule" },
    king: { label: "King captured", push: "king captured", won: "by taking the king" },
    both_kings: { label: "Both kings fell at once", push: "both kings fell at once" },
    no_progress: { label: "90 seconds with no captures or pawn moves", push: "90 seconds with no captures or pawn moves" },
    last_king: { label: "Last king standing", push: "last king standing", won: "as the last king standing" },
  },
} as const satisfies GameDef;

const REALTIME_CHESS: Setting[] = [
  {
    key: "cooldown",
    label: "Cooldown",
    short: "{} cooldown",
    options: [
      { value: 2, label: "2s" },
      { value: 3, label: "3s" },
      { value: 5, label: "5s" },
      { value: 10, label: "10s" },
    ],
    default: 5,
  },
  {
    key: "speed",
    label: "Piece speed",
    short: "{} pieces",
    options: [
      { value: 45, label: "Slow" },
      { value: 30, label: "Normal" },
      { value: 15, label: "Fast" },
    ],
    default: 30,
  },
];

export const CHESS_MODES = {
  "chess:classic": {
    game: "chess",
    name: "Classic",
    title: "classic chess",
    kind: "async",
    players: 2,
    minPlayers: 2,
    board: "two",
    slug: "classic",
    blurb: "Take turns at your own pace. We ping you when it's your move.",
    draws: true,
    wants: "a game of chess",
    settings: [moveTime(0)],
  },
  "chess:four": {
    game: "chess",
    name: "4-Player",
    title: "4-player chess",
    kind: "async",
    players: 4,
    minPlayers: 4,
    board: "four",
    slug: "four",
    blurb: "Free-for-all on a cross-shaped board. Take turns clockwise, score points for captures and checks. Most points wins.",
    settings: [moveTime(48, false)],
    reasons: { fifty: { label: "Fifty quiet rounds", push: "fifty quiet rounds" } },
  },
  "chess:realtime": {
    game: "chess",
    name: "Real-time",
    title: "real-time chess",
    kind: "realtime",
    players: 2,
    minPlayers: 2,
    board: "two",
    slug: "realtime",
    blurb: "No turns. Move any piece any time, then it cools down for 5 seconds. Take the king to win.",
    draws: true,
    settings: REALTIME_CHESS,
  },
  "chess:realtime4": {
    game: "chess",
    name: "Real-time 4-Player",
    title: "4-player real-time chess",
    kind: "realtime",
    players: 4,
    minPlayers: 4,
    board: "four",
    slug: "realtime4",
    blurb: "Four armies, no turns, everyone at once. Lose your king and your army turns to stone. Last king standing wins.",
    settings: REALTIME_CHESS,
  },
} as const satisfies Record<`chess:${string}`, ModeDef>;
