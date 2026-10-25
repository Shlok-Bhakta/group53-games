/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "./schema";

// Every Convex module, loaded lazily the way the backend would.
export const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./test.setup.ts"]);

export function setup() {
  return convexTest(schema, modules);
}

export async function signedIn(t: ReturnType<typeof setup>, name = "Shlok") {
  const userId = await t.run((ctx) => ctx.db.insert("users", { name }));
  const sessionId = await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3600_000 }));
  return { userId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}
