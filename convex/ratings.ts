import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { START_RATING } from "./modes";

const K = 32;

async function row(ctx: MutationCtx, userId: Id<"users">, mode: string) {
  const existing = await ctx.db
    .query("ratings")
    .withIndex("by_user_mode", (q) => q.eq("userId", userId).eq("mode", mode))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("ratings", { userId, mode, rating: START_RATING, games: 0, wins: 0, losses: 0, draws: 0 });
  return (await ctx.db.get(id))!;
}

// Two-player Elo. `score` is 1 for a win by `a`, 0 for a loss, 0.5 for a draw.
export function elo(a: number, b: number, score: number) {
  const expected = 1 / (1 + 10 ** ((b - a) / 400));
  return Math.round(K * (score - expected));
}

// Places best first, ties sharing a place. Two-player results are a win/loss or a draw.
export function placesOf(match: Doc<"matches">): Id<"users">[][] {
  const r = match.result!;
  if (r.standings) return r.standings;
  const ids = match.players.map((p) => p.userId);
  if (r.draw) return [ids];
  return [r.winners, ids.filter((id) => !r.winners.includes(id))];
}

// Multiplayer Elo: every pair of players is a game between them (the better place wins, the same place
// draws), each pair weighted K/(n-1) so a four-player game moves ratings about as much as a two-player one.
export function multiElo(ratings: number[], place: number[]) {
  const n = ratings.length;
  return ratings.map((ra, i) => {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const score = place[i] < place[j] ? 1 : place[i] > place[j] ? 0 : 0.5;
      sum += score - 1 / (1 + 10 ** ((ratings[j] - ra) / 400));
    }
    return Math.round((K / (n - 1)) * sum);
  });
}

export async function recordResult(ctx: MutationCtx, match: Doc<"matches">) {
  if (!match.result || match.players.length < 2) return [];
  const places = placesOf(match);
  const placeOf = (id: Id<"users">) => places.findIndex((g) => g.includes(id));
  const rows = await Promise.all(match.players.map((p) => row(ctx, p.userId, match.mode)));
  const place = match.players.map((p) => placeOf(p.userId));
  const deltas = multiElo(rows.map((r) => r.rating), place);
  return Promise.all(
    match.players.map(async (p, i) => {
      const r = rows[i];
      // A win is first place alone; sharing first is a draw.
      const outcome = place[i] === 0 ? (places[0].length === 1 ? "win" : "draw") : "loss";
      await ctx.db.patch(r._id, {
        rating: r.rating + deltas[i],
        games: r.games + 1,
        wins: r.wins + (outcome === "win" ? 1 : 0),
        losses: r.losses + (outcome === "loss" ? 1 : 0),
        draws: r.draws + (outcome === "draw" ? 1 : 0),
      });
      return { userId: p.userId, before: r.rating, after: r.rating + deltas[i] };
    }),
  );
}

// Everyone in the crew, ranked. Players who haven't played the mode sit at the bottom, unranked.
export const leaderboard = query({
  args: { mode: v.string() },
  handler: async (ctx, { mode }) => {
    if ((await getAuthUserId(ctx)) === null) return [];
    const ratings = new Map((await ctx.db.query("ratings").withIndex("by_mode", (q) => q.eq("mode", mode)).collect()).map((r) => [r.userId, r]));
    const users = await ctx.db.query("users").collect();
    return users
      .map((u) => {
        const r = ratings.get(u._id);
        return {
          userId: u._id,
          rating: r?.rating ?? START_RATING,
          games: r?.games ?? 0,
          wins: r?.wins ?? 0,
          losses: r?.losses ?? 0,
          draws: r?.draws ?? 0,
        };
      })
      .sort((a, b) => Number(b.games > 0) - Number(a.games > 0) || b.rating - a.rating || b.wins - a.wins);
  },
});

// My rating in every mode I've played, for the mode picker.
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return {};
    const rows = await ctx.db.query("ratings").collect();
    return Object.fromEntries(rows.filter((r) => r.userId === userId).map((r) => [r.mode, { rating: r.rating, games: r.games }]));
  },
});
