import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { REALTIME_COUNTDOWN_MS, REMINDER_MS } from "./modes";
import { TICK_MS } from "./chess/realtime";
import { setup, signedIn } from "./test.setup";
import type { FourState, RealtimeState } from "./chess";
import { TIMEOUT_STRIKES } from "./matches";
import { multiElo } from "./ratings";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;
type Player = Awaited<ReturnType<typeof signedIn>>;

const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pushes = async (t: T) =>
  (await scheduled(t)).filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending").map((s) => s.args[0] as { userId: Id<"users">; title: string; body: string; url: string });
const clearPushes = (t: T) =>
  t.run(async (ctx) => {
    for (const s of await ctx.db.system.query("_scheduled_functions").collect()) if (s.name === "push:sendToUser" && s.state.kind === "pending") await ctx.scheduler.cancel(s._id);
  });
const match = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.get(id));

async function crew(t: T, n = 4) {
  const names = ["Shlok", "Chris", "Sam", "Alex", "Jo"];
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await signedIn(t, names[i]));
  return out;
}

// Four players queue into one game. Returns them keyed by color.
async function fourGame(t: T, mode: "chess:four" | "chess:realtime4" = "chess:four") {
  const players = await crew(t);
  let id: Id<"matches"> | undefined;
  for (const p of players) id = await p.as.mutation(api.matches.queue, { mode });
  const m = (await match(t, id!))!;
  const by = (color: string) => players.find((p) => p.userId === m.players.find((s) => s.color === color)!.userId)!;
  return { id: id!, players, red: by("red"), blue: by("blue"), yellow: by("yellow"), green: by("green") };
}

// Squares by name, a..n and 1..14.
const sq = (s: string) => ({ x: s.charCodeAt(0) - 97, y: Number(s.slice(1)) - 1 });
const mv = (from: string, to: string) => ({ fromX: sq(from).x, fromY: sq(from).y, toX: sq(to).x, toY: sq(to).y });

describe("four-player lobby", () => {
  test("the queue fills four seats, then deals out red, blue, yellow and green", async () => {
    const t = setup();
    const players = await crew(t);
    const id = await players[0].as.mutation(api.matches.queue, { mode: "chess:four" });
    expect((await pushes(t)).map((p) => [p.title, p.url])).toEqual(players.slice(1).map(() => ["Shlok wants 4-player chess", `/chess/${id}?accept=1`]));
    await clearPushes(t);
    expect(await players[1].as.mutation(api.matches.queue, { mode: "chess:four" })).toBe(id);
    expect((await match(t, id))!.status).toBe("waiting");
    expect((await pushes(t)).map((p) => p.title)).toEqual(["Chris joined (2/4)"]);
    await players[2].as.mutation(api.matches.queue, { mode: "chess:four" });
    await players[3].as.mutation(api.matches.queue, { mode: "chess:four" });
    const m = (await match(t, id))!;
    expect(m.status).toBe("active");
    expect(m.players.map((p) => p.color).sort()).toEqual(["blue", "green", "red", "yellow"]);
    const red = m.players.find((p) => p.color === "red")!.userId;
    expect(m.turn).toBe(red);
    expect((m.state as FourState).kind).toBe("four");
    const titles = (await pushes(t)).map((p) => p.title);
    expect(titles).toContain("You're red. Your move");
    expect(titles.filter((x) => x.startsWith("You're ")).sort()).toEqual(["You're blue", "You're green", "You're red. Your move", "You're yellow"]);
  });

  test("a full game turns away a fifth player", async () => {
    const t = setup();
    const { id } = await fourGame(t);
    const jo = await signedIn(t, "Jo");
    await expect(jo.as.mutation(api.matches.join, { id })).rejects.toThrow("already started");
  });

  test("challenging three people is invite-only, and it starts when the last one accepts", async () => {
    const t = setup();
    const [a, b, c, d, e] = await crew(t, 5);
    const id = await a.as.mutation(api.matches.challenge, { mode: "chess:four", opponents: [b.userId, c.userId, d.userId] });
    const sent = await pushes(t);
    expect(sent.map((p) => p.userId).sort()).toEqual([b.userId, c.userId, d.userId].sort());
    expect(sent.find((p) => p.userId === b.userId)).toMatchObject({ title: "Shlok challenged you", body: "4-player chess with Sam and Alex. Tap to accept.", url: `/chess/${id}?accept=1` });
    await expect(e.as.mutation(api.matches.join, { id })).rejects.toThrow("invite-only");
    // Asking again with the same three, in any order, is the same challenge.
    expect(await a.as.mutation(api.matches.challenge, { mode: "chess:four", opponents: [d.userId, b.userId, c.userId] })).toBe(id);
    await b.as.mutation(api.matches.join, { id });
    await c.as.mutation(api.matches.join, { id });
    expect((await match(t, id))!.status).toBe("waiting");
    await d.as.mutation(api.matches.join, { id });
    expect((await match(t, id))!.status).toBe("active");
  });

  test("inviting fewer than three leaves the other seats open to the crew", async () => {
    const t = setup();
    const [a, b, c, d, e] = await crew(t, 5);
    const id = await a.as.mutation(api.matches.challenge, { mode: "chess:four", opponents: [b.userId] });
    expect((await match(t, id))!.openSeats).toBe(true);
    const sent = await pushes(t);
    expect(sent.find((p) => p.userId === b.userId)?.body).toBe("4-player chess with 2 more. Tap to accept.");
    expect(sent.filter((p) => p.title === "Shlok has 2 free seats").map((p) => p.userId).sort()).toEqual([c.userId, d.userId, e.userId].sort());
    await c.as.mutation(api.matches.join, { id });
    // Joining through the queue finds the open seat too.
    expect(await d.as.mutation(api.matches.queue, { mode: "chess:four" })).toBe(id);
    await expect(e.as.mutation(api.matches.join, { id })).rejects.toThrow("full");
    await b.as.mutation(api.matches.join, { id });
    expect((await match(t, id))!.status).toBe("active");
  });

  test("one decline opens that seat instead of calling the game off", async () => {
    const t = setup();
    const [a, b, c, d, e] = await crew(t, 5);
    const id = await a.as.mutation(api.matches.challenge, { mode: "chess:four", opponents: [b.userId, c.userId, d.userId] });
    await b.as.mutation(api.matches.join, { id });
    await clearPushes(t);
    await c.as.mutation(api.matches.decline, { id });
    const m = (await match(t, id))!;
    expect(m).toMatchObject({ status: "waiting", openSeats: true, invited: [b.userId, d.userId] });
    const sent = await pushes(t);
    expect(sent.filter((p) => p.title === "Sam declined").map((p) => p.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(sent.filter((p) => p.title === "A seat opened up").map((p) => p.userId)).toEqual([e.userId]);
    await e.as.mutation(api.matches.join, { id });
    await d.as.mutation(api.matches.join, { id });
    expect((await match(t, id))!.status).toBe("active");
  });

  test("you can leave a lobby you joined, and the host calling it off tells everyone", async () => {
    const t = setup();
    const [a, b, c] = await crew(t, 3);
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:four" });
    await b.as.mutation(api.matches.join, { id });
    await c.as.mutation(api.matches.join, { id });
    await b.as.mutation(api.matches.leave, { id });
    expect((await match(t, id))!.players.map((p) => p.userId)).toEqual([a.userId, c.userId]);
    await clearPushes(t);
    await a.as.mutation(api.matches.cancel, { id });
    expect((await match(t, id))!.status).toBe("cancelled");
    expect((await pushes(t)).map((p) => [p.userId, p.title])).toEqual([[c.userId, "Shlok called it off"]]);
  });

  test("the inbox gathers challenges, open seats, and games waiting on me across modes", async () => {
    const t = setup();
    const [a, b, c, d] = await crew(t);
    const challenge = await b.as.mutation(api.matches.challenge, { mode: "chess:classic", opponent: a.userId });
    const lobby = await c.as.mutation(api.matches.queue, { mode: "chess:realtime4" });
    const mine = await a.as.mutation(api.matches.queue, { mode: "chess:four" });
    const classic = await d.as.mutation(api.matches.challenge, { mode: "chess:classic", opponent: a.userId });
    await a.as.mutation(api.matches.join, { id: classic });
    const game = (await match(t, classic))!;
    const inbox = (await a.as.query(api.matches.inbox, {}))!;
    expect(inbox.invites.map((m) => m._id)).toEqual([challenge]);
    expect(inbox.open.map((m) => m._id)).toEqual([lobby]);
    expect(inbox.waiting.map((m) => m._id)).toEqual([mine]);
    const bucket = game.turn === a.userId ? inbox.myTurn : inbox.theirTurn;
    expect(bucket.map((m) => m._id)).toEqual([classic]);
    expect(inbox.invites[0].players[0].name).toBe("Chris");
  });
});

describe("four-player chess", () => {
  test("turns go clockwise, only the player to move can move, and each move pings the next", async () => {
    const t = setup();
    const g = await fourGame(t);
    await clearPushes(t);
    await expect(g.blue.as.mutation(api.chess.fourMove, { id: g.id, ...mv("b5", "c5") })).rejects.toThrow("not your move");
    await expect(g.red.as.mutation(api.chess.fourMove, { id: g.id, ...mv("e2", "e5") })).rejects.toThrow("isn't legal");
    await g.red.as.mutation(api.chess.fourMove, { id: g.id, ...mv("e2", "e4") });
    const m = (await match(t, g.id))!;
    expect(m.turn).toBe(g.blue.userId);
    expect(m.moveCount).toBe(1);
    const sent = await pushes(t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: g.blue.userId, body: "Your move in 4-player chess." });
    expect(sent[0].title).toMatch(/played e4$/);
    const reminders = (await scheduled(t)).filter((s) => s.name === "matches:remind" && s.state.kind === "pending");
    expect(reminders.at(-1)!.args[0]).toEqual({ id: g.id, moveCount: 1, strikes: 0 });
  });

  test("resigning greys your army and play skips you", async () => {
    const t = setup();
    const g = await fourGame(t);
    await g.blue.as.mutation(api.matches.resign, { id: g.id });
    let m = (await match(t, g.id))!;
    expect(m.status).toBe("active");
    expect((m.state as FourState).out).toEqual([{ color: "blue", reason: "resign", ply: 0 }]);
    await g.red.as.mutation(api.chess.fourMove, { id: g.id, ...mv("e2", "e4") });
    m = (await match(t, g.id))!;
    expect(m.turn).toBe(g.yellow.userId);
  });

  test("there are no draw offers with four players", async () => {
    const t = setup();
    const g = await fourGame(t);
    await expect(g.red.as.mutation(api.matches.offerDraw, { id: g.id })).rejects.toThrow("no draws");
  });

  test("the last player standing ends it, with standings, placings, and ratings for all four", async () => {
    const t = setup();
    const g = await fourGame(t);
    await g.green.as.mutation(api.matches.resign, { id: g.id });
    await g.red.as.mutation(api.chess.fourMove, { id: g.id, ...mv("e2", "e4") });
    await g.blue.as.mutation(api.matches.resign, { id: g.id });
    await clearPushes(t);
    await g.red.as.mutation(api.matches.resign, { id: g.id });
    const m = (await match(t, g.id))!;
    expect(m).toMatchObject({ status: "finished", result: { winners: [g.yellow.userId], reason: "last_player" } });
    expect(m.result!.standings).toEqual([[g.yellow.userId], [g.red.userId], [g.blue.userId], [g.green.userId]]);
    const changes = m.ratingChanges!;
    expect(changes).toHaveLength(4);
    const delta = (p: Player) => changes.find((c) => c.userId === p.userId)!;
    expect(delta(g.yellow).after).toBeGreaterThan(1200);
    expect(delta(g.green).after).toBeLessThan(1200);
    expect(delta(g.red).after).toBeGreaterThan(delta(g.blue).after);
    const titles = Object.fromEntries((await pushes(t)).map((p) => [p.userId, p.title]));
    expect(titles[g.yellow.userId]).toMatch(/^You won \(\+\d+\)$/);
    expect(titles[g.red.userId]).toMatch(/^You placed 2nd/);
    expect(titles[g.green.userId]).toMatch(/^You placed 4th/);
    const board = await g.red.as.query(api.ratings.leaderboard, { mode: "chess:four" });
    expect(board[0]).toMatchObject({ userId: g.yellow.userId, wins: 1, games: 1 });
  });

  test("sitting on your move for two days times you out", async () => {
    const t = setup();
    const g = await fourGame(t);
    for (let strike = 0; strike < TIMEOUT_STRIKES - 1; strike++) {
      await t.mutation(internal.matches.remind, { id: g.id, moveCount: 0, strikes: strike });
      expect((await match(t, g.id))!.turn).toBe(g.red.userId);
    }
    const warnings = (await pushes(t)).filter((p) => p.userId === g.red.userId && p.title === "Still your move");
    expect(warnings.at(-1)!.body).toContain("time out");
    await t.mutation(internal.matches.remind, { id: g.id, moveCount: 0, strikes: TIMEOUT_STRIKES - 1 });
    const m = (await match(t, g.id))!;
    expect((m.state as FourState).out).toEqual([{ color: "red", reason: "timeout", ply: 0 }]);
    expect(m.turn).toBe(g.blue.userId);
    const sent = await pushes(t);
    expect(sent).toContainEqual(expect.objectContaining({ userId: g.red.userId, title: "You timed out" }));
    expect(sent).toContainEqual(expect.objectContaining({ userId: g.blue.userId, title: `${(await t.run((ctx) => ctx.db.get(g.red.userId)))!.name} timed out` }));
  });

  test("rematches need everyone, and colors move one seat along", async () => {
    const t = setup();
    const g = await fourGame(t);
    for (const p of [g.green, g.blue, g.red]) await p.as.mutation(api.matches.resign, { id: g.id });
    await g.red.as.mutation(api.matches.rematch, { id: g.id });
    await g.blue.as.mutation(api.matches.rematch, { id: g.id });
    await g.green.as.mutation(api.matches.rematch, { id: g.id });
    expect((await match(t, g.id))!.rematch).toMatchObject({ status: "pending", yes: [g.red.userId, g.blue.userId, g.green.userId] });
    const next = (await g.yellow.as.mutation(api.matches.rematch, { id: g.id }))!;
    const m = (await match(t, next))!;
    expect(m.status).toBe("active");
    const colorOf = (p: Player) => m.players.find((s) => s.userId === p.userId)!.color;
    // Blue moves up to red, red goes round to green.
    expect([colorOf(g.blue), colorOf(g.yellow), colorOf(g.green), colorOf(g.red)]).toEqual(["red", "blue", "yellow", "green"]);
  });
});

describe("four-player real-time", () => {
  async function started(t: T) {
    const g = await fourGame(t, "chess:realtime4");
    for (const p of g.players) await p.as.mutation(api.chess.ready, { id: g.id });
    const startAt = ((await match(t, g.id))!.state as RealtimeState).startAt!;
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 1);
    return { ...g, serverTick: () => Math.floor((Date.now() - startAt) / TICK_MS) };
  }

  test("the clock waits for all four, and moves reach the edges of the bigger board", async () => {
    const t = setup();
    const g = await fourGame(t, "chess:realtime4");
    for (const p of g.players.slice(0, 3)) await p.as.mutation(api.chess.ready, { id: g.id });
    expect(((await match(t, g.id))!.state as RealtimeState).startAt).toBeNull();
    await g.players[3].as.mutation(api.chess.ready, { id: g.id });
    expect(((await match(t, g.id))!.state as RealtimeState).startAt).not.toBeNull();
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 1);
    const view = (await g.red.as.query(api.chess.rtState, { id: g.id }))!;
    expect(view.variant).toBe("four");
    expect(view.snapshot!.pieces).toHaveLength(64);
    await g.green.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 48, toX: 13, toY: 13, clientTick: 0 });
    await expect(g.green.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 48, toX: 14, toY: 3, clientTick: 0 })).rejects.toThrow("not a square");
  });

  test("resigning drops a command into the timeline; the last king standing wins", async () => {
    const t = setup();
    const g = await started(t);
    await g.green.as.mutation(api.matches.resign, { id: g.id });
    vi.advanceTimersByTime(500);
    await g.blue.as.mutation(api.matches.resign, { id: g.id });
    vi.advanceTimersByTime(500);
    await g.red.as.mutation(api.matches.resign, { id: g.id });
    expect((await match(t, g.id))!.status).toBe("active");
    vi.advanceTimersByTime(3000);
    await t.mutation(internal.chess.rtTick, { id: g.id });
    const m = (await match(t, g.id))!;
    expect(m).toMatchObject({ status: "finished", result: { winners: [g.yellow.userId], draw: false, reason: "last_king" } });
    expect(m.result!.standings).toEqual([[g.yellow.userId], [g.red.userId], [g.blue.userId], [g.green.userId]]);
    expect(m.ratingChanges).toHaveLength(4);
  });

  test("resigning before the clock starts calls the game off", async () => {
    const t = setup();
    const g = await fourGame(t, "chess:realtime4");
    await g.red.as.mutation(api.matches.resign, { id: g.id });
    expect((await match(t, g.id))!.status).toBe("cancelled");
  });
});

describe("multiplayer Elo", () => {
  test("two players match plain Elo, and a four-way game moves ratings about as much", () => {
    expect(multiElo([1200, 1200], [0, 1])).toEqual([16, -16]);
    expect(multiElo([1200, 1200], [0, 0])).toEqual([0, 0]);
    const four = multiElo([1200, 1200, 1200, 1200], [0, 1, 2, 3]);
    expect(four).toEqual([16, 5, -5, -16]);
    expect(four.reduce((a, b) => a + b, 0)).toBe(0);
  });

  test("reminders still go out every 8 hours", () => {
    expect(REMINDER_MS * TIMEOUT_STRIKES).toBe(48 * 60 * 60 * 1000);
  });
});
