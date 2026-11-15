import { mutation } from "./_generated/server";

// platform: a mutation, because Convex may answer a query from its cache.
export const now = mutation({ args: {}, handler: async () => Date.now() });
