import { internalQuery } from "./_generated/server";
import { DEFAULT_PROFILE } from "./profileOptions";

// Read by the og/ preview service with the admin key, so none of this is public.
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
