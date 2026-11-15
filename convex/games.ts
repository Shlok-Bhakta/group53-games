import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { gameOf, type GameKey, type ModeKey } from "./modes";
import { chessHooks } from "./chess";
import { scrabbleHooks } from "./scrabble";
import { pokerHooks } from "./poker";
import { golfHooks } from "./golf";
import { landlordHooks } from "./landlord";

export type GameHooks = {
  seats: (mode: ModeKey, playerCount: number) => readonly string[];
  start: (ctx: MutationCtx, match: Doc<"matches">) => Promise<void>;
  resign: (ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">) => Promise<void>;
  timeout: (ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">) => Promise<void>;
  timeoutWarning: string;
  unstarted?: (match: Doc<"matches">) => boolean;
};

export const hooksFor = (mode: string): GameHooks => {
  const lookedUpAtCallTime: Record<GameKey, GameHooks> = {
    chess: chessHooks,
    scrabble: scrabbleHooks,
    poker: pokerHooks,
    golf: golfHooks,
    landlord: landlordHooks,
  };
  return lookedUpAtCallTime[gameOf(mode)];
};
