import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { gameOf, isMode, reasonOf, type GameKey } from "./modes";
import { person } from "./lib/people";
import { DEFAULT_PROFILE } from "./profileOptions";
import { chessPreview } from "./chess/preview";
import { scrabblePreview } from "./scrabble/preview";
import { pokerPreview } from "./poker/preview";
import { golfPreview } from "./golf/preview";
import { landlordPreview } from "./landlord/preview";

export const crew = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const profiles = new Map((await ctx.db.query("profiles").collect()).map((p) => [p.userId, p]));
    return users
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((u) => {
        const p = profiles.get(u._id);
        return {
          name: u.name ?? "Player",
          image: u.image ?? null,
          frame: p?.frame ?? DEFAULT_PROFILE.frame,
          frameColor: p?.frameColor ?? DEFAULT_PROFILE.frameColor,
          badge: p?.badge ?? DEFAULT_PROFILE.badge,
        };
      });
  },
});

export type PreviewPlayer = { userId: Id<"users">; name: string; image: string | null; color: string | null };
export type PreviewBoard = (ctx: QueryCtx, m: Doc<"matches">, players: PreviewPlayer[]) => Promise<Record<string, unknown>>;

const BOARDS: Record<GameKey, PreviewBoard> = {
  chess: chessPreview,
  scrabble: scrabblePreview,
  poker: pokerPreview,
  golf: golfPreview,
  landlord: landlordPreview,
};

export const match = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const matchId = ctx.db.normalizeId("matches", id);
    if (!matchId) return null;
    const m = await ctx.db.get(matchId);
    if (!m || !isMode(m.mode)) return null;
    const players: PreviewPlayer[] = await Promise.all(
      m.players.map(async (p) => {
        const { name, image } = await person(ctx, p.userId);
        return { userId: p.userId, name, image, color: p.color ?? null };
      }),
    );
    const winners = m.result?.winners ?? [];
    return {
      mode: m.mode,
      status: m.status,
      players,
      moveCount: m.moveCount,
      ...(await BOARDS[gameOf(m.mode)](ctx, m, players)),
      result: m.result
        ? {
            draw: m.result.draw,
            reason: m.result.reason,
            how: reasonOf(m.result.reason, m.mode).won ?? "",
            winner:
              players
                .filter((p) => winners.includes(p.userId))
                .map((p) => p.name)
                .join(" and ") || null,
          }
        : null,
    };
  },
});
