import { CHESS_GAME, CHESS_MODES } from "./chess/modes";
import { GOLF_GAME, GOLF_MODES } from "./golf/modes";
import { HEXHAVEN_GAME, HEXHAVEN_MODES } from "./hexhaven/modes";
import { LANDLORD_GAME, LANDLORD_MODES } from "./landlord/modes";
import { everyOptionOn, type GameDef, type ModeDef, type Reason, type Setting } from "./modeKit";
import { POKER_GAME, POKER_MODES } from "./poker/modes";
import { SCRABBLE_GAME, SCRABBLE_MODES } from "./scrabble/modes";

export type { ModeDef, Reason, Setting } from "./modeKit";

const SHARED_ENDINGS: Record<string, Reason> = {
  resign: { label: "By resignation", push: "resignation", won: "by resignation" },
  timeout: { label: "Timed out", push: "timed out" },
  last_player: { label: "Last one standing", push: "last one standing", won: "as the last one standing" },
  agreement: { label: "Draw agreed", push: "draw agreed" },
};

export const GAMES = {
  chess: CHESS_GAME,
  scrabble: SCRABBLE_GAME,
  poker: POKER_GAME,
  golf: GOLF_GAME,
  landlord: LANDLORD_GAME,
  hexhaven: HEXHAVEN_GAME,
} as const satisfies Record<string, GameDef>;
export type GameKey = keyof typeof GAMES;

export const SEED_MAX = 999_999;
export const rollSeed = () => 1 + Math.floor(Math.random() * SEED_MAX);

export const MODES = {
  ...CHESS_MODES,
  ...SCRABBLE_MODES,
  ...POKER_MODES,
  ...GOLF_MODES,
  ...LANDLORD_MODES,
  ...HEXHAVEN_MODES,
} as const satisfies Record<string, ModeDef>;

export type ModeKey = keyof typeof MODES;
export const MODE_KEYS = Object.keys(MODES) as ModeKey[];
export const isMode = (m: string): m is ModeKey => m in MODES;
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
  return m?.reasons?.[reason] ?? game?.[reason] ?? SHARED_ENDINGS[reason] ?? { label: reason, push: reason };
}
export const flexibleSeats = (mode: string) => isMode(mode) && MODES[mode].minPlayers < MODES[mode].players;

export type Settings = Record<string, number>;

function validSetting(s: Setting, v: number | undefined): v is number {
  if (v === undefined) return false;
  if (s.kind && !Number.isInteger(v)) return false;
  if (s.kind === "seed") return v >= 0 && v <= SEED_MAX;
  if (s.kind === "mask") return v >= 1 && v <= everyOptionOn(s.options.length);
  return s.options.some((o) => o.value === v);
}
export const settingApplies = (s: Setting, value: Settings) => !s.when || s.when.is.includes(value[s.when.key] ?? NaN);
export const settingDefs = (mode: string) => (isMode(mode) ? (MODES[mode].settings as readonly Setting[]) : []);
export function withSeeds(mode: string, raw: Settings | undefined, rerollAll = false): Settings {
  const out = { ...raw };
  for (const s of settingDefs(mode)) if (s.kind === "seed" && (rerollAll || !out[s.key])) out[s.key] = rollSeed();
  return out;
}
export const maskOn = (value: number, bit: number) => (Math.floor(value / 2 ** bit) & 1) === 1;

export function settingsOf(mode: string, raw?: Settings | null): Settings {
  if (!isMode(mode)) return {};
  const out: Settings = {};
  for (const s of MODES[mode].settings as readonly Setting[]) out[s.key] = validSetting(s, raw?.[s.key]) ? raw![s.key] : s.default;
  return out;
}
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
    return on === s.options.length
      ? "All"
      : on === 1
        ? s.options.find((o) => maskOn(value, o.value))!.label
        : `${on} of ${s.options.length}`;
  }
  return s?.options.find((o) => o.value === value)?.label ?? String(value);
};
export function settingsSummary(mode: string, raw?: Settings | null): string[] {
  const changed = changedSettings(mode, raw);
  const full = settingsOf(mode, raw);
  return settingDefs(mode)
    .filter((s) => s.key in changed && s.kind !== "seed" && settingApplies(s, full))
    .map((s) => s.short.replace("{}", settingLabel(mode, s.key, changed[s.key])));
}

export function seedSummary(mode: string, raw?: Settings | null): string | null {
  const full = settingsOf(mode, raw);
  const s = settingDefs(mode).find((d) => d.kind === "seed" && settingApplies(d, full) && full[d.key]);
  return s ? `Seed ${full[s.key]}` : null;
}

export const REMINDER_MS = 8 * 60 * 60 * 1000;
export const REALTIME_LOBBY_MS = 10 * 60 * 1000;
export const REALTIME_COUNTDOWN_MS = 3000;
export const START_RATING = 1200;

const legacyGamePaths = new Map([
  ["/hexhaven", GAMES.hexhaven.path],
  ["/landlord", GAMES.landlord.path],
]);

const replaceGamePath = (pathname: string, paths: ReadonlyMap<string, string>) => {
  const prefix = `/${pathname.split("/", 2)[1]}`;
  const replacement = paths.get(prefix.toLowerCase());
  return replacement ? replacement + pathname.slice(prefix.length) : pathname;
};

const pushGamePaths = new Map(Array.from(legacyGamePaths, ([legacy, canonical]) => [canonical, legacy] as const));

export const canonicalGamePath = (pathname: string) => replaceGamePath(pathname, legacyGamePaths);
export const pushGamePath = (pathname: string) => replaceGamePath(pathname, pushGamePaths);

type MatchRef = { _id: string; mode: string };
export const matchPath = (m: MatchRef) => `${GAMES[gameOf(m.mode)].path}/${m._id}`;
export const acceptPath = (m: MatchRef) => `${matchPath(m)}?accept=1`;
export const modePath = (mode: ModeKey) => `${GAMES[MODES[mode].game].path}/mode/${MODES[mode].slug}`;
