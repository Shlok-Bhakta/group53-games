import Discord from "@auth/core/providers/discord";
import { convexAuth } from "@convex-dev/auth/server";

// Discord sends iss=https://discord.com on the callback, and oauth4webapi rejects it unless the provider's issuer matches.
const discord = Discord({ issuer: "https://discord.com" });

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    {
      ...discord,
      profile: async (profile, tokens) => {
        const base = await discord.profile!(profile, tokens);
        // Ask the CDN for a larger avatar so player cards stay sharp.
        const image = base.image?.includes("/avatars/") ? `${base.image}?size=256` : base.image;
        return { ...base, id: profile.id, image, discordUsername: profile.username };
      },
    },
  ],
});
