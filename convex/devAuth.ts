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

async function crewAccountId(ctx: GenericActionCtx<DataModel>, name: string) {
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
    return { userId: await crewAccountId(ctx, name) };
  },
});

export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!devAuthOn()) throw new Error("Dev sign-in is off on this deployment.");
    for (const name of DEV_CREW) await crewAccountId(ctx, name);
  },
});
