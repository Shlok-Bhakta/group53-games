import { v } from "convex/values";
import { Chess } from "chess.js";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { gameOf, isMode, reasonOf, type GameKey } from "./modes";
import { person } from "./lib/people";
import { CELL, TICK_MS, positionAt, simulate, type Command, type State } from "./chess/realtime";
import { DEFAULT_PROFILE } from "./profileOptions";
import { SIZE as SIZE4, onBoard as onBoard4, setup as setup4 } from "./chess/four/board";
import type { FourState } from "./chess/four/classic";
import { layout, type ScrabbleState } from "./scrabble/engine";
import { potOf, type PokerState } from "./poker/engine";
import { parSoFar, totals, type GolfState } from "./golf/round";
import { BOARD, BUYABLE } from "./landlord/board";
import { actor, worth, type MonoState } from "./landlord/engine";

// Read by the og/ preview service with the admin key, so none of this is public.
export const crew = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const profiles = new Map((await ctx.db.query("profiles").collect()).map((p) => [p.userId, p]));
    return users
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((u) => {
        const p = profiles.get(u._id);
        return {
          name: u.name ?? "Player",
          image: u.image ?? null,
          frame: p?.frame ?? DEFAULT_PROFILE.frame,
          frameColor: p?.frameColor ?? DEFAULT_PROFILE.frameColor,
          badge: p?.badge ?? DEFAULT_PROFILE.badge,
        };
      });
  },
});

type Player = { userId: Id<"users">; name: string; image: string | null; color: string | null };
type Board = (ctx: QueryCtx, m: Doc<"matches">, players: Player[]) => Promise<Record<string, unknown>>;

// Each game's board: the part of a preview that differs between games.
const BOARDS: Record<GameKey, Board> = {
  scrabble: async (_ctx, m, players) => {
    const st = m.state as ScrabbleState | null;
    const size = st?.size ?? m.settings?.board ?? 15;
    return {
      seats: m.players.length,
      points: null,
      board: [],
      toMove: m.status === "active" && st ? (players[st.turn]?.color ?? null) : null,
      scrabble: {
        size,
        premium: layout(size),
        tiles: (st?.tiles ?? []).map((t) => ({ x: t.x, y: t.y, letter: t.letter, blank: !!t.blank, seat: t.seat })),
        scores: st?.scores ?? [],
        last: st?.moves.at(-1)?.kind === "play" ? st.moves.at(-1)!.words![0] : null,
      },
    };
  },
  poker: async (_ctx, m, players) => {
    // Only what everyone at the table can see: the board, stacks and the pot. Never anyone's cards.
    const st = m.state as PokerState | null;
    return {
      seats: m.players.length,
      points: null,
      board: [],
      toMove: m.status === "active" && st && st.turn >= 0 ? (players[st.turn]?.color ?? null) : null,
      poker: st ? { hand: st.hand, board: st.board, stacks: st.stacks, pot: m.status === "active" ? potOf(st) + st.bets.reduce((a, b) => a + b, 0) : 0, out: st.out.map((o) => o.seat) } : null,
    };
  },
  golf: async (_ctx, m, players) => {
    const st = m.state as GolfState | null;
    const hole = st && st.hole >= 0 ? st.holes[st.hole] : null;
    const t = st ? totals(st, m.players.length) : [];
    return {
      seats: m.players.length,
      points: null,
      board: [],
      toMove: m.status === "active" && m.turn ? (players.find((p) => p.userId === m.turn)?.color ?? null) : null,
      golf: st
        ? { hole: st.hole + 1, total: st.total, name: hole?.name ?? null, par: hole?.par ?? null, theme: hole?.theme ?? "hills", totals: t, par0: parSoFar(st), played: st.scores.length, out: st.out, last: st.last ?? null, seed: m.settings?.seed ?? null }
        : null,
    };
  },
  landlord: async (_ctx, m, players) => {
    // Everyone's cash and worth, and who owns which squares (in their seat's color), all public in the game.
    const st = m.state as MonoState | null;
    return {
      seats: m.players.length,
      points: null,
      board: [],
      toMove: m.status === "active" && st && st.phase.k !== "over" ? (players[actor(st)]?.color ?? null) : null,
      landlord: st
        ? {
            round: st.round,
            cash: st.players.map((p) => p.cash),
            worth: st.players.map((_, i) => worth(st, i)),
            out: st.players.map((p) => p.out),
            owners: BOARD.map((_, i) => (BUYABLE.includes(i) ? st.props[i]!.owner : -2)),
            houses: BOARD.map((_, i) => st.props[i]?.houses ?? 0),
          }
        : null,
    };
  },
  chess: async (ctx, m) => {
    // Rows top first (rank 8, or 14, at the top, as red or white sees it). Each square is a piece code
    // ("wK", "four/redQ", "four/deadP"), "" when empty, or null when it isn't part of the board (the
    // four-player board's cut corners).
    const four = m.mode === "chess:four" || m.mode === "chess:realtime4";
    const size = four ? SIZE4 : 8;
    let board: (string | null)[][] = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => (four && !onBoard4(c, size - 1 - r) ? null : "")));
    const code = (color: string, kind: string, dead?: boolean) => (four ? `four/${dead ? "dead" : color}${kind}` : `${color}${kind}`);
    const place = (x: number, y: number, c: string) => {
      if (board[size - 1 - y]?.[x] === "") board[size - 1 - y][x] = c;
    };
    let toMove: string | null = null;
    if (m.state?.kind === "classic") {
      const chess = new Chess(m.state.fen);
      board = chess.board().map((row) => row.map((p) => (p ? `${p.color}${p.type.toUpperCase()}` : "")));
      toMove = m.status === "active" ? chess.turn() : null;
    } else if (m.state?.kind === "four") {
      const state = m.state as FourState;
      for (const p of state.pieces) place(p.x, p.y, code(p.color, p.kind, p.dead));
      toMove = m.status === "active" ? state.turn : null;
    } else if (m.state?.kind === "realtime" && m.state.startAt !== null) {
      const tick = Math.max(0, Math.floor((Date.now() - m.state.startAt) / TICK_MS));
      const snap = await ctx.db.query("rtSnapshots").withIndex("by_match", (q) => q.eq("matchId", m._id)).unique();
      const from = (snap?.state as State | undefined) ?? undefined;
      const rows = await ctx.db
        .query("rtCommands")
        .withIndex("by_match_tick", (q) => q.eq("matchId", m._id).gte("tick", from?.tick ?? 0))
        .collect();
      const commands: Command[] = [...((m.state.commands ?? []) as Command[]), ...rows.map((r) => ({ tick: r.tick, color: r.color, pieceId: r.pieceId, toX: r.toX, toY: r.toY, kind: r.kind }))];
      const sim = simulate(commands, tick, m.state.commands?.length ? undefined : (from ?? (four ? "four" : "two")));
      for (const p of sim.pieces) {
        const pos = positionAt(p, sim.result ? sim.endTick! : tick);
        place(Math.round(pos.x / CELL), Math.round(pos.y / CELL), code(p.color, p.kind, p.dead));
      }
    } else if (m.state?.kind === "realtime" || (four && m.status === "waiting")) {
      if (four) for (const p of setup4()) place(p.x, p.y, code(p.color, p.kind));
      else board = new Chess().board().map((row) => row.map((p) => (p ? `${p.color}${p.type.toUpperCase()}` : "")));
    }
    return { seats: four ? 4 : 2, points: m.state?.kind === "four" ? (m.state as FourState).points : null, board, toMove };
  },
};

// The board and players of a game, for its link preview. Real-time games are simulated up to now.
export const match = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const matchId = ctx.db.normalizeId("matches", id);
    if (!matchId) return null;
    const m = await ctx.db.get(matchId);
    if (!m || !isMode(m.mode)) return null;
    const players: Player[] = await Promise.all(
      m.players.map(async (p) => {
        const { name, image } = await person(ctx, p.userId);
        return { userId: p.userId, name, image, color: p.color ?? null };
      }),
    );
    const winners = m.result?.winners ?? [];
    return {
      mode: m.mode,
      status: m.status,
      players,
      moveCount: m.moveCount,
      ...(await BOARDS[gameOf(m.mode)](ctx, m, players)),
      result: m.result
        ? { draw: m.result.draw, reason: m.result.reason, how: reasonOf(m.result.reason, m.mode).won ?? "", winner: players.filter((p) => winners.includes(p.userId)).map((p) => p.name).join(" and ") || null }
        : null,
    };
  },
});
