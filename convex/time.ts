import { mutation } from "./_generated/server";

// Clients measure their clock offset against this (real-time games run on server ticks).
// A mutation rather than a query so it's never served from a cache.
export const now = mutation({ args: {}, handler: async () => Date.now() });
