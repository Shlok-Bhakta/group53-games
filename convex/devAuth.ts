// Sign-in without Discord, for running the app locally with dekit (scripts/dev.mjs turns it on).
// It needs DEV_AUTH=1 and a site on this machine, so it can't work on kiwi even if the variable gets set there.
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { createAccount } from "@convex-dev/auth/server";
import type { GenericActionCtx } from "convex/server";
import { internalAction } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import { DEV_CREW } from "./devCrew";

const LOCAL_SITE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

function devAuthOn() {
  return process.env.DEV_AUTH === "1" && LOCAL_SITE.test(process.env.CONVEX_SITE_URL ?? "");
}

// Returns the account if it's there already.
async function crewAccount(ctx: GenericActionCtx<DataModel>, name: string) {
  const { user } = await createAccount(ctx, {
    provider: "dev",
    account: { id: name },
    profile: { name, discordUsername: name.toLowerCase() },
  });
  return user._id;
}

export const devProvider = ConvexCredentials<DataModel>({
  id: "dev",
  authorize: async ({ name }, ctx) => {
    if (!devAuthOn() || typeof name !== "string" || !DEV_CREW.includes(name)) return null;
    return { userId: await crewAccount(ctx, name) };
  },
});

// Everyone exists from the start, so there's someone to challenge before they've signed in.
export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!devAuthOn()) throw new Error("Dev sign-in is off on this deployment.");
    for (const name of DEV_CREW) await crewAccount(ctx, name);
  },
});
