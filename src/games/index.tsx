import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { MatchView } from "../../convex/matches";
import { GAMES, type GameKey, type ModeKey, type Settings } from "../../convex/modes";
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
import { DailyBanner } from "./daily/DailyBanner";
import { StonksBanner } from "./stonks/StonksBanner";
import { prefetchStonks } from "./stonks/load";
import type { ConvexReactClient } from "convex/react";
import { PokerBanner, PokerModeArt } from "./poker/art";
import { PokerGame } from "./poker/PokerGame";
import { pokerRules } from "./poker/rules";
import { LandlordBanner, LandlordModeArt } from "./landlord/art";
import { landlordRules } from "./landlord/rules";
import { landlordSummary } from "./landlord/summary";
import { HexhavenBanner, HexhavenModeArt } from "./hexhaven/art";
import { hexhavenRules } from "./hexhaven/rules";
import { hexhavenSummary } from "./hexhaven/summary";
import { WordleBanner, WordleModeArt } from "./wordle/art";
import { wordleRules } from "./wordle/rules";
import { wordleSummary } from "./wordle/summary";
import { UnoBanner, UnoModeArt } from "./uno/art";
import { unoRulesText } from "./uno/rules";
import { unoSummary } from "./uno/summary";
import { chessSummary } from "./chess/summary";
import { scrabbleSummary } from "./scrabble/summary";
import { pokerSummary } from "./poker/summary";
import { golfSummary } from "./golf/summary";
import type { GameSummary } from "./summary";

export type GameUI = {
  key: GameKey;
  path: string;
  name: string;
  blurb: string;
  banner: () => ReactNode;
  modeArt: (mode: ModeKey) => ReactNode;
  rules: (mode: ModeKey, settings: Settings) => string[];
  Game: ComponentType<GameScreenProps>;
  summary: GameSummary;
  fullscreen?: (match: MatchView) => boolean;
  extra?: () => ReactNode;
  setup?: (p: { mode: ModeKey; settings: Settings; onChange: (next: Settings) => void; editable?: boolean }) => ReactNode;
};

type GameScreenProps = { match: MatchView; meId: Id<"users"> | undefined };

function downloadedWhenOpened(load: () => Promise<{ default: ComponentType<GameScreenProps> }>) {
  const Screen = lazy(load);
  return function LazyGameScreen(props: GameScreenProps) {
    return (
      <Suspense fallback={<div className="h-[100dvh]" aria-busy="true" />}>
        <Screen {...props} />
      </Suspense>
    );
  };
}

const GolfGame = downloadedWhenOpened(() => import("./golf/GolfGame"));
const LandlordGame = downloadedWhenOpened(() => import("./landlord/LandlordGame"));
const HexhavenGame = downloadedWhenOpened(() => import("./hexhaven/HexhavenGame"));
const WordleGame = downloadedWhenOpened(() => import("./wordle/WordleGame"));
const UnoGame = downloadedWhenOpened(() => import("./uno/UnoGame"));

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
    summary: chessSummary,
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
    summary: scrabbleSummary,
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
    summary: pokerSummary,
  },
  golf: {
    key: "golf",
    path: GAMES.golf.path,
    name: GAMES.golf.name,
    blurb:
      "Up to 8 of you on handmade or generated courses. Grab items, knock each other into the water, keep what you hold for the next hole.",
    banner: () => <GolfBanner />,
    modeArt: (mode) => <GolfModeArt mode={mode} />,
    rules: golfRules,
    Game: GolfGame,
    summary: golfSummary,
    fullscreen: (m) => m.status === "active",
    extra: () => <GolfPractice />,
    setup: (p) => <GolfHoles {...p} />,
  },
  landlord: {
    key: "landlord",
    path: GAMES.landlord.path,
    name: GAMES.landlord.name,
    blurb:
      "Buy streets, build hotels, trade and bankrupt each other, 2 to 8 of you over a few days. Every official rule, the common house rules, and the speed die.",
    banner: () => <LandlordBanner />,
    modeArt: () => <LandlordModeArt />,
    rules: landlordRules,
    Game: LandlordGame,
    summary: landlordSummary,
    fullscreen: (m) => m.status === "active" || m.status === "finished",
  },
  hexhaven: {
    key: "hexhaven",
    path: GAMES.hexhaven.path,
    name: GAMES.hexhaven.name,
    blurb:
      "Settle an island of hexes, 2 to 6 of you over a few days. Roll for resources, build roads and towns, trade, rob each other with the bandit.",
    banner: () => <HexhavenBanner />,
    modeArt: () => <HexhavenModeArt />,
    rules: hexhavenRules,
    Game: HexhavenGame,
    summary: hexhavenSummary,
  },
  wordle: {
    key: "wordle",
    path: GAMES.wordle.path,
    name: GAMES.wordle.name,
    blurb: "Same word for everyone, 2 to 8 of you. Solve it, earn coins, then buy fog, jams and short fuses to throw at the others.",
    banner: () => <WordleBanner />,
    modeArt: () => <WordleModeArt />,
    rules: wordleRules,
    Game: WordleGame,
    summary: wordleSummary,
  },
  uno: {
    key: "uno",
    path: GAMES.uno.path,
    name: GAMES.uno.name,
    blurb:
      "Classic or No Mercy, 2 to 8 of you, at your own pace. Stacking, 7-0, jump-ins, challenges, double decks: every house rule is a setting.",
    banner: () => <UnoBanner />,
    modeArt: (mode) => <UnoModeArt mode={mode} />,
    rules: unoRulesText,
    Game: UnoGame,
    summary: unoSummary,
  },
};

export type GameCard = {
  path: string;
  name: string;
  blurb: string;
  banner: () => ReactNode;
  wip?: boolean;
  prefetch?: (convex: ConvexReactClient) => void;
};
const STONKS: GameCard = {
  path: "/stonks",
  name: "Stonks",
  blurb:
    "$10,000 of fake money and everything on Yahoo Finance to lose it on: stocks anywhere, crypto, forex, futures. Beat the crew, live.",
  banner: () => <StonksBanner />,
  prefetch: prefetchStonks,
};
const MEREDDIA: GameCard = {
  path: "/mereddia",
  name: "Journey Across Mereddia",
  blurb: "Chris's RPG. Wake up as Mallakoth with a sword to find and slimes in the way. It saves on your phone.",
  banner: () => <MereddiaBanner />,
};
const DAILY: GameCard = {
  path: "/daily",
  name: "Dailies",
  blurb: "Scrandle, Krillion, Connections and the rest. Paste what the game copied and see who beat who today.",
  banner: () => <DailyBanner />,
};
export const games: GameCard[] = [...Object.values(GAME_UI), STONKS, DAILY, MEREDDIA];
export { DailyStrip } from "./daily/DailyStrip";
