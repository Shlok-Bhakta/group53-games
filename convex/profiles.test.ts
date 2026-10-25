import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { DEFAULT_PROFILE, TAGLINE_MAX } from "./profileOptions";
import { setup, signedIn } from "./test.setup";

describe("profiles", () => {
  test("a new player gets the default card", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    const mine = await as.query(api.profiles.mine, {});
    expect(mine).toMatchObject({ name: "Shlok", ...DEFAULT_PROFILE });
  });

  test("the first edit creates the profile, later edits patch it", async () => {
    const t = setup();
    const { as, userId } = await signedIn(t);
    await as.mutation(api.profiles.update, { frame: "holo", glow: true });
    await as.mutation(api.profiles.update, { badge: "👑" });
    const rows = await t.run((ctx) => ctx.db.query("profiles").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, frame: "holo", glow: true, badge: "👑", effect: "none" });
  });

  test.each([
    [{ frame: "sparkles" }, "Unknown frame."],
    [{ effect: "glitch" }, "Unknown effect."],
    [{ badge: "🍆" }, "Unknown badge."],
    [{ frameColor: "red" }, "Frame color must be a hex color."],
    [{ frameColor: "#12345" }, "Frame color must be a hex color."],
  ])("rejects %o", async (changes, message) => {
    const t = setup();
    const { as } = await signedIn(t);
    await expect(as.mutation(api.profiles.update, changes)).rejects.toThrow(message);
  });

  test("taglines are single-line, trimmed, and capped", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    await as.mutation(api.profiles.update, { tagline: "  two\n\nlines   here  " });
    expect((await as.query(api.profiles.mine, {}))?.tagline).toBe("two lines here");
    await as.mutation(api.profiles.update, { tagline: "x".repeat(100) });
    expect((await as.query(api.profiles.mine, {}))?.tagline).toHaveLength(TAGLINE_MAX);
  });

  test("signed-out callers can't read the crew or edit", async () => {
    const t = setup();
    await signedIn(t);
    expect(await t.query(api.profiles.crew, {})).toEqual([]);
    await expect(t.mutation(api.profiles.update, { frame: "gold" })).rejects.toThrow("Sign in first.");
  });

  test("the crew lists everyone with their cosmetics", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    await b.as.mutation(api.profiles.update, { frame: "comet", frameColor: "#ec4899", tagline: "gg" });
    const crew = await a.as.query(api.profiles.crew, {});
    expect(crew.map((p) => p.name).sort()).toEqual(["Chris", "Shlok"]);
    expect(crew.find((p) => p.name === "Chris")).toMatchObject({ frame: "comet", frameColor: "#ec4899", tagline: "gg" });
  });
});

describe("presence", () => {
  test("taps clamp to the screen and count up", async () => {
    const t = setup();
    const { as, userId } = await signedIn(t);
    await as.mutation(api.presence.tap, { x: 1.7, y: -20, path: "/crew" });
    await as.mutation(api.presence.tap, { x: 0.25, y: 300, path: "/crew" });
    const [row] = await as.query(api.presence.list, {});
    expect(row).toMatchObject({ userId, online: true, path: "/crew", tap: { x: 0.25, y: 300, path: "/crew", seq: 2 } });
  });

  test("going to the background marks you offline", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    await as.mutation(api.presence.heartbeat, { path: "/", online: true });
    await as.mutation(api.presence.heartbeat, { path: "/", online: false });
    const rows = await as.query(api.presence.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].online).toBe(false);
  });

  test("signed-out callers see nothing and write nothing", async () => {
    const t = setup();
    await t.mutation(api.presence.tap, { x: 0.5, y: 10, path: "/" });
    expect(await t.run((ctx) => ctx.db.query("presence").collect())).toEqual([]);
    expect(await t.query(api.presence.list, {})).toEqual([]);
  });
});

describe("notifications", () => {
  const sub = { endpoint: "https://push.example.com/abc", p256dh: "key", auth: "secret" };

  test("subscribing stores the device once and schedules a welcome push", async () => {
    vi.useFakeTimers();
    const t = setup();
    const { as } = await signedIn(t);
    await as.mutation(api.notifications.subscribe, sub);
    await as.mutation(api.notifications.subscribe, sub);
    expect(await t.run((ctx) => ctx.db.query("pushSubscriptions").collect())).toHaveLength(1);
    expect(await as.query(api.notifications.hasEndpoint, { endpoint: sub.endpoint })).toBe(true);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((s) => s.name)).toContain("push:sendToUser");
    vi.useRealTimers();
  });

  test("a device that changes hands moves to the new player", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    await a.as.mutation(api.notifications.subscribe, sub);
    await b.as.mutation(api.notifications.subscribe, sub);
    expect(await a.as.query(api.notifications.hasEndpoint, { endpoint: sub.endpoint })).toBe(false);
    expect(await b.as.query(api.notifications.hasEndpoint, { endpoint: sub.endpoint })).toBe(true);
    vi.useRealTimers();
  });

  test("you can't unsubscribe someone else's device", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    await a.as.mutation(api.notifications.subscribe, sub);
    await b.as.mutation(api.notifications.unsubscribe, { endpoint: sub.endpoint });
    expect(await a.as.query(api.notifications.hasEndpoint, { endpoint: sub.endpoint })).toBe(true);
    vi.useRealTimers();
  });
});
