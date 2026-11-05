import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";

// Games built apart from the app and served out of file storage, one file per request, at
// /games/<game>/<build>/<path> on the site host. A folder of relative paths works as it is, and a file never
// changes under its build, so phones keep it forever. Only someone with the admin key can publish
// (scripts/publish-hosted.mjs).

// Where the live build opens, or null if there isn't one.
export const current = query({
  args: { game: v.string() },
  handler: async (ctx, { game }) => {
    const live = await ctx.db.query("hostedGames").withIndex("by_game", (q) => q.eq("game", game)).unique();
    return live ? `${process.env.CONVEX_SITE_URL}/games/${game}/${live.build}/index.html` : null;
  },
});

export const uploadUrl = internalMutation({
  args: {},
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

export const addFile = internalMutation({
  args: { game: v.string(), build: v.string(), path: v.string(), storageId: v.id("_storage"), type: v.string(), gzip: v.boolean() },
  handler: async (ctx, file) => {
    const same = await ctx.db.query("hostedFiles").withIndex("by_path", (q) => q.eq("game", file.game).eq("build", file.build).eq("path", file.path)).unique();
    if (same) {
      await ctx.storage.delete(same.storageId);
      await ctx.db.delete(same._id);
    }
    await ctx.db.insert("hostedFiles", file);
  },
});

// Makes a fully uploaded build the live one. The one before stays, for phones with it already open.
export const publish = internalMutation({
  args: { game: v.string(), build: v.string() },
  handler: async (ctx, { game, build }) => {
    const index = await ctx.db.query("hostedFiles").withIndex("by_path", (q) => q.eq("game", game).eq("build", build).eq("path", "index.html")).unique();
    if (!index) throw new Error(`Build ${build} of ${game} has no index.html`);
    const live = await ctx.db.query("hostedGames").withIndex("by_game", (q) => q.eq("game", game)).unique();
    if (live?.build === build) return;
    const previous = live?.build;
    if (live) await ctx.db.patch(live._id, { build, previous });
    else await ctx.db.insert("hostedGames", { game, build });
    for (const f of await ctx.db.query("hostedFiles").withIndex("by_path", (q) => q.eq("game", game)).collect()) {
      if (f.build === build || f.build === previous) continue;
      await ctx.storage.delete(f.storageId);
      await ctx.db.delete(f._id);
    }
  },
});

export const file = internalQuery({
  args: { game: v.string(), build: v.string(), path: v.string() },
  handler: (ctx, { game, build, path }) => ctx.db.query("hostedFiles").withIndex("by_path", (q) => q.eq("game", game).eq("build", build).eq("path", path)).unique(),
});

export const serve = httpAction(async (ctx, request) => {
  const parts = new URL(request.url).pathname.match(/^\/games\/([^/]+)\/([^/]+)\/(.+)$/);
  const found = parts && (await ctx.runQuery(internal.hosted.file, { game: parts[1], build: parts[2], path: decodeURIComponent(parts[3]) }));
  const blob = found && (await ctx.storage.get(found.storageId));
  if (!found || !blob) return new Response("Not found", { status: 404 });
  return new Response(blob, {
    headers: {
      "Content-Type": found.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ...(found.gzip ? { "Content-Encoding": "gzip" } : {}),
    },
  });
});
