import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { setup } from "./test.setup";

const LOCAL = "http://127.0.0.1:3211";
const KIWI = "https://group53-site.shlokbhakta.dev";

function deployment(vars: { DEV_AUTH?: string; CONVEX_SITE_URL: string }) {
  vi.stubEnv("DEV_AUTH", vars.DEV_AUTH ?? "");
  vi.stubEnv("CONVEX_SITE_URL", vars.CONVEX_SITE_URL);
}
const signIn = (t: ReturnType<typeof setup>, name: unknown) => t.action(api.auth.signIn, { provider: "dev", params: { name } as never });
const users = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("users").collect());

describe("signing in without Discord", () => {
  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv("JWT_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, " "));
    vi.stubEnv("JWKS", "{}");
    vi.stubEnv("SITE_URL", "http://127.0.0.1:5173");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs in the same crew member every time", async () => {
    deployment({ DEV_AUTH: "1", CONVEX_SITE_URL: LOCAL });
    const t = setup();
    const first = await signIn(t, "Ada");
    await signIn(t, "Ada");
    expect(first.tokens?.token).toBeTruthy();
    expect((await users(t)).map((u) => u.name)).toEqual(["Ada"]);
    expect((await users(t))[0].isTest).toBeUndefined();
  });

  it("only knows the crew", async () => {
    deployment({ DEV_AUTH: "1", CONVEX_SITE_URL: LOCAL });
    const t = setup();
    expect((await signIn(t, "Mallory")).tokens).toBeNull();
    expect((await signIn(t, ["Ada"])).tokens).toBeNull();
    expect(await users(t)).toEqual([]);
  });

  it("is off without DEV_AUTH", async () => {
    deployment({ CONVEX_SITE_URL: LOCAL });
    const t = setup();
    expect((await signIn(t, "Ada")).tokens).toBeNull();
    await expect(t.action(internal.devAuth.seed, {})).rejects.toThrow("off");
    expect(await users(t)).toEqual([]);
  });

  it("stays off on kiwi even if DEV_AUTH gets set there", async () => {
    deployment({ DEV_AUTH: "1", CONVEX_SITE_URL: KIWI });
    const t = setup();
    expect((await signIn(t, "Ada")).tokens).toBeNull();
    await expect(t.action(internal.devAuth.seed, {})).rejects.toThrow("off");
    expect(await users(t)).toEqual([]);
  });

  it("seeds the whole crew, and again changes nothing", async () => {
    deployment({ DEV_AUTH: "1", CONVEX_SITE_URL: LOCAL });
    const t = setup();
    await t.action(internal.devAuth.seed, {});
    await t.action(internal.devAuth.seed, {});
    expect(await users(t)).toHaveLength(8);
  });
});
