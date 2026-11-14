import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
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
import { GolfModeArt } from "./golf/ModeArt";
import { GolfPractice } from "./golf/Practice";
import { GolfHoles } from "./golf/HolesPreview";
import { golfRules } from "./golf/rules";
import { MereddiaBanner } from "./mereddia/card";
import { StonksBanner } from "./stonks/StonksBanner";
import { prefetchStonks } from "./stonks/load";
import type { ConvexReactClient } from "convex/react";
import { PokerBanner, PokerModeArt } from "./poker/art";
import { PokerGame } from "./poker/PokerGame";
import { pokerRules } from "./poker/rules";
import { LandlordBanner, LandlordModeArt } from "./landlord/art";
import { landlordRules } from "./landlord/rules";

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
  // Games that draw their own top bar and take the whole screen: asked of any game that's started or finished
  // (most say only while it's on; Landlord keeps its board up for the result too).
  fullscreen?: (match: MatchView) => boolean;
  // More on the game's page, under the modes (golf's practice holes).
  extra?: () => ReactNode;
  // At the bottom of a mode page, with the settings for the next game: golf's holes for those settings.
  // In a lobby too, where only the host can change them (`editable`).
  setup?: (p: { mode: ModeKey; settings: Settings; onChange: (next: Settings) => void; editable?: boolean }) => ReactNode;
};

// Golf's screen is big (the physics, the drawing, the sound), so it's only downloaded once a game's opened.
const GolfScreen = lazy(() => import("./golf/GolfGame"));
function GolfGame(props: { match: MatchView; meId: Id<"users"> | undefined }) {
  return (
    <Suspense fallback={<div className="h-[100dvh]" aria-busy="true" />}>
      <GolfScreen {...props} />
    </Suspense>
  );
}

// Landlord's board, camera and show only download once a game's opened, like golf's.
const LandlordScreen = lazy(() => import("./landlord/LandlordGame"));
function LandlordGame(props: { match: MatchView; meId: Id<"users"> | undefined }) {
  return (
    <Suspense fallback={<div className="h-[100dvh]" aria-busy="true" />}>
      <LandlordScreen {...props} />
    </Suspense>
  );
}

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
  golf: {
    key: "golf",
    path: GAMES.golf.path,
    name: GAMES.golf.name,
    blurb: "Up to 8 of you on handmade or generated courses. Grab items, knock each other into the water, keep what you hold for the next hole.",
    banner: () => <GolfBanner />,
    modeArt: (mode) => <GolfModeArt mode={mode} />,
    rules: golfRules,
    Game: GolfGame,
    fullscreen: (m) => m.status === "active",
    extra: () => <GolfPractice />,
    setup: (p) => <GolfHoles {...p} />,
  },
  landlord: {
    key: "landlord",
    path: GAMES.landlord.path,
    name: GAMES.landlord.name,
    blurb: "Buy streets, build hotels, trade and bankrupt each other, 2 to 8 of you over a few days. Every official rule, the common house rules, and the speed die.",
    banner: () => <LandlordBanner />,
    modeArt: () => <LandlordModeArt />,
    rules: landlordRules,
    Game: LandlordGame,
    fullscreen: (m) => m.status === "active" || m.status === "finished",
  },
};

// Cards on the Games tab: every game, then the ones still being built.
export type GameCard = {
  path: string;
  name: string;
  blurb: string;
  banner: () => ReactNode;
  wip?: boolean;
  // Called when the card is on screen and when Play is touched: start loading what Play opens.
  prefetch?: (convex: ConvexReactClient) => void;
};
// Stonks: the S&P 500's biggest companies, live, ranked by their share of the index. No lobby yet either;
// Play opens the board (src/games/stonks/Stonks.tsx).
const STONKS: GameCard = {
  path: "/stonks",
  name: "Stonks",
  blurb: "$10,000 of fake money and everything on Yahoo Finance to lose it on: stocks anywhere, crypto, forex, futures. Beat the crew, live.",
  banner: () => <StonksBanner />,
  prefetch: prefetchStonks,
};
// Journey Across Mereddia: Chris's single-player RPG. It isn't in this bundle: Play opens a separate build in an
// iframe (HostedGame.tsx), which downloads only then.
const MEREDDIA: GameCard = {
  path: "/mereddia",
  name: "Journey Across Mereddia",
  blurb: "Chris's RPG. Wake up as Mallakoth with a sword to find and slimes in the way. It saves on your phone.",
  banner: () => <MereddiaBanner />,
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
export const games: GameCard[] = [...Object.values(GAME_UI), STONKS, MEREDDIA, ...SOON];
