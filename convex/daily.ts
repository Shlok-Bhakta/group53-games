import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib/seats";
import { displayName } from "./lib/people";
import { notify } from "./notify";
import { dailyGame, dailyPath, parseShare, SHARE_MAX } from "./daily/games";
import { addDays, isDay, lastDays, plausibleToday } from "./daily/days";
import { board, ranked, roundKey } from "./daily/standings";

const HISTORY_DAYS = 30;
const WEEK_DAYS = 7;

const entry = (r: Doc<"dailyResults">) => ({
  _id: r._id,
  userId: r.userId,
  display: r.display,
  grid: r.grid ?? null,
  solved: r.solved,
  score: r.score,
  at: r.at,
});

function rounds(rows: Doc<"dailyResults">[]) {
  const byKey = new Map<string, Doc<"dailyResults">[]>();
  for (const r of rows) byKey.set(roundKey(r), [...(byKey.get(roundKey(r)) ?? []), r]);
  return [...byKey.values()].map((round) => ({
    game: round[0].game,
    day: round[0].day,
    puzzle: round[0].puzzle ?? null,
    latest: Math.max(...round.map((r) => r.at)),
    entries: ranked(round.map(entry)),
  }));
}

const since = (ctx: QueryCtx, from: string, to: string) =>
  ctx.db
    .query("dailyResults")
    .withIndex("by_day", (q) => q.gte("day", from).lte("day", to))
    .collect();

export async function postResult(ctx: MutationCtx, userId: Id<"users">, text: string, today: string) {
  const share = text.trim();
  if (share.length > SHARE_MAX) throw new Error("That's too long to be a result.");
  if (!plausibleToday(today, Date.now())) throw new Error("Your phone's date looks off.");
  const parsed = parseShare(share);
  if (!parsed) throw new Error("That isn't a result from a daily we know.");
  const game = dailyGame(parsed.game);
  const { date, ...result } = parsed;
  if (date && date !== today && date !== addDays(today, -1) && date !== addDays(today, 1))
    throw new Error(`That's ${game.name} for ${date}, not today's.`);
  const day = date ?? today;
  const mine = await ctx.db
    .query("dailyResults")
    .withIndex("by_user_game", (q) => q.eq("userId", userId).eq("game", parsed.game))
    .collect();
  const same = mine.find((r) => r.day === day);
  if (same && same.text === share) return { id: same._id, game: parsed.game, display: same.display };
  if (same) throw new Error(day === today ? `You already posted today's ${game.name}.` : `You already posted ${game.name} for ${day}.`);
  if (parsed.puzzle !== undefined && mine.some((r) => r.puzzle === parsed.puzzle))
    throw new Error(`You already posted ${game.name} #${parsed.puzzle}.`);
  const at = Date.now();
  const id = await ctx.db.insert("dailyResults", { userId, day, text: share, at, ...result });
  const rivals = (
    await ctx.db
      .query("dailyResults")
      .withIndex("by_day", (q) => q.eq("day", day))
      .collect()
  ).filter((r) => roundKey(r) === roundKey({ ...parsed, day }) && r.userId !== userId && r.score < parsed.score);
  const name = await displayName(ctx, userId);
  for (const r of rivals)
    await notify(ctx, r.userId, {
      title: `${name} beat your ${game.name}`,
      body: `${parsed.display} vs your ${r.display}`,
      url: dailyPath(parsed.game),
      tag: `daily:${parsed.game}:${day}`,
    });
  return { id, game: parsed.game, display: parsed.display };
}

export const post = mutation({
  args: { text: v.string(), day: v.string() },
  handler: async (ctx, { text, day }) => postResult(ctx, await requireUser(ctx), text, day),
});

export const remove = mutation({
  args: { id: v.id("dailyResults") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("That's someone else's result.");
    await ctx.db.delete(id);
  },
});

export const today = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    if ((await getAuthUserId(ctx)) === null || !isDay(day)) return [];
    const rows = await ctx.db
      .query("dailyResults")
      .withIndex("by_day", (q) => q.eq("day", day))
      .collect();
    return rounds(rows).sort((a, b) => b.latest - a.latest);
  },
});

export const week = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    if ((await getAuthUserId(ctx)) === null || !isDay(day)) return [];
    const rows = await since(ctx, addDays(day, -(HISTORY_DAYS - 1)), day);
    return board(rows, day, addDays(day, -(WEEK_DAYS - 1)));
  },
});

export const history = query({
  args: { game: v.string(), day: v.string() },
  handler: async (ctx, { game, day }) => {
    if ((await getAuthUserId(ctx)) === null || !isDay(day)) return null;
    const days = lastDays(day, HISTORY_DAYS);
    const rows = (await since(ctx, days.at(-1)!, day)).filter((r) => r.game === game);
    return {
      board: board(rows, day, days.at(-1)!),
      days: rounds(rows).sort((a, b) => (a.day < b.day ? 1 : -1)),
    };
  },
});
