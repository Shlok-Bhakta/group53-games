// Every playable mode. Shared by the server and the client.
//  - async modes take turns over hours; players get a push when it's their move and a reminder every 8 hours.
//  - realtime modes need everyone on the screen at once.
// `title` is how the mode reads in a sentence ("Your 4-player chess game is on"), `board` which engine it uses.
export const MODES = {
  "chess:classic": {
    game: "chess",
    name: "Classic",
    title: "classic chess",
    kind: "async",
    players: 2,
    board: "two",
    slug: "classic",
    blurb: "Take turns at your own pace. We ping you when it's your move.",
  },
  "chess:four": {
    game: "chess",
    name: "4-Player",
    title: "4-player chess",
    kind: "async",
    players: 4,
    board: "four",
    slug: "four",
    blurb: "Free-for-all on a cross-shaped board. Take turns clockwise, score points for captures and checks. Most points wins.",
  },
  "chess:realtime": {
    game: "chess",
    name: "Real-time",
    title: "real-time chess",
    kind: "realtime",
    players: 2,
    board: "two",
    slug: "realtime",
    blurb: "No turns. Move any piece any time, then it cools down for 5 seconds. Take the king to win.",
  },
  "chess:realtime4": {
    game: "chess",
    name: "Real-time 4-Player",
    title: "4-player real-time chess",
    kind: "realtime",
    players: 4,
    board: "four",
    slug: "realtime4",
    blurb: "Four armies, no turns, everyone at once. Lose your king and your army turns to stone. Last king standing wins.",
  },
} as const;

export type ModeKey = keyof typeof MODES;
export const MODE_KEYS = Object.keys(MODES) as ModeKey[];
export const isMode = (m: string): m is ModeKey => m in MODES;
export const modeBySlug = (slug: string) => MODE_KEYS.find((k) => MODES[k].slug === slug) ?? null;
export const isFour = (mode: string) => isMode(mode) && MODES[mode].board === "four";

export const REMINDER_MS = 8 * 60 * 60 * 1000;
// Real-time lobbies close if nobody joins within this window.
export const REALTIME_LOBBY_MS = 10 * 60 * 1000;
// Countdown between both players being on the board and the first tick.
export const REALTIME_COUNTDOWN_MS = 3000;
export const START_RATING = 1200;

export const matchPath = (id: string) => `/chess/${id}`;
// Opening this link joins the game if you're invited or there's a free seat.
export const acceptPath = (id: string) => `/chess/${id}?accept=1`;
export const modePath = (mode: ModeKey) => `/chess/mode/${MODES[mode].slug}`;
