import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { REALTIME_COUNTDOWN_MS, REMINDER_MS } from "./modes";
import { TICK_MS } from "./chess/realtime";
import { setup, signedIn } from "./test.setup";
import { MAX_LAG_TICKS, type ClassicState, type RealtimeState } from "./chess";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof setup>;

const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
const pushes = async (t: T) => (await scheduled(t)).filter((s) => s.name === "push:sendToUser" && s.state.kind === "pending").map((s) => s.args[0] as { userId: Id<"users">; title: string; url: string });
const match = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.get(id));

async function twoPlayers(t: T) {
  const a = await signedIn(t, "Shlok");
  const b = await signedIn(t, "Chris");
  return { a, b };
}

// Starts a classic game and returns who's white and black.
async function classicGame(t: T) {
  const { a, b } = await twoPlayers(t);
  const id = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
  await b.as.mutation(api.matches.queue, { mode: "chess:classic" });
  const m = (await match(t, id))!;
  const whiteId = m.players.find((p) => p.color === "w")!.userId;
  const [white, black] = whiteId === a.userId ? [a, b] : [b, a];
  return { id, white, black };
}

describe("lobby", () => {
  test("queueing opens a game and pings the rest of the crew", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
    expect(await match(t, id)).toMatchObject({ status: "waiting", players: [{ userId: a.userId }] });
    const sent = await pushes(t);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: b.userId, title: "Shlok wants a game of chess", url: `/chess/${id}?accept=1` });
  });

  test("queueing again returns the same lobby", async () => {
    const t = setup();
    const { a } = await twoPlayers(t);
    const first = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
    expect(await a.as.mutation(api.matches.queue, { mode: "chess:classic" })).toBe(first);
  });

  test("the second player joins the open lobby and the game starts", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
    expect(await b.as.mutation(api.matches.queue, { mode: "chess:classic" })).toBe(id);
    const m = (await match(t, id))!;
    expect(m.status).toBe("active");
    expect(m.players.map((p) => p.color).sort()).toEqual(["b", "w"]);
    expect(m.turn).toBe(m.players.find((p) => p.color === "w")!.userId);
    expect((m.state as ClassicState).moves).toEqual([]);
    expect((await pushes(t)).map((p) => p.title)).toEqual(expect.arrayContaining(["Chris joined", "You're white"]));
  });

  test("modes don't mix", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    const classic = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
    const realtime = await b.as.mutation(api.matches.queue, { mode: "chess:realtime" });
    expect(realtime).not.toBe(classic);
    expect((await match(t, classic))?.status).toBe("waiting");
  });

  test("challenges are invite-only until accepted", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    const c = await signedIn(t, "Boiler");
    const id = await a.as.mutation(api.matches.challenge, { mode: "chess:classic", opponent: b.userId });
    expect((await pushes(t)).at(-1)).toMatchObject({ userId: b.userId, title: "Shlok challenged you" });
    await expect(c.as.mutation(api.matches.join, { id })).rejects.toThrow("invite-only");
    expect(await c.as.mutation(api.matches.queue, { mode: "chess:classic" })).not.toBe(id);
    await b.as.mutation(api.matches.join, { id });
    expect((await match(t, id))?.status).toBe("active");
  });

  test("challenging the same person twice returns the same challenge", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    const ids = await Promise.all(Array.from({ length: 5 }, () => a.as.mutation(api.matches.challenge, { mode: "chess:realtime", opponent: b.userId })));
    expect(new Set(ids).size).toBe(1);
    expect((await pushes(t)).filter((p) => p.title === "Shlok challenged you")).toHaveLength(1);
  });

  test("the sweep cancels duplicate challenges, stale lobbies, and real-time games nobody opened", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    // Duplicates made before dedupe existed.
    const dupes = await t.run(async (ctx) =>
      Promise.all([0, 1, 2].map(() => ctx.db.insert("matches", { mode: "chess:classic", status: "waiting", createdBy: a.userId, players: [{ userId: a.userId }], invited: [b.userId], state: null, moveCount: 0, lastActivityAt: Date.now() }))),
    );
    const rt = await a.as.mutation(api.matches.queue, { mode: "chess:realtime" });
    await b.as.mutation(api.matches.queue, { mode: "chess:realtime" });
    vi.advanceTimersByTime(4 * 60 * 1000);
    await t.mutation(internal.matches.sweep, {});
    const statuses = await Promise.all(dupes.map((id) => match(t, id).then((m) => m!.status)));
    expect(statuses.filter((s) => s === "waiting")).toHaveLength(1);
    expect((await match(t, rt))!.status).toBe("cancelled");
  });

  test("test players never get pushes and never ping the crew", async () => {
    const t = setup();
    const { a } = await twoPlayers(t);
    const bot = await t.run((ctx) => ctx.db.insert("users", { name: "LoadBot", isTest: true }));
    const botSession = await t.run((ctx) => ctx.db.insert("authSessions", { userId: bot, expirationTime: Date.now() + 3600_000 }));
    const botAs = t.withIdentity({ subject: `${bot}|${botSession}` });
    await botAs.mutation(api.matches.queue, { mode: "chess:classic" });
    expect(await pushes(t)).toEqual([]);
    await a.as.mutation(api.matches.challenge, { mode: "chess:classic", opponent: bot });
    expect((await pushes(t)).filter((p) => p.userId === bot)).toEqual([]);
  });

  test("declining a challenge cancels it and tells the challenger", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    const id = await a.as.mutation(api.matches.challenge, { mode: "chess:realtime", opponent: b.userId });
    await b.as.mutation(api.matches.decline, { id });
    expect((await match(t, id))?.status).toBe("cancelled");
    expect((await pushes(t)).at(-1)).toMatchObject({ userId: a.userId, title: "Chris declined" });
  });

  test("you can't challenge yourself, and only the creator can cancel", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    await expect(a.as.mutation(api.matches.challenge, { mode: "chess:classic", opponent: a.userId })).rejects.toThrow("yourself");
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:classic" });
    await expect(b.as.mutation(api.matches.cancel, { id })).rejects.toThrow();
    await a.as.mutation(api.matches.cancel, { id });
    expect((await match(t, id))?.status).toBe("cancelled");
  });

  test("real-time lobbies close if nobody joins", async () => {
    const t = setup();
    const { a } = await twoPlayers(t);
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:realtime" });
    await t.mutation(internal.matches.expireLobby, { id });
    expect((await match(t, id))?.status).toBe("cancelled");
  });

  test("the lobby query sorts games into the right buckets", async () => {
    const t = setup();
    const { a, b } = await twoPlayers(t);
    const c = await signedIn(t, "Boiler");
    const open = await c.as.mutation(api.matches.queue, { mode: "chess:classic" });
    const invite = await b.as.mutation(api.matches.challenge, { mode: "chess:classic", opponent: a.userId });
    const view = (await a.as.query(api.matches.lobby, { mode: "chess:classic" }))!;
    expect(view.open.map((m) => m._id)).toEqual([open]);
    expect(view.invites.map((m) => m._id)).toEqual([invite]);
    expect(view.open[0].players[0].name).toBe("Boiler");
  });
});

describe("rematches", () => {
  async function finished(t: T) {
    const g = await classicGame(t);
    await g.white.as.mutation(api.matches.resign, { id: g.id });
    return g;
  }

  test("asking waits in place, and accepting starts a new game with colors swapped and no pushes", async () => {
    const t = setup();
    const { id, white, black } = await finished(t);
    const before = (await pushes(t)).length;
    expect(await white.as.mutation(api.matches.rematch, { id })).toBeNull();
    expect((await match(t, id))!.rematch).toMatchObject({ by: white.userId, status: "pending" });
    const next = await black.as.mutation(api.matches.rematch, { id });
    expect(next).toBeTruthy();
    const m = (await match(t, next!))!;
    expect(m).toMatchObject({ status: "active", rematchOf: id });
    expect(m.players.find((p) => p.color === "w")!.userId).toBe(black.userId);
    expect((await match(t, id))!.rematch).toMatchObject({ status: "accepted", matchId: next });
    expect((await pushes(t)).length).toBe(before);
    // Asking again just returns the game that already started.
    expect(await white.as.mutation(api.matches.rematch, { id })).toBe(next);
  });

  test("no thanks, or the asker cancelling, declines it", async () => {
    const t = setup();
    const { id, white, black } = await finished(t);
    await white.as.mutation(api.matches.rematch, { id });
    await black.as.mutation(api.matches.answerRematch, { id });
    expect((await match(t, id))!.rematch?.status).toBe("declined");
    // After a decline, asking again starts a fresh offer rather than a game.
    expect(await black.as.mutation(api.matches.rematch, { id })).toBeNull();
    await black.as.mutation(api.matches.answerRematch, { id });
    expect((await match(t, id))!.rematch?.status).toBe("declined");
  });

  test("an offer lapses after two minutes", async () => {
    const t = setup();
    const { id, white, black } = await finished(t);
    await white.as.mutation(api.matches.rematch, { id });
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(await black.as.mutation(api.matches.rematch, { id })).toBeNull();
    expect((await match(t, id))!.rematch).toMatchObject({ by: black.userId, status: "pending" });
  });

  test("only the two players can rematch, and only a finished game", async () => {
    const t = setup();
    const g = await classicGame(t);
    await expect(g.white.as.mutation(api.matches.rematch, { id: g.id })).rejects.toThrow("just played");
    await g.white.as.mutation(api.matches.resign, { id: g.id });
    const c = await signedIn(t, "Boiler");
    await expect(c.as.mutation(api.matches.rematch, { id: g.id })).rejects.toThrow("just played");
  });
});

describe("classic chess", () => {
  test("moves alternate and are checked by chess.js", async () => {
    const t = setup();
    const { id, white, black } = await classicGame(t);
    await expect(black.as.mutation(api.chess.move, { id, from: "e7", to: "e5" })).rejects.toThrow("not your move");
    await expect(white.as.mutation(api.chess.move, { id, from: "e2", to: "e5" })).rejects.toThrow("isn't legal");
    await white.as.mutation(api.chess.move, { id, from: "e2", to: "e4" });
    await black.as.mutation(api.chess.move, { id, from: "e7", to: "e5" });
    const m = (await match(t, id))!;
    expect((m.state as ClassicState).moves.map((x) => x.san)).toEqual(["e4", "e5"]);
    expect(m.turn).toBe(white.userId);
    expect(m.moveCount).toBe(2);
  });

  test("each move pings the opponent and arms an 8-hour reminder", async () => {
    const t = setup();
    const { id, white, black } = await classicGame(t);
    await white.as.mutation(api.chess.move, { id, from: "e2", to: "e4" });
    const whiteName = (await t.run((ctx) => ctx.db.get(white.userId)))!.name;
    expect((await pushes(t)).at(-1)).toMatchObject({ userId: black.userId, title: `${whiteName} played e4`, url: `/chess/${id}` });
    const reminders = (await scheduled(t)).filter((s) => s.name === "matches:remind");
    const latest = reminders.at(-1)!;
    expect(latest.args[0]).toEqual({ id, moveCount: 1, strikes: 0 });
    expect(latest.scheduledTime - Date.now()).toBeCloseTo(REMINDER_MS, -3);
  });

  test("a reminder only fires if nobody has moved since, and then re-arms", async () => {
    const t = setup();
    const { id, white, black } = await classicGame(t);
    await white.as.mutation(api.chess.move, { id, from: "e2", to: "e4" });
    const before = (await pushes(t)).length;
    await t.mutation(internal.matches.remind, { id, moveCount: 0 });
    expect((await pushes(t)).length).toBe(before);
    await t.mutation(internal.matches.remind, { id, moveCount: 1 });
    expect((await pushes(t)).at(-1)).toMatchObject({ userId: black.userId, title: "Still your move" });
    expect((await scheduled(t)).filter((s) => s.name === "matches:remind" && (s.args[0] as { moveCount: number }).moveCount === 1)).toHaveLength(2);
  });

  test("checkmate ends the game and moves ratings", async () => {
    const t = setup();
    const { id, white, black } = await classicGame(t);
    for (const [who, from, to] of [
      [white, "f2", "f3"],
      [black, "e7", "e5"],
      [white, "g2", "g4"],
      [black, "d8", "h4"],
    ] as const) {
      await who.as.mutation(api.chess.move, { id, from, to });
    }
    const m = (await match(t, id))!;
    expect(m).toMatchObject({ status: "finished", result: { winners: [black.userId], draw: false, reason: "checkmate" } });
    expect(m.turn).toBeUndefined();
    const board = await black.as.query(api.ratings.leaderboard, { mode: "chess:classic" });
    expect(board.map((r) => [r.userId, r.rating, r.wins, r.losses])).toEqual([
      [black.userId, 1216, 1, 0],
      [white.userId, 1184, 0, 1],
    ]);
    await expect(white.as.mutation(api.chess.move, { id, from: "a2", to: "a3" })).rejects.toThrow("over");
  });

  test("promotion needs a piece and works", async () => {
    const t = setup();
    const { id, white } = await classicGame(t);
    // Put a white pawn on b7 with b8 free.
    await t.run(async (ctx) => {
      const m = (await ctx.db.get(id))!;
      await ctx.db.patch(id, { state: { ...(m.state as ClassicState), fen: "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1" } });
    });
    await white.as.mutation(api.chess.move, { id, from: "b7", to: "b8", promotion: "n" });
    expect(((await match(t, id))!.state as ClassicState).moves.at(-1)?.san).toBe("b8=N");
  });

  test("resigning gives the other player the win", async () => {
    const t = setup();
    const { id, white, black } = await classicGame(t);
    await white.as.mutation(api.matches.resign, { id });
    expect((await match(t, id))?.result).toEqual({ winners: [black.userId], draw: false, reason: "resign" });
  });

  test("a draw needs both players to agree, and a move withdraws the offer", async () => {
    const t = setup();
    const { id, white, black } = await classicGame(t);
    await white.as.mutation(api.matches.offerDraw, { id });
    expect((await match(t, id))?.drawOffer).toBe(white.userId);
    await white.as.mutation(api.chess.move, { id, from: "e2", to: "e4" });
    expect((await match(t, id))?.drawOffer).toBeUndefined();
    await black.as.mutation(api.matches.offerDraw, { id });
    await black.as.mutation(api.matches.declineDraw, { id });
    expect((await match(t, id))?.drawOffer).toBe(black.userId);
    await white.as.mutation(api.matches.declineDraw, { id });
    expect((await match(t, id))?.drawOffer).toBeUndefined();
    await black.as.mutation(api.matches.offerDraw, { id });
    await white.as.mutation(api.matches.offerDraw, { id });
    expect((await match(t, id))?.result).toEqual({ winners: [], draw: true, reason: "agreement" });
    const ratings = await white.as.query(api.ratings.leaderboard, { mode: "chess:classic" });
    expect(ratings.every((r) => r.rating === 1200 && r.draws === 1)).toBe(true);
  });

  test("someone outside the game can't move or resign", async () => {
    const t = setup();
    const { id } = await classicGame(t);
    const c = await signedIn(t, "Boiler");
    await expect(c.as.mutation(api.chess.move, { id, from: "e2", to: "e4" })).rejects.toThrow("not playing");
    await expect(c.as.mutation(api.matches.resign, { id })).rejects.toThrow();
  });

  test("attention counts games waiting on you", async () => {
    const t = setup();
    const { id, white, black } = await classicGame(t);
    expect(await white.as.query(api.matches.attention, {})).toMatchObject({ myTurn: 1 });
    expect(await black.as.query(api.matches.attention, {})).toMatchObject({ myTurn: 0 });
    await white.as.mutation(api.chess.move, { id, from: "e2", to: "e4" });
    expect(await black.as.query(api.matches.attention, {})).toMatchObject({ myTurn: 1 });
  });
});

describe("real-time chess", () => {
  async function realtimeGame(t: T) {
    const { a, b } = await twoPlayers(t);
    const id = await a.as.mutation(api.matches.queue, { mode: "chess:realtime" });
    await b.as.mutation(api.matches.queue, { mode: "chess:realtime" });
    const m = (await match(t, id))!;
    const whiteId = m.players.find((p) => p.color === "w")!.userId;
    const [white, black] = whiteId === a.userId ? [a, b] : [b, a];
    return { id, white, black };
  }
  async function started(t: T) {
    const g = await realtimeGame(t);
    await g.white.as.mutation(api.chess.ready, { id: g.id });
    await g.black.as.mutation(api.chess.ready, { id: g.id });
    const startAt = ((await match(t, g.id))!.state as RealtimeState).startAt!;
    return { ...g, startAt, serverTick: () => Math.floor((Date.now() - startAt) / TICK_MS) };
  }
  const commands = (t: T, id: Id<"matches">) => t.run((ctx) => ctx.db.query("rtCommands").withIndex("by_match_tick", (q) => q.eq("matchId", id)).collect());

  test("the clock starts only when both players are on the board, then the ticker runs", async () => {
    const t = setup();
    const { id, white, black } = await realtimeGame(t);
    await white.as.mutation(api.chess.ready, { id });
    expect(((await match(t, id))!.state as RealtimeState).startAt).toBeNull();
    await black.as.mutation(api.chess.ready, { id });
    const startAt = ((await match(t, id))!.state as RealtimeState).startAt!;
    expect(Math.abs(startAt - (Date.now() + REALTIME_COUNTDOWN_MS))).toBeLessThan(50);
    expect((await scheduled(t)).some((s) => s.name === "chess:rtTick")).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("rtSnapshots").collect())).toHaveLength(1);
  });

  test("moves wait for the countdown", async () => {
    const t = setup();
    const { id, white } = await started(t);
    await expect(white.as.mutation(api.chess.rtMove, { id, pieceId: 12, toX: 4, toY: 3, clientTick: 0 })).rejects.toThrow("countdown");
  });

  test("moves keep the tick the player acted on, within the lag window", async () => {
    const t = setup();
    const g = await started(t);
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 100 * TICK_MS);
    const now = g.serverTick();
    expect(await g.white.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 12, toX: 4, toY: 3, clientTick: now - 5 })).toBe(now - 5);
    // Too far in the past is pulled up to the edge of the window; the future is capped too.
    expect(await g.black.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 28, toX: 4, toY: 4, clientTick: now - 500 })).toBe(now - MAX_LAG_TICKS);
    expect(await g.black.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 27, toX: 3, toY: 4, clientTick: now + 500 })).toBeLessThanOrEqual(now + 3);
    expect((await commands(t, g.id)).map((c) => [c.color, c.tick])).toEqual([["b", now - MAX_LAG_TICKS], ["w", now - 5], ["b", expect.any(Number)]]);
  });

  test("moving never writes the match, so two players moving at once can't collide", async () => {
    const t = setup();
    const g = await started(t);
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 30 * TICK_MS);
    const before = await match(t, g.id);
    await Promise.all([
      g.white.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 12, toX: 4, toY: 3, clientTick: g.serverTick() }),
      g.black.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 28, toX: 4, toY: 4, clientTick: g.serverTick() }),
    ]);
    expect(await match(t, g.id)).toEqual(before);
    expect(await commands(t, g.id)).toHaveLength(2);
  });

  test("only players can move, and only on the board", async () => {
    const t = setup();
    const g = await started(t);
    const c = await signedIn(t, "Boiler");
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 30 * TICK_MS);
    await expect(c.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 12, toX: 4, toY: 3, clientTick: 30 })).rejects.toThrow("not playing");
    await expect(g.white.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 12, toX: 9, toY: 3, clientTick: 30 })).rejects.toThrow("not a square");
  });

  test("rtState hands clients the settled snapshot and every command after it", async () => {
    const t = setup();
    const g = await started(t);
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 30 * TICK_MS);
    await g.white.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 12, toX: 4, toY: 3, clientTick: g.serverTick() });
    vi.advanceTimersByTime(3000);
    await t.mutation(internal.chess.rtTick, { id: g.id });
    const view = (await g.black.as.query(api.chess.rtState, { id: g.id }))!;
    expect(view.snapshot!.tick).toBe(g.serverTick() - MAX_LAG_TICKS - 2);
    expect(view.commands).toEqual([]);
    expect(view.snapshot!.pieces.find((p: { id: number }) => p.id === 12)).toMatchObject({ x: 4, y: 3 });
  });

  test("the ticker finishes the game once taking the king can't be undone", async () => {
    const t = setup();
    const g = await started(t);
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 1);
    // e4, queen to h5, queen takes f7, queen takes the king on e8, with waits for travel and cooldown.
    const play = async (pieceId: number, toX: number, toY: number) => {
      await g.white.as.mutation(api.chess.rtMove, { id: g.id, pieceId, toX, toY, clientTick: g.serverTick() });
      vi.advanceTimersByTime(10_000);
    };
    await play(12, 4, 3);
    await play(3, 7, 4);
    await play(3, 5, 6);
    await play(3, 4, 7);
    await t.mutation(internal.chess.rtTick, { id: g.id });
    const m = (await match(t, g.id))!;
    expect(m).toMatchObject({ status: "finished", result: { winners: [g.white.userId], draw: false, reason: "king" } });
    await expect(g.black.as.mutation(api.chess.rtMove, { id: g.id, pieceId: 28, toX: 4, toY: 4, clientTick: g.serverTick() })).rejects.toThrow("over");
  });

  test("the ticker keeps going while the game is live", async () => {
    const t = setup();
    const g = await started(t);
    vi.advanceTimersByTime(REALTIME_COUNTDOWN_MS + 2000);
    await t.mutation(internal.chess.rtTick, { id: g.id });
    const pending = (await scheduled(t)).filter((s) => s.name === "chess:rtTick" && s.state.kind === "pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect((await match(t, g.id))!.status).toBe("active");
  });
});
