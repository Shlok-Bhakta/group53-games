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
import { GolfBanner } from "./golf/GolfBanner";
import { PokerBanner, PokerModeArt } from "./poker/art";
import { PokerGame } from "./poker/PokerGame";
import { pokerRules } from "./poker/rules";

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
  // Games that draw their own top bar and take the whole screen while they're on.
  fullscreen?: (match: MatchView) => boolean;
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
    fullscreen: (m) => m.status === "active",
  },
  poker: {
    key: "poker",
    path: GAMES.poker.path,
    name: GAMES.poker.name,
    blurb: "Hold'em, Omaha, Short Deck and draw, up to 8 of you over the day. Line up your move and it plays itself.",
    banner: () => <PokerBanner />,
    modeArt: (mode) => <PokerModeArt mode={mode} />,
    rules: pokerRules,
    Game: PokerGame,
  },
};

// Cards on the Games tab: every game, then the ones still being built.
export type GameCard = { path: string; name: string; blurb: string; banner: () => ReactNode; wip?: boolean };
// Golf is an open world everyone shares while its modes are being built: no lobby yet, Play goes
// straight in (src/games/golf/GolfWorld.tsx).
const GOLF: GameCard = {
  path: "/golf",
  name: "Golf",
  blurb: "Mini golf with everyone at once. Grab items, blow up bumpers, knock each other into the sea.",
  banner: () => <GolfBanner />,
};
const SOON: GameCard[] = [
  {
    path: "/wordle",
    name: "PvP Wordle",
    blurb: "Everyone gets the same word. Solve it, then spend what you earn messing up someone else's board.",
    banner: () => <Tiles word="WORDLE" states={["green", "yellow", "gray", "green", "hit", "green"]} flip label="PvP Wordle" />,
    wip: true,
  },
];
export const games: GameCard[] = [...Object.values(GAME_UI), GOLF, ...SOON];
