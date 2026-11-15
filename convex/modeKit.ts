import type { GameKey } from "./modes";

export type Reason = { label: string; push: string; won?: string };

export type GameDef = { name: string; path: string; reasons: Record<string, Reason> };

export type SettingKind = "seed" | "mask";

export type Setting = {
  key: string;
  label: string;
  short: string;
  options: readonly { value: number; label: string }[];
  default: number;
  kind?: SettingKind;
  when?: { key: string; is: readonly number[] };
};

export type ModeDef = {
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

export const everyOptionOn = (optionCount: number) => 2 ** optionCount - 1;

export const moveTime = (defaultHours: number, allowNoLimit = true): Setting => ({
  key: "moveTime",
  label: "Time to move",
  short: "{} to move",
  options: [
    ...(allowNoLimit ? [{ value: 0, label: "No limit" }] : []),
    { value: 24, label: "1 day" },
    { value: 48, label: "2 days" },
    { value: 72, label: "3 days" },
  ],
  default: defaultHours,
});
