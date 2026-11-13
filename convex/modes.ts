import { POWERS } from "./golf/engine";
import { POWER_NAMES } from "./golf/names";

// Every game and every playable mode. Shared by the server and the client.
//  - async modes take turns over hours; players get a push when it's their move and a reminder every 8 hours.
//  - realtime modes need everyone on the screen at once.
// `title` is how the mode reads in a sentence ("Your 4-player chess game is on"). `players` is the most seats
// a game has; `minPlayers` is how many it needs to start. When they differ, the host starts it from the lobby
// once enough people are in (it also starts by itself when every seat fills).

// How a game ended (matches.result.reason): `label` for the result on screen, `push` to end the result push
// ("Classic chess vs Chris: checkmate."), and `won` where it reads well after a winner's name in a link
// preview ("Chris won by checkmate"). Each game lists its own; these are any game's.
export type Reason = { label: string; push: string; won?: string };
const ENDINGS: Record<string, Reason> = {
  resign: { label: "By resignation", push: "resignation", won: "by resignation" },
  timeout: { label: "Timed out", push: "timed out" },
  last_player: { label: "Last one standing", push: "last one standing", won: "as the last one standing" },
  agreement: { label: "Draw agreed", push: "draw agreed" },
};

export const GAMES = {
  chess: {
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
  },
  scrabble: {
    name: "Scrabble",
    path: "/scrabble",
    reasons: {
      went_out: { label: "Went out", push: "someone went out" },
      passes: { label: "Everyone passed twice", push: "everyone passed" },
      rounds: { label: "Last round played", push: "the last round" },
    },
  },
  poker: {
    name: "Poker",
    path: "/poker",
    reasons: { hands: { label: "Last hand played", push: "the last hand" } },
  },
  golf: {
    name: "Golf",
    path: "/golf",
    reasons: { holes: { label: "Last hole played", push: "the last hole", won: "with the fewest strokes" } },
  },
} as const satisfies Record<string, { name: string; path: string; reasons: Record<string, Reason> }>;
export type GameKey = keyof typeof GAMES;

// A choice the host makes before the game starts. Values are numbers so they compare and store simply.
// `short` says a changed value in a few words, "{}" standing for the option's label: "9 tiles".
// `kind` "seed": any whole number, 0 (the default) meaning "roll one when the game's made" (matches.create),
// so a game's seed can be copied and played again. `kind` "mask": pick any of the options (at least one),
// stored as a bit per option, `value` being the bit. `when`: only shown, and only matters, while another
// setting has one of these values (a generated course's seed).
export type Setting = {
  key: string;
  label: string;
  short: string;
  options: readonly { value: number; label: string }[];
  default: number;
  kind?: "seed" | "mask";
  when?: { key: string; is: readonly number[] };
};
export const SEED_MAX = 999_999;
export const rollSeed = () => 1 + Math.floor(Math.random() * SEED_MAX);
const maskAll = (n: number) => 2 ** n - 1;

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
  // Scrabble's official rules, or Letter League's (see convex/scrabble/engine.ts for what changes).
  { key: "rules", label: "Rules", short: "{} rules", options: [{ value: 0, label: "Scrabble" }, { value: 1, label: "Letter League" }], default: 0 },
  { key: "rounds", label: "Rounds", short: "{} rounds", options: [{ value: 0, label: "No limit" }, { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 15, label: "15" }], default: 0 },
];
// Poker: a run of hands with rising blinds, until one player has every chip (or the last hand, if there's a
// limit). Blinds start at 10/20 whatever the stack (convex/poker/engine.ts). Betting: 0 no limit, 1 pot limit.
const poker = (betting: number): Setting[] => [
  { key: "stack", label: "Chips", short: "{} chips", options: [{ value: 500, label: "500" }, { value: 1000, label: "1,000" }, { value: 2000, label: "2,000" }], default: 1000 },
  { key: "hands", label: "Hands", short: "{} hands", options: [{ value: 0, label: "No limit" }, { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 20, label: "20" }], default: 0 },
  { key: "blinds", label: "Blinds go up every", short: "Blinds up: {}", options: [{ value: 2, label: "2 hands" }, { value: 3, label: "3 hands" }, { value: 5, label: "5 hands" }, { value: 0, label: "Never" }], default: 3 },
  { key: "blindsBy", label: "Blinds multiply by", short: "Blinds {}", options: [{ value: 1.25, label: "×1.25" }, { value: 1.5, label: "×1.5" }, { value: 2, label: "×2" }, { value: 3, label: "×3" }], default: 2 },
  { key: "betting", label: "Betting", short: "{}", options: [{ value: 0, label: "No limit" }, { value: 1, label: "Pot limit" }], default: betting },
  moveTime(24),
];

// Golf (convex/golf.ts): which course, and for a generated one what it's like and its seed, then the items,
// and whether balls knock into each other. `items` is a bit per item in POWERS' order.
const GENERATED = { key: "course", is: [0] } as const;
const golf = (holes: number): Setting[] => [
  { key: "course", label: "Course", short: "{}", options: [{ value: 0, label: "Generated" }, { value: 1, label: "Bumper Plains" }, { value: 2, label: "Cold Start" }], default: 0 },
  { key: "holes", label: "Holes", short: "{} holes", options: [{ value: 3, label: "3" }, { value: 6, label: "6" }, { value: 9, label: "9" }, { value: 18, label: "18" }], default: holes },
  { key: "terrain", label: "Terrain", short: "{}", options: [{ value: 0, label: "Grass" }, { value: 1, label: "Ice" }, { value: 2, label: "Both" }], default: 0, when: GENERATED },
  { key: "style", label: "Holes like", short: "{} holes", options: [{ value: 0, label: "Mini golf" }, { value: 1, label: "Fairways" }, { value: 2, label: "Both" }], default: 2, when: GENERATED },
  { key: "hazards", label: "Hazards", short: "{} hazards", options: [{ value: 0, label: "Few" }, { value: 1, label: "Some" }, { value: 2, label: "Lots" }], default: 1, when: GENERATED },
  { key: "seed", label: "Seed", short: "Seed {}", options: [], default: 0, kind: "seed", when: GENERATED },
  { key: "boxes", label: "Item boxes", short: "{} boxes", options: [{ value: 0, label: "None" }, { value: 1, label: "Few" }, { value: 2, label: "Normal" }, { value: 3, label: "Lots" }], default: 2 },
  { key: "items", label: "Items", short: "{} items", options: POWERS.map((p, i) => ({ value: i, label: POWER_NAMES[p] })), default: 2 ** POWERS.length - 1, kind: "mask", when: { key: "boxes", is: [1, 2, 3] } },
  { key: "collide", label: "Ball hits", short: "Ball hits {}", options: [{ value: 1, label: "On" }, { value: 0, label: "Off" }], default: 1 },
  { key: "mark", label: "Safe near the cup", short: "Safe near the cup: {}", options: [{ value: 1, label: "On" }, { value: 0, label: "Off" }], default: 1, when: { key: "collide", is: [1] } },
];

// What every mode has. `draws`: players can offer each other a draw (two-player only). `wants`: how a push
// asking the crew to join reads, "<name> wants <wants>" (the title by default). `reasons`: endings that read
// differently in this mode.
type ModeDef = {
  game: GameKey;
  name: string;
  title: string;
  kind: "async" | "realtime";
  players: number;
  minPlayers: number;
  board: string;
  slug: string;
  blurb: string;
  settings: readonly Setting[];
  draws?: boolean;
  wants?: string;
  reasons?: Record<string, Reason>;
};

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
    settings: poker(0),
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
    settings: poker(1),
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
    settings: poker(0),
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
    settings: poker(0),
  },
  "golf:turns": {
    game: "golf",
    name: "Turn-based",
    title: "golf",
    kind: "async",
    players: 8,
    minPlayers: 2,
    board: "golf",
    slug: "turns",
    blurb: "One course, one shot at a time: whoever's farthest from the cup goes next. Knock each other about, and keep your items from hole to hole.",
    wants: "a round of golf",
    settings: [
      // Six holes and four hours a shot, so a round of one shot at a time fits in about a day.
      ...golf(6),
      { key: "shotTime", label: "Time to shoot", short: "{} to shoot", options: [{ value: 0, label: "No limit" }, { value: 60, label: "1 hour" }, { value: 240, label: "4 hours" }, { value: 480, label: "8 hours" }, { value: 1440, label: "1 day" }], default: 0 },
    ],
  },
  "golf:live": {
    game: "golf",
    name: "Live",
    title: "live golf",
    kind: "realtime",
    players: 8,
    minPlayers: 2,
    board: "golf",
    slug: "live",
    blurb: "Everyone on the same hole at once. Shoot whenever you like, knock each other into the water, and sink it before the hole clock runs out.",
    wants: "a live round of golf",
    settings: [
      ...golf(9),
      { key: "holeTime", label: "Hole clock", short: "{} a hole", options: [{ value: 2, label: "2 min" }, { value: 3, label: "3 min" }, { value: 5, label: "5 min" }], default: 3 },
    ],
  },
} as const satisfies Record<string, ModeDef>;

export type ModeKey = keyof typeof MODES;
export const MODE_KEYS = Object.keys(MODES) as ModeKey[];
export const isMode = (m: string): m is ModeKey => m in MODES;
// A mode with its optional fields, which `MODES[mode]` only has on the modes that set them.
export const modeDef = (mode: ModeKey): ModeDef => MODES[mode];
export function gameOf(mode: string): GameKey {
  if (!isMode(mode)) throw new Error(`Unknown mode: ${mode}`);
  return MODES[mode].game;
}
export const allowsDraws = (mode: string) => isMode(mode) && modeDef(mode).draws === true;
export const modesOf = (game: string) => MODE_KEYS.filter((k) => MODES[k].game === game);
export const modeBySlug = (game: string, slug: string) => modesOf(game).find((k) => MODES[k].slug === slug) ?? null;
export function reasonOf(reason: string, mode: string): Reason {
  const m = isMode(mode) ? modeDef(mode) : undefined;
  const game: Record<string, Reason> | undefined = m && GAMES[m.game].reasons;
  return m?.reasons?.[reason] ?? game?.[reason] ?? ENDINGS[reason] ?? { label: reason, push: reason };
}
// Fixed seat count (chess) or a range the host starts from the lobby (Scrabble).
export const flexibleSeats = (mode: string) => isMode(mode) && MODES[mode].minPlayers < MODES[mode].players;

export type Settings = Record<string, number>;

function validSetting(s: Setting, v: number | undefined): v is number {
  if (v === undefined) return false;
  if (s.kind && !Number.isInteger(v)) return false;
  if (s.kind === "seed") return v >= 0 && v <= SEED_MAX;
  if (s.kind === "mask") return v >= 1 && v <= maskAll(s.options.length);
  return s.options.some((o) => o.value === v);
}
// Whether a setting matters with the rest as they are (see `when`).
export const settingApplies = (s: Setting, value: Settings) => !s.when || s.when.is.includes(value[s.when.key] ?? NaN);
export const settingDefs = (mode: string) => (isMode(mode) ? (MODES[mode].settings as readonly Setting[]) : []);
// Every seed setting rolled where it's still 0, for a game being made. `fresh` rolls them all again (a rematch).
export function withSeeds(mode: string, raw: Settings | undefined, fresh = false): Settings {
  const out = { ...raw };
  for (const s of settingDefs(mode)) if (s.kind === "seed" && (fresh || !out[s.key])) out[s.key] = rollSeed();
  return out;
}
// Which options of a mask setting are on.
export const maskOn = (value: number, bit: number) => (Math.floor(value / 2 ** bit) & 1) === 1;

// A mode's settings with defaults filled in. Anything unknown or not one of the options falls back to the
// default, so old games and hand-made requests always read sensibly.
export function settingsOf(mode: string, raw?: Settings | null): Settings {
  if (!isMode(mode)) return {};
  const out: Settings = {};
  for (const s of MODES[mode].settings as readonly Setting[]) out[s.key] = validSetting(s, raw?.[s.key]) ? raw![s.key] : s.default;
  return out;
}
// Only the settings that differ from the defaults: what gets stored, and what a lobby calls out.
export function changedSettings(mode: string, raw?: Settings | null): Settings {
  const full = settingsOf(mode, raw);
  const defs = isMode(mode) ? (MODES[mode].settings as readonly Setting[]) : [];
  return Object.fromEntries(defs.filter((s) => full[s.key] !== s.default).map((s) => [s.key, full[s.key]]));
}
export const settingLabel = (mode: string, key: string, value: number) => {
  const s = settingDefs(mode).find((x) => x.key === key);
  if (s?.kind === "seed") return value ? String(value) : "Random";
  if (s?.kind === "mask") {
    const on = s.options.filter((o) => maskOn(value, o.value)).length;
    return on === s.options.length ? "All" : on === 1 ? s.options.find((o) => maskOn(value, o.value))!.label : `${on} of ${s.options.length}`;
  }
  return s?.options.find((o) => o.value === value)?.label ?? String(value);
};
// The changed settings in a few words each: ["21×21 board", "Letter League rules"].
// Seeds aren't a change anyone needs called out (every game rolls a new one), and settings that don't apply
// right now are left out.
export function settingsSummary(mode: string, raw?: Settings | null): string[] {
  const changed = changedSettings(mode, raw);
  const full = settingsOf(mode, raw);
  return settingDefs(mode)
    .filter((s) => s.key in changed && s.kind !== "seed" && settingApplies(s, full))
    .map((s) => s.short.replace("{}", settingLabel(mode, s.key, changed[s.key])));
}

// "Seed 4242", for a game with a seed that applies (a generated course), so everyone can see which holes.
export function seedSummary(mode: string, raw?: Settings | null): string | null {
  const full = settingsOf(mode, raw);
  const s = settingDefs(mode).find((d) => d.kind === "seed" && settingApplies(d, full) && full[d.key]);
  return s ? `Seed ${full[s.key]}` : null;
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
