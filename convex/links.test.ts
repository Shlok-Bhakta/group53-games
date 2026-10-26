import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { setup, signedIn } from "./test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
const pushes = async (t: T) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()))
    .filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending")
    .map((s) => s.args[0] as { userId: Id<"users">; title: string; url: string });
const subscribe = (t: T, userId: Id<"users">) => t.run((ctx) => ctx.db.insert("pushSubscriptions", { userId, endpoint: `https://push.example/${userId}`, p256dh: "k", auth: "a" }));

describe("game links opened outside the app", () => {
  test("the link page shows the game and the crew, signed out", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    await subscribe(t, b.userId);
    const id = await a.as.mutation(api.matches.queue, { mode: "scrabble:classic" });
    const view = await t.query(api.links.preview, { path: `/scrabble/${id}?accept=1` });
    expect(view).toMatchObject({ game: "Scrabble", mode: "Classic", host: "Shlok", status: "waiting", players: [{ name: "Shlok" }] });
    expect(view!.crew.map((c) => [c.name, c.canPush])).toEqual([["Shlok", false], ["Chris", true]]);
    // A link with the wrong game in it, or no game at all, is nothing.
    expect(await t.query(api.links.preview, { path: `/chess/${id}` })).toBeNull();
    expect(await t.query(api.links.preview, { path: "/scrabble/nope" })).toBeNull();
  });

  test("picking yourself pushes the game to your phone, with a link that takes the seat", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    await subscribe(t, b.userId);
    const id = await a.as.mutation(api.matches.queue, { mode: "scrabble:classic" });
    await t.run(async (ctx) => {
      for (const s of await ctx.db.system.query("_scheduled_functions").collect()) await ctx.scheduler.cancel(s._id);
    });
    expect(await t.mutation(api.links.handoff, { path: `/scrabble/${id}`, userId: b.userId })).toBe("sent");
    expect(await pushes(t)).toEqual([expect.objectContaining({ userId: b.userId, title: "Join Shlok's game", url: `/scrabble/${id}?accept=1` })]);
    // Tapping twice in a row doesn't spam them.
    expect(await t.mutation(api.links.handoff, { path: `/scrabble/${id}`, userId: b.userId })).toBe("wait");
    vi.advanceTimersByTime(16_000);
    expect(await t.mutation(api.links.handoff, { path: `/scrabble/${id}`, userId: b.userId })).toBe("sent");
  });

  test("someone without notifications on is told so instead", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    const id = await a.as.mutation(api.matches.queue, { mode: "scrabble:classic" });
    expect(await t.mutation(api.links.handoff, { path: `/scrabble/${id}`, userId: b.userId })).toBe("no-push");
  });

  test("players already in the game get a plain link back to it", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    await subscribe(t, a.userId);
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
    await t.mutation(api.links.handoff, { path: `/chess/${id}`, userId: a.userId });
    expect((await pushes(t)).find((p) => p.userId === a.userId)).toMatchObject({ title: "Your game link", url: `/chess/${id}` });
  });
});
