import { Chess } from "chess.js";
import type { PreviewBoard } from "../previews";
import { SIZE as SIZE4, onBoard as onBoard4, setup as setup4 } from "./four/board";
import type { FourState } from "./four/classic";
import { CELL, TICK_MS, positionAt, simulate, type Command, type State } from "./realtime";

type Square = string | null;

const OFF_BOARD = null;
const EMPTY = "";

const classicRows = (chess: Chess): Square[][] =>
  chess.board().map((row) => row.map((p) => (p ? `${p.color}${p.type.toUpperCase()}` : EMPTY)));

export const chessPreview: PreviewBoard = async (ctx, m) => {
  const four = m.mode === "chess:four" || m.mode === "chess:realtime4";
  const size = four ? SIZE4 : 8;
  let board: Square[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => (four && !onBoard4(c, size - 1 - r) ? OFF_BOARD : EMPTY)),
  );
  const code = (color: string, kind: string, dead?: boolean) => (four ? `four/${dead ? "dead" : color}${kind}` : `${color}${kind}`);
  const place = (x: number, y: number, c: string) => {
    if (board[size - 1 - y]?.[x] === EMPTY) board[size - 1 - y][x] = c;
  };
  let toMove: string | null = null;
  if (m.state?.kind === "classic") {
    const chess = new Chess(m.state.fen);
    board = classicRows(chess);
    toMove = m.status === "active" ? chess.turn() : null;
  } else if (m.state?.kind === "four") {
    const state = m.state as FourState;
    for (const p of state.pieces) place(p.x, p.y, code(p.color, p.kind, p.dead));
    toMove = m.status === "active" ? state.turn : null;
  } else if (m.state?.kind === "realtime" && m.state.startAt !== null) {
    const tick = Math.max(0, Math.floor((Date.now() - m.state.startAt) / TICK_MS));
    const snap = await ctx.db
      .query("rtSnapshots")
      .withIndex("by_match", (q) => q.eq("matchId", m._id))
      .unique();
    const from = (snap?.state as State | undefined) ?? undefined;
    const rows = await ctx.db
      .query("rtCommands")
      .withIndex("by_match_tick", (q) => q.eq("matchId", m._id).gte("tick", from?.tick ?? 0))
      .collect();
    const commands: Command[] = [
      ...((m.state.commands ?? []) as Command[]),
      ...rows.map((r) => ({ tick: r.tick, color: r.color, pieceId: r.pieceId, toX: r.toX, toY: r.toY, kind: r.kind })),
    ];
    const sim = simulate(commands, tick, m.state.commands?.length ? undefined : (from ?? (four ? "four" : "two")));
    for (const p of sim.pieces) {
      const pos = positionAt(p, sim.result ? sim.endTick! : tick);
      place(Math.round(pos.x / CELL), Math.round(pos.y / CELL), code(p.color, p.kind, p.dead));
    }
  } else if (m.state?.kind === "realtime" || (four && m.status === "waiting")) {
    if (four) for (const p of setup4()) place(p.x, p.y, code(p.color, p.kind));
    else board = classicRows(new Chess());
  }
  return { seats: four ? 4 : 2, points: m.state?.kind === "four" ? (m.state as FourState).points : null, board, toMove };
};
