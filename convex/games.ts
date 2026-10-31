import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { gameOf, type ModeKey } from "./modes";
import { chessHooks } from "./chess";
import { scrabbleHooks } from "./scrabble";
import { pokerHooks } from "./poker";

// What convex/matches.ts needs from each game. Everything else (lobbies, challenges, seats, results,
// ratings, rematches, reminders) is shared. A new game writes these and adds its modes to convex/modes.ts.
export type GameHooks = {
  // Seat names in turn order for a game of `n` players: chess colors, Scrabble tile colors.
  seats: (mode: ModeKey, n: number) => readonly string[];
  // Every seat is filled and colored: set up `state`, whose turn it is, and the first pushes.
  start: (ctx: MutationCtx, match: Doc<"matches">) => Promise<void>;
  // A player gives up an active game.
  resign: (ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">) => Promise<void>;
  // An async game's move timer ran out on the player to move.
  timeout: (ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">) => Promise<void>;
  // How the last reminder ends: "Move in the next 8 hours or ...".
  timeoutWarning: string;
};

// Looked up when called, not when this module loads: the game files import matches.ts, which
// imports this, so the hooks may not exist yet at load time.
export const hooksFor = (mode: string): GameHooks => ({ chess: chessHooks, scrabble: scrabbleHooks, poker: pokerHooks })[gameOf(mode)];
