import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { MODES, type GameKey, type ModeKey } from "../modes";

// Who's asking, and where they sit. Every game's moves start here.

export async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  return userId;
}

export async function loadMatch(ctx: QueryCtx, id: Id<"matches">) {
  const match = await ctx.db.get(id);
  if (!match) throw new Error("That game doesn't exist.");
  return match;
}

// Seat colors for games that only need one per player (Scrabble's tiles, poker's chips), in seat order.
export const SEAT_COLORS = ["red", "blue", "yellow", "green", "purple", "orange", "teal", "pink"] as const;

export const seatOf = (match: Doc<"matches">, userId: Id<"users">) => match.players.findIndex((p) => p.userId === userId);
export const isPlayer = (match: Doc<"matches">, userId: Id<"users">) => match.players.some((p) => p.userId === userId);
export const opponentsOf = (match: Doc<"matches">, userId: Id<"users">) => match.players.filter((p) => p.userId !== userId).map((p) => p.userId);
export const playerWith = (match: Doc<"matches">, color: string) => match.players.find((p) => p.color === color)!.userId;

type Want = {
  game: GameKey;
  // Only these modes of the game.
  modes?: readonly ModeKey[];
  // Only a game in progress (the default).
  active?: boolean;
  // Acting for this player instead of whoever's signed in (test helpers).
  as?: Id<"users">;
};

// The signed-in player's seat in a game of `game`, or an error saying why not.
export async function seated(ctx: QueryCtx, id: Id<"matches">, { game, modes, active = true, as }: Want) {
  const userId = as ?? (await requireUser(ctx));
  const match = await loadMatch(ctx, id);
  const mode = match.mode as ModeKey;
  if (MODES[mode]?.game !== game || (modes && !modes.includes(mode))) throw new Error("Wrong kind of game.");
  if (active && match.status !== "active") throw new Error("This game is over.");
  const seat = seatOf(match, userId);
  if (seat < 0) throw new Error("You're not playing in this game.");
  return { userId, match, seat, color: match.players[seat].color };
}

// The same, and it has to be their turn.
export async function onTurn(ctx: QueryCtx, id: Id<"matches">, want: Want) {
  const s = await seated(ctx, id, want);
  if (s.match.turn !== s.userId) throw new Error("It's not your turn.");
  return s;
}
