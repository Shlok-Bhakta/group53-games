import { v } from "convex/values";
import { Chess } from "chess.js";
import { internalQuery } from "./_generated/server";
import { CELL, TICK_MS, positionAt, simulate, type Command, type State } from "./chess/realtime";
import { DEFAULT_PROFILE } from "./profileOptions";
import { SIZE as SIZE4, onBoard as onBoard4, setup as setup4 } from "./chess/four/board";
import type { FourState } from "./chess/four/classic";

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

// The board and players of a game, for its link preview. Real-time games are simulated up to now.
export const match = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const matchId = ctx.db.normalizeId("matches", id);
    if (!matchId) return null;
    const m = await ctx.db.get(matchId);
    if (!m) return null;
    const players = await Promise.all(
      m.players.map(async (p) => {
        const u = await ctx.db.get(p.userId);
        return { userId: p.userId, name: u?.name ?? "Player", image: u?.image ?? null, color: p.color ?? null };
      }),
    );
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
      const snap = await ctx.db.query("rtSnapshots").withIndex("by_match", (q) => q.eq("matchId", matchId)).unique();
      const from = (snap?.state as State | undefined) ?? undefined;
      const rows = await ctx.db
        .query("rtCommands")
        .withIndex("by_match_tick", (q) => q.eq("matchId", matchId).gte("tick", from?.tick ?? 0))
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
    const winners = m.result?.winners ?? [];
    return {
      mode: m.mode,
      status: m.status,
      seats: four ? 4 : 2,
      points: m.state?.kind === "four" ? (m.state as FourState).points : null,
      players,
      board,
      toMove,
      moveCount: m.moveCount,
      result: m.result
        ? { draw: m.result.draw, reason: m.result.reason, winner: players.filter((p) => winners.includes(p.userId)).map((p) => p.name).join(" and ") || null }
        : null,
    };
  },
});
