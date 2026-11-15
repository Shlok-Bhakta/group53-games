import Discord from "@auth/core/providers/discord";
import { convexAuth } from "@convex-dev/auth/server";
import { devProvider } from "./devAuth";

// platform: Discord sends iss=https://discord.com on the callback, and oauth4webapi rejects it unless the provider's issuer matches.
const discord = Discord({ issuer: "https://discord.com" });

const sharpAvatar = (image: string | null | undefined) => (image?.includes("/avatars/") ? `${image}?size=256` : image);

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    {
      ...discord,
      profile: async (profile, tokens) => {
        const base = await discord.profile!(profile, tokens);
        return { ...base, id: profile.id, image: sharpAvatar(base.image), discordUsername: profile.username };
      },
    },
    devProvider,
  ],
});
