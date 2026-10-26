import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { GAMES, MODES, acceptPath, matchPath, type ModeKey } from "./modes";
import { notify } from "./notify";

// Game links shared in Discord open in a browser, not in the installed app: iOS can't open a home screen
// web app from a link at all, and Android only sometimes can. A browser there isn't signed in either, so
// the link page asks who you are and sends the game to your phone as a push. Tapping it opens the app
// right in the game. Both of these work signed out on purpose; they only reveal what a link preview in
// Discord already shows (who's playing, and the crew's names and pictures).

const HANDOFF_EVERY_MS = 15_000;

async function matchFromPath(ctx: QueryCtx, path: string) {
  const m = path.match(/^\/([a-z]+)\/([a-z0-9]+)(?:\?.*)?$/);
  if (!m || !Object.values(GAMES).some((g) => g.path === `/${m[1]}`)) return null;
  const id = ctx.db.normalizeId("matches", m[2]);
  if (!id) return null;
  const match = await ctx.db.get(id);
  // The link's game has to be the match's game.
  const mode = match ? MODES[match.mode as ModeKey] : undefined;
  return match && mode && GAMES[mode.game].path === `/${m[1]}` ? match : null;
}

const person = async (ctx: QueryCtx, userId: Id<"users">) => {
  const u = await ctx.db.get(userId);
  return { _id: userId, name: u?.name ?? "Player", image: u?.image ?? null };
};

// What the link is for, and the crew to pick yourself from.
export const preview = query({
  args: { path: v.string() },
  handler: async (ctx, { path }) => {
    const match = await matchFromPath(ctx, path);
    if (!match) return null;
    const mode = MODES[match.mode as ModeKey];
    const players = await Promise.all(match.players.map((p) => person(ctx, p.userId)));
    const users = await ctx.db.query("users").collect();
    const subscribed = new Set((await ctx.db.query("pushSubscriptions").collect()).map((s) => s.userId));
    return {
      game: GAMES[mode.game].name,
      mode: mode.name,
      title: mode.title,
      status: match.status,
      host: players.find((p) => p._id === match.createdBy)?.name ?? players[0]?.name ?? "Someone",
      players,
      crew: users.sort((a, b) => a._creationTime - b._creationTime).map((u) => ({ _id: u._id, name: u.name ?? "Player", image: u.image ?? null, canPush: subscribed.has(u._id) })),
    };
  },
});

// "This is me": push the game to that player's phone.
export const handoff = mutation({
  args: { path: v.string(), userId: v.id("users") },
  handler: async (ctx, { path, userId }): Promise<"sent" | "no-push" | "wait"> => {
    const match = await matchFromPath(ctx, path);
    if (!match) throw new Error("That game doesn't exist.");
    if (!(await ctx.db.get(userId))) throw new Error("That player doesn't exist.");
    const subs = await ctx.db.query("pushSubscriptions").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    if (!subs) return "no-push";
    const now = Date.now();
    const last = (await ctx.db.query("handoffs").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).sort((a, b) => b.at - a.at)[0];
    if (last && now - last.at < HANDOFF_EVERY_MS) return "wait";
    await ctx.db.insert("handoffs", { userId, matchId: match._id, at: now });
    const mode = MODES[match.mode as ModeKey];
    const host = (await ctx.db.get(match.createdBy))?.name ?? "Someone";
    const isPlayer = match.players.some((p) => p.userId === userId);
    await notify(ctx, userId, {
      title: match.status === "waiting" && !isPlayer ? `Join ${host}'s game` : "Your game link",
      body: `${mode.title[0].toUpperCase()}${mode.title.slice(1)}. Tap to open it in Group 53.`,
      url: match.status === "waiting" && !isPlayer ? acceptPath(match) : matchPath(match),
      tag: `match:${match._id}`,
    });
    return "sent";
  },
});
