// Every game and every playable mode. Shared by the server and the client.
//  - async modes take turns over hours; players get a push when it's their move and a reminder every 8 hours.
//  - realtime modes need everyone on the screen at once.
// `title` is how the mode reads in a sentence ("Your 4-player chess game is on"). `players` is the most seats
// a game has; `minPlayers` is how many it needs to start. When they differ, the host starts it from the lobby
// once enough people are in (it also starts by itself when every seat fills).

export const GAMES = {
  chess: { name: "Chess", path: "/chess" },
  scrabble: { name: "Scrabble", path: "/scrabble" },
} as const;
export type GameKey = keyof typeof GAMES;
export const GAME_KEYS = Object.keys(GAMES) as GameKey[];

// A choice the host makes before the game starts. Values are numbers so they compare and store simply.
// `short` says a changed value in a few words, "{}" standing for the option's label: "9 tiles".
export type Setting = { key: string; label: string; short: string; options: readonly { value: number; label: string }[]; default: number };

// Async move timers: after this long on one move the game moves on without you (see matches.remind).
const moveTime = (def: number, none = true): Setting => ({
  key: "moveTime",
  label: "Time to move",
  short: "{} to move",
  options: [...(none ? [{ value: 0, label: "No limit" }] : []), { value: 24, label: "1 day" }, { value: 48, label: "2 days" }, { value: 72, label: "3 days" }],
  default: def,
});
const REALTIME_CHESS: Setting[] = [
  { key: "cooldown", label: "Cooldown", short: "{} cooldown", options: [{ value: 2, label: "2s" }, { value: 3, label: "3s" }, { value: 5, label: "5s" }, { value: 10, label: "10s" }], default: 5 },
  { key: "speed", label: "Piece speed", short: "{} pieces", options: [{ value: 45, label: "Slow" }, { value: 30, label: "Normal" }, { value: 15, label: "Fast" }], default: 30 },
];
const SCRABBLE: Setting[] = [
  { key: "rack", label: "Tiles in hand", short: "{} tiles", options: [{ value: 5, label: "5" }, { value: 7, label: "7" }, { value: 9, label: "9" }], default: 7 },
  { key: "bag", label: "Tiles in the bag", short: "{} bag", options: [{ value: 50, label: "Half" }, { value: 100, label: "100" }, { value: 150, label: "150" }, { value: 200, label: "200" }], default: 100 },
  { key: "board", label: "Board", short: "{} board", options: [{ value: 15, label: "15×15" }, { value: 21, label: "21×21" }], default: 15 },
  { key: "wild", label: "Bonus squares", short: "{} bonuses", options: [{ value: 0, label: "Classic" }, { value: 1, label: "Wild" }], default: 0 },
  { key: "rounds", label: "Rounds", short: "{} rounds", options: [{ value: 0, label: "No limit" }, { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 15, label: "15" }], default: 0 },
];

export const MODES = {
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
      { key: "turnTime", label: "Turn timer", short: "{} turns", options: [{ value: 30, label: "30s" }, { value: 60, label: "1m" }, { value: 90, label: "90s" }, { value: 120, label: "2m" }, { value: 180, label: "3m" }], default: 90 },
    ],
  },
} as const satisfies Record<string, { game: GameKey; players: number; minPlayers: number; settings: readonly Setting[]; [k: string]: unknown }>;

export type ModeKey = keyof typeof MODES;
export const MODE_KEYS = Object.keys(MODES) as ModeKey[];
export const isMode = (m: string): m is ModeKey => m in MODES;
export const gameOf = (mode: string): GameKey => (isMode(mode) ? MODES[mode].game : "chess");
export const modesOf = (game: string) => MODE_KEYS.filter((k) => MODES[k].game === game);
export const modeBySlug = (game: string, slug: string) => modesOf(game).find((k) => MODES[k].slug === slug) ?? null;
export const isFour = (mode: string) => isMode(mode) && MODES[mode].board === "four";
// Fixed seat count (chess) or a range the host starts from the lobby (Scrabble).
export const flexibleSeats = (mode: string) => isMode(mode) && MODES[mode].minPlayers < MODES[mode].players;

export type Settings = Record<string, number>;

// A mode's settings with defaults filled in. Anything unknown or not one of the options falls back to the
// default, so old games and hand-made requests always read sensibly.
export function settingsOf(mode: string, raw?: Settings | null): Settings {
  if (!isMode(mode)) return {};
  const out: Settings = {};
  for (const s of MODES[mode].settings as readonly Setting[]) {
    const v = raw?.[s.key];
    out[s.key] = v !== undefined && s.options.some((o) => o.value === v) ? v : s.default;
  }
  return out;
}
// Only the settings that differ from the defaults: what gets stored, and what a lobby calls out.
export function changedSettings(mode: string, raw?: Settings | null): Settings {
  const full = settingsOf(mode, raw);
  const defs = isMode(mode) ? (MODES[mode].settings as readonly Setting[]) : [];
  return Object.fromEntries(defs.filter((s) => full[s.key] !== s.default).map((s) => [s.key, full[s.key]]));
}
export const settingLabel = (mode: string, key: string, value: number) => {
  const s = isMode(mode) ? (MODES[mode].settings as readonly Setting[]).find((x) => x.key === key) : undefined;
  return s?.options.find((o) => o.value === value)?.label ?? String(value);
};
// The changed settings in a few words each: ["21×21 board", "Wild bonuses"].
export function settingsSummary(mode: string, raw?: Settings | null): string[] {
  const changed = changedSettings(mode, raw);
  const defs = isMode(mode) ? (MODES[mode].settings as readonly Setting[]) : [];
  return defs.filter((s) => s.key in changed).map((s) => s.short.replace("{}", settingLabel(mode, s.key, changed[s.key])));
}

export const REMINDER_MS = 8 * 60 * 60 * 1000;
// Real-time lobbies close if nobody joins within this window.
export const REALTIME_LOBBY_MS = 10 * 60 * 1000;
// Countdown between both players being on the board and the first tick.
export const REALTIME_COUNTDOWN_MS = 3000;
export const START_RATING = 1200;

type MatchRef = { _id: string; mode: string };
export const matchPath = (m: MatchRef) => `${GAMES[gameOf(m.mode)].path}/${m._id}`;
// Opening this link joins the game if you're invited or there's a free seat.
export const acceptPath = (m: MatchRef) => `${matchPath(m)}?accept=1`;
export const modePath = (mode: ModeKey) => `${GAMES[MODES[mode].game].path}/mode/${MODES[mode].slug}`;
