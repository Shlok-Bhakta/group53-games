import type { ComponentType, ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { MatchView } from "../../convex/matches";
import { GAMES, type GameKey, type ModeKey, type Settings } from "../../convex/modes";
import { Tiles } from "../Tiles";
import { ChessBanner } from "./chess/ChessBanner";
import { ChessGame } from "./chess/ChessMatch";
import { ChessModeArt } from "./chess/ModeArt";
import { chessRules } from "./chess/rules";
import { ScrabbleBanner, ScrabbleModeArt } from "./scrabble/art";
import { ScrabbleGame } from "./scrabble/ScrabbleGame";
import { scrabbleRules } from "./scrabble/rules";

// Everything the shared screens need from a game: its card on Games, its mode art, rules, and the screen
// for a game in progress. The lobby, results, rematches, mode pages and hub are shared (src/pages).
export type GameUI = {
  key: GameKey;
  path: string;
  name: string;
  blurb: string;
  banner: () => ReactNode;
  modeArt: (mode: ModeKey) => ReactNode;
  rules: (mode: ModeKey, settings: Settings) => string[];
  // A game that's started or finished, below the nav bar.
  Game: ComponentType<{ match: MatchView; meId: Id<"users"> | undefined }>;
};

export const GAME_UI: Record<GameKey, GameUI> = {
  chess: {
    key: "chess",
    path: GAMES.chess.path,
    name: GAMES.chess.name,
    blurb: "Two players or four, at your own pace or all at once in real time.",
    banner: () => <ChessBanner />,
    modeArt: (mode) => <ChessModeArt mode={mode} />,
    rules: chessRules,
    Game: ChessGame,
  },
  scrabble: {
    key: "scrabble",
    path: GAMES.scrabble.path,
    name: GAMES.scrabble.name,
    blurb: "Up to 8 of you on one board. Plan your words while you wait your turn.",
    banner: () => <ScrabbleBanner />,
    modeArt: (mode) => <ScrabbleModeArt mode={mode} />,
    rules: scrabbleRules,
    Game: ScrabbleGame,
  },
};

// Cards on the Games tab: every game, then the ones still being built.
export type GameCard = { path: string; name: string; blurb: string; banner: () => ReactNode; wip?: boolean };
const SOON: GameCard[] = [
  {
    path: "/wordle",
    name: "PvP Wordle",
    blurb: "Everyone gets the same word. Solve it, then spend what you earn messing up someone else's board.",
    banner: () => <Tiles word="WORDLE" states={["green", "yellow", "gray", "green", "hit", "green"]} flip label="PvP Wordle" />,
    wip: true,
  },
];
export const games: GameCard[] = [...Object.values(GAME_UI), ...SOON];
