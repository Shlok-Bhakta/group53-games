import type { TileState } from "../Tiles";

export type GameEntry = {
  path: string;
  name: string;
  blurb: string;
  tiles: { word: string; states: TileState[] };
  // Shown on the home screen but not playable yet.
  wip?: boolean;
  // Custom card art instead of letter tiles.
  art?: "chess";
};

export const games: GameEntry[] = [
  {
    path: "/chess",
    name: "Chess",
    blurb: "Two players or four, at your own pace or all at once in real time.",
    tiles: { word: "CHESS", states: ["green", "yellow", "green", "hit", "green"] },
    art: "chess",
  },
  {
    path: "/wordle",
    name: "PvP Wordle",
    blurb: "Everyone gets the same word. Solve it, then spend what you earn messing up someone else's board.",
    tiles: { word: "WORDLE", states: ["green", "yellow", "gray", "green", "hit", "green"] },
    wip: true,
  },
];
