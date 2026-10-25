import type { TileState } from "../Tiles";

export type GameEntry = {
  path: string;
  name: string;
  blurb: string;
  tiles: { word: string; states: TileState[] };
};

export const games: GameEntry[] = [
  {
    path: "/wordle",
    name: "PvP Wordle",
    blurb: "Everyone gets the same word. Solve it, then spend what you earn messing up someone else's board.",
    tiles: { word: "WORDLE", states: ["green", "yellow", "gray", "green", "hit", "green"] },
  },
];
