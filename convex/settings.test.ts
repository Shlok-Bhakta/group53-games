import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { changedSettings, settingsOf, settingsSummary } from "./modes";
import { simulate, initialState, paceFromSettings } from "./chess/realtime";
import { setup, signedIn } from "./test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("settings", () => {
  test("defaults fill in, and anything unknown or off the menu falls back", () => {
    expect(settingsOf("chess:realtime")).toEqual({ cooldown: 5, speed: 30 });
    expect(settingsOf("chess:realtime", { cooldown: 3, speed: 7, junk: 1 })).toEqual({ cooldown: 3, speed: 30 });
    expect(changedSettings("chess:realtime", { cooldown: 5, speed: 15 })).toEqual({ speed: 15 });
    expect(settingsSummary("chess:realtime", { cooldown: 2, speed: 15 })).toEqual(["2s cooldown", "Fast pieces"]);
    expect(settingsSummary("chess:four", { moveTime: 24 })).toEqual(["1 day to move"]);
  });

  test("real-time chess moves at the game's pace", () => {
    const pace = paceFromSettings({ cooldown: 2, speed: 15 });
    expect(pace).toEqual({ square: 15, cooldown: 60 });
    // e2-e4 for white: pawn id 12, two squares.
    const cmd = { tick: 0, color: "w", pieceId: 12, toX: 4, toY: 3 };
    const landed = simulate([cmd], 31, initialState("two", pace));
    expect(landed.pieces.find((p) => p.id === 12)).toMatchObject({ status: "cooldown", y: 3, readyAt: 30 + 60 });
    // The default pace takes twice as long to get there.
    expect(simulate([cmd], 31).pieces.find((p) => p.id === 12)).toMatchObject({ status: "moving" });
  });

  test("a real-time game starts its snapshot at the game's pace", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:realtime", settings: { cooldown: 10 } });
    await b.as.mutation(api.matches.queue, { mode: "chess:realtime" });
    await a.as.mutation(api.chess.ready, { id });
    await b.as.mutation(api.chess.ready, { id });
    const snap = await t.run((ctx) => ctx.db.query("rtSnapshots").collect());
    expect(snap[0].state.pace).toEqual({ square: 30, cooldown: 300 });
  });

  test("classic chess with a move timer: run it out and you lose on time", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:classic", settings: { moveTime: 24 } });
    await b.as.mutation(api.matches.queue, { mode: "chess:classic" });
    const m = (await t.run((ctx) => ctx.db.get(id)))!;
    await t.mutation(internal.matches.remind, { id, moveCount: 0, strikes: 2 });
    const done = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(done.status).toBe("finished");
    expect(done.result).toMatchObject({ reason: "timeout", winners: [m.players.find((p) => p.userId !== m.turn)!.userId] });
  });

  test("classic chess without a timer just keeps reminding", async () => {
    const t = setup();
    const a = await signedIn(t, "Shlok");
    const b = await signedIn(t, "Chris");
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
    await b.as.mutation(api.matches.queue, { mode: "chess:classic" });
    await t.mutation(internal.matches.remind, { id, moveCount: 0, strikes: 40 });
    expect((await t.run((ctx) => ctx.db.get(id)))!.status).toBe("active");
  });
});
