import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Chess } from "chess.js";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { finish, loadMatch, opponentsOf, scheduleReminder } from "./matches";
import { MODES, REALTIME_COUNTDOWN_MS, matchPath, settingsOf, type ModeKey } from "./modes";
import { displayName, notify } from "./notify";
import type { GameHooks } from "./games";
import { TICK_MS, initialState as initialRtState, paceFromSettings, simulate, type Color, type Command, type State, type Variant } from "./chess/realtime";
import { COLORS4, SIZE as SIZE4, type Color4 } from "./chess/four/board";
import { initialFour, move4, retire4, type FourState } from "./chess/four/classic";

// --- State shapes stored in matches.state ---

export type ClassicState = {
  kind: "classic";
  fen: string;
  // Every move, oldest first. `lan` is from+to(+promotion), e.g. "e7e8q".
  moves: { san: string; lan: string; at: number }[];
};

export type RealtimeState = {
  kind: "realtime";
  // Players who have opened the board; the clock starts when everyone has.
  ready: Id<"users">[];
  // Wall-clock time of tick 0 on the server.
  startAt: number | null;
  // Only on games from before commands moved to the rtCommands table.
  commands?: Command[];
};

export type { FourState } from "./chess/four/classic";

export function initialState(mode: ModeKey): ClassicState | RealtimeState | FourState {
  if (MODES[mode].kind === "realtime") return { kind: "realtime", ready: [], startAt: null };
  if (mode === "chess:four") return initialFour();
  return { kind: "classic", fen: new Chess().fen(), moves: [] };
}

// Colors in seat order: the first one moves first.
export const seatColors = (mode: ModeKey): readonly string[] => (MODES[mode].board === "four" ? COLORS4 : ["w", "b"]);
export const variantOf = (mode: string): Variant => (MODES[mode as ModeKey]?.board === "four" ? "four" : "two");
const REALTIME_MODES: ModeKey[] = ["chess:realtime", "chess:realtime4"];
const isRealtime = (mode: string) => REALTIME_MODES.includes(mode as ModeKey);

const colorOf = (match: Doc<"matches">, userId: Id<"users">) => match.players.find((p) => p.userId === userId)?.color as Color | undefined;
const playerWith = (match: Doc<"matches">, color: Color) => match.players.find((p) => p.color === color)!.userId;
const COLOR_NAMES: Record<string, string> = { w: "white", b: "black", red: "red", blue: "blue", yellow: "yellow", green: "green" };

const paceOfMatch = (match: Doc<"matches">) => paceFromSettings(settingsOf(match.mode, match.settings));

export const chessHooks: GameHooks = {
  seats: (mode) => seatColors(mode),
  start: async (ctx, match) => {
    const state = initialState(match.mode as ModeKey);
    await ctx.db.patch(match._id, { state });
    await onStart(ctx, { ...match, state });
  },
  resign: async (ctx, match, userId) => {
    if (match.mode === "chess:four") return await retireFour(ctx, match, userId, "resign");
    if (match.mode === "chess:realtime4") {
      // Before the clock starts there's no game to leave behind, so it's called off for everyone.
      if (!(await resignRealtime4(ctx, match, userId))) await ctx.db.patch(match._id, { status: "cancelled", lastActivityAt: Date.now() });
      return;
    }
    await finish(ctx, match, { winners: opponentsOf(match, userId), draw: false, reason: "resign" });
  },
  timeout: async (ctx, match, userId) => {
    if (match.mode === "chess:four") return await retireFour(ctx, match, userId, "timeout");
    await finish(ctx, match, { winners: opponentsOf(match, userId), draw: false, reason: "timeout" });
  },
  timeoutWarning: "or you time out",
};

// Called once every seat is filled.
export async function onStart(ctx: MutationCtx, match: Doc<"matches">) {
  if (match.mode === "chess:classic") {
    const white = playerWith(match, "w");
    await ctx.db.patch(match._id, { turn: white });
    // Rematches start with both players on the page already, so they don't need a push.
    if (!match.rematchOf) {
      const black = await displayName(ctx, playerWith(match, "b"));
      await notify(ctx, white, { title: "You're white", body: `Your move against ${black}.`, url: matchPath(match), tag: `match:${match._id}` });
    }
    await scheduleReminder(ctx, match._id, 0);
  }
  if (match.mode === "chess:four") {
    const red = playerWith(match, "red");
    await ctx.db.patch(match._id, { turn: red });
    if (!match.rematchOf) {
      for (const p of match.players) {
        const color = COLOR_NAMES[p.color!];
        await notify(ctx, p.userId, {
          title: p.userId === red ? "You're red. Your move" : `You're ${color}`,
          body: p.userId === red ? "4-player chess is on and red goes first." : "4-player chess is on. Red goes first, then clockwise.",
          url: matchPath(match),
          tag: `match:${match._id}`,
        });
      }
    }
    await scheduleReminder(ctx, match._id, 0);
  }
}

async function playerIn(ctx: MutationCtx, id: Id<"matches">, mode: ModeKey | "realtime") {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  const match = await loadMatch(ctx, id);
  if (mode === "realtime" ? !isRealtime(match.mode) : match.mode !== mode) throw new Error("Wrong kind of game.");
  if (match.status !== "active") throw new Error("This game is over.");
  const color = colorOf(match, userId);
  if (!color) throw new Error("You're not playing in this game.");
  return { userId, match, color };
}

// --- Classic ---

export const move = mutation({
  args: { id: v.id("matches"), from: v.string(), to: v.string(), promotion: v.optional(v.string()) },
  handler: async (ctx, { id, from, to, promotion }) => {
    const { userId, match, color } = await playerIn(ctx, id, "chess:classic");
    const state = match.state as ClassicState;
    const chess = new Chess(state.fen);
    if (chess.turn() !== color) throw new Error("It's not your move.");
    let played;
    try {
      played = chess.move({ from, to, promotion: promotion as "q" | "r" | "b" | "n" | undefined });
    } catch {
      throw new Error("That move isn't legal.");
    }
    const now = Date.now();
    const next: ClassicState = { kind: "classic", fen: chess.fen(), moves: [...state.moves, { san: played.san, lan: played.lan, at: now }] };
    const opponent = playerWith(match, color === "w" ? "b" : "w");
    const moveCount = match.moveCount + 1;
    await ctx.db.patch(id, { state: next, moveCount, turn: opponent, drawOffer: undefined, lastActivityAt: now });
    const updated = { ...match, state: next, moveCount, turn: opponent };

    const end = classicEnding(chess);
    if (end) {
      await finish(ctx, updated, end.draw ? { winners: [], draw: true, reason: end.reason } : { winners: [userId], draw: false, reason: end.reason });
      return;
    }
    const name = await displayName(ctx, userId);
    await notify(ctx, opponent, {
      title: chess.inCheck() ? `${name} played ${played.san}. Check!` : `${name} played ${played.san}`,
      body: "Your move.",
      url: matchPath(match),
      tag: `match:${id}`,
    });
    await scheduleReminder(ctx, id, moveCount);
  },
});

export function classicEnding(chess: Chess): { draw: boolean; reason: string } | null {
  if (chess.isCheckmate()) return { draw: false, reason: "checkmate" };
  if (chess.isStalemate()) return { draw: true, reason: "stalemate" };
  if (chess.isInsufficientMaterial()) return { draw: true, reason: "insufficient" };
  if (chess.isThreefoldRepetition()) return { draw: true, reason: "repetition" };
  if (chess.isDrawByFiftyMoves()) return { draw: true, reason: "fifty" };
  return null;
}

// --- Four-player (turn-based) ---

export const fourMove = mutation({
  args: { id: v.id("matches"), fromX: v.number(), fromY: v.number(), toX: v.number(), toY: v.number() },
  handler: async (ctx, { id, fromX, fromY, toX, toY }) => {
    const { userId, match, color } = await playerIn(ctx, id, "chess:four");
    const state = match.state as FourState;
    if (state.turn !== color) throw new Error("It's not your move.");
    const next = move4(state, [fromX, fromY], [toX, toY]);
    if (!next) throw new Error("That move isn't legal.");
    await applyFour(ctx, match, next, userId);
  },
});

// Saves a new four-player position, then tells whoever is affected: the next player, anyone just
// knocked out, and everyone when it's over.
async function applyFour(ctx: MutationCtx, match: Doc<"matches">, next: FourState, actor: Id<"users">) {
  const before = match.state as FourState;
  const now = Date.now();
  const moveCount = match.moveCount + 1;
  const turn = next.turn ? playerWith(match, next.turn) : undefined;
  await ctx.db.patch(match._id, { state: next, moveCount, turn, lastActivityAt: now });
  const updated = { ...match, state: next, moveCount, turn };

  const url = matchPath(match);
  const tag = `match:${match._id}`;
  const name = await displayName(ctx, actor);
  if (next.result) {
    const standings = next.result.standings.map((g) => g.map((c) => playerWith(match, c)));
    await finish(ctx, updated, { winners: standings[0], draw: false, reason: next.result.reason, standings });
    return;
  }
  const lastMove = next.moves.length > before.moves.length ? next.moves.at(-1) : undefined;
  const retired = next.out.slice(before.out.length).find((o) => playerWith(match, o.color) === actor);
  for (const o of next.out.slice(before.out.length)) {
    const who = playerWith(match, o.color);
    if (o.reason === "resign") continue;
    const why = o.reason === "checkmate" ? "You were checkmated" : o.reason === "stalemate" ? "You're stalemated: +20" : "You timed out";
    await notify(ctx, who, { title: why, body: "Your army is grey now. Stick around to see who wins.", url, tag });
  }
  if (turn && turn !== before.turn && turn !== actor) {
    const checked = lastMove?.checks.includes(next.turn!);
    await notify(ctx, turn, {
      title: lastMove ? `${name} played ${lastMove.text}${checked ? ". You're in check!" : ""}` : `${name} ${retired?.reason === "timeout" ? "timed out" : "resigned"}`,
      body: "Your move in 4-player chess.",
      url,
      tag,
    });
  }
  await scheduleReminder(ctx, match._id, moveCount);
}

// Resigning or timing out in four-player: the game carries on without you.
export async function retireFour(ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">, reason: "resign" | "timeout") {
  const color = colorOf(match, userId) as Color4 | undefined;
  if (!color) return;
  const state = match.state as FourState;
  const next = retire4(state, color, reason);
  if (next === state) return;
  await applyFour(ctx, match, next, userId);
}

// --- Real-time ---
//
// Moves are inserts into rtCommands, stamped with the tick the player acted on (lag compensation, up to
// MAX_LAG_TICKS back), so the mover's own screen never has to correct itself and the two players never
// write the same document. The server doesn't re-validate moves: the shared engine ignores illegal ones
// identically everywhere. chess:rtTick runs twice a second to advance a settled snapshot and to finish
// the game once its result can no longer change.

export const MAX_LAG_TICKS = 20;
const FUTURE_SLACK_TICKS = 3;
const RT_TICK_MS = 500;

const tickAt = (state: RealtimeState, now: number) => Math.floor((now - state.startAt!) / TICK_MS);

// The board is showing for this player. Once everyone is there, the countdown starts.
export const ready = mutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const { userId, match } = await playerIn(ctx, id, "realtime");
    const state = match.state as RealtimeState;
    if (state.startAt !== null || state.ready.includes(userId)) return;
    const readyIds = [...state.ready, userId];
    const everyone = match.players.every((p) => readyIds.includes(p.userId));
    const startAt = everyone ? Date.now() + REALTIME_COUNTDOWN_MS : null;
    await ctx.db.patch(id, { state: { ...state, ready: readyIds, startAt }, lastActivityAt: Date.now() });
    if (startAt !== null) {
      await ctx.db.insert("rtSnapshots", { matchId: id, state: initialRtState(variantOf(match.mode), paceOfMatch(match)) });
      await ctx.scheduler.runAt(startAt + RT_TICK_MS, internal.chess.rtTick, { id });
    }
  },
});

export const rtMove = mutation({
  args: {
    id: v.id("matches"),
    pieceId: v.number(),
    toX: v.number(),
    toY: v.number(),
    kind: v.optional(v.union(v.literal("move"), v.literal("cancel"))),
    clientTick: v.number(),
  },
  handler: async (ctx, { id, pieceId, toX, toY, kind, clientTick }) => {
    const { match, color } = await playerIn(ctx, id, "realtime");
    const state = match.state as RealtimeState;
    if (state.startAt === null) throw new Error("The game hasn't started yet.");
    const serverTick = tickAt(state, Date.now());
    if (serverTick < 0) throw new Error("Wait for the countdown.");
    const size = variantOf(match.mode) === "four" ? SIZE4 : 8;
    if (![pieceId, toX, toY].every(Number.isInteger) || toX < 0 || toX >= size || toY < 0 || toY >= size) throw new Error("That's not a square.");
    // Honour the tick the player saw, within reason.
    const tick = Math.min(serverTick + FUTURE_SLACK_TICKS, Math.max(serverTick - MAX_LAG_TICKS, Math.floor(clientTick)));
    await ctx.db.insert("rtCommands", { matchId: id, tick, color, pieceId, toX, toY, kind: kind ?? "move" });
    return tick;
  },
});

// Reads commands from `fromTick`, optionally stopping before `beforeTick`. The ticker reads only the
// settled range, which new moves (stamped at least MAX_LAG_TICKS back from now) never land in, so it
// doesn't conflict with them.
async function commandsFrom(ctx: QueryCtx, id: Id<"matches">, fromTick: number, beforeTick?: number): Promise<Command[]> {
  const rows = await ctx.db
    .query("rtCommands")
    .withIndex("by_match_tick", (q) => (beforeTick === undefined ? q.eq("matchId", id).gte("tick", fromTick) : q.eq("matchId", id).gte("tick", fromTick).lt("tick", beforeTick)))
    .collect();
  return rows.map(({ tick, color, pieceId, toX, toY, kind }) => ({ tick, color: color as Color, pieceId, toX, toY, kind }));
}

// Four-player real-time: resigning is a command like any other, so it lands in the same timeline. The
// game goes on for everyone else.
export async function resignRealtime4(ctx: MutationCtx, match: Doc<"matches">, userId: Id<"users">) {
  const state = match.state as RealtimeState;
  const color = colorOf(match, userId);
  if (!color || state.startAt === null) return false;
  const tick = Math.max(0, tickAt(state, Date.now()));
  await ctx.db.insert("rtCommands", { matchId: match._id, tick, color, pieceId: -1, toX: 0, toY: 0, kind: "resign" });
  return true;
}

// What clients replay: the settled snapshot plus every command since. Games from before the command
// table kept their commands on the match itself.
export const rtState = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const match = await ctx.db.get(id);
    if (!match || !isRealtime(match.mode)) return null;
    const variant = variantOf(match.mode);
    const legacy = ((match.state as RealtimeState | null)?.commands ?? []) as Command[];
    if (legacy.length > 0) return { variant, snapshot: null, commands: legacy };
    const snap = await ctx.db
      .query("rtSnapshots")
      .withIndex("by_match", (q) => q.eq("matchId", id))
      .unique();
    const snapshot = (snap?.state as State | undefined) ?? null;
    return { variant, snapshot, commands: await commandsFrom(ctx, id, snapshot?.tick ?? 0) };
  },
});

export const rtTick = internalMutation({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const match = await ctx.db.get(id);
    if (!match || match.status !== "active" || !isRealtime(match.mode)) return;
    const state = match.state as RealtimeState;
    if (state.startAt === null) return;
    const serverTick = tickAt(state, Date.now());
    const snap = await ctx.db
      .query("rtSnapshots")
      .withIndex("by_match", (q) => q.eq("matchId", id))
      .unique();
    const from = (snap?.state as State | undefined) ?? initialRtState(variantOf(match.mode), paceOfMatch(match));
    // Nothing can be stamped earlier than this any more, so everything before it is settled.
    const settledTick = serverTick - MAX_LAG_TICKS - 2;
    const commands = settledTick > from.tick ? await commandsFrom(ctx, id, from.tick, settledTick) : [];
    const settled = settledTick > from.tick ? simulate(commands, settledTick, from) : from;
    if (snap) await ctx.db.patch(snap._id, { state: settled });
    else await ctx.db.insert("rtSnapshots", { matchId: id, state: settled });

    if (settled.result) {
      const { winner, reason, ranking } = settled.result;
      const base = winner ? { winners: [playerWith(match, winner)], draw: false, reason } : { winners: [], draw: true, reason };
      const standings = match.players.length > 2 ? { standings: ranking.map((g) => g.map((c) => playerWith(match, c))) } : {};
      // A four-player game where the last kings fell together shares first place.
      const winners = !winner && standings.standings ? { winners: standings.standings[0] } : {};
      await finish(ctx, match, { ...base, ...standings, ...winners });
      return;
    }
    await ctx.scheduler.runAfter(RT_TICK_MS, internal.chess.rtTick, { id });
  },
});

// Older scheduled jobs still point here.
export const finalize = internalMutation({
  args: { id: v.id("matches") },
  handler: async () => {},
});
