import type { PreviewBoard } from "../previews";
import { BOARD, BUYABLE } from "./board";
import { actor, worth, type MonoState } from "./engine";

const UNBUYABLE = -2;

export const landlordPreview: PreviewBoard = async (_ctx, m, players) => {
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
          owners: BOARD.map((_, i) => (BUYABLE.includes(i) ? st.props[i]!.owner : UNBUYABLE)),
          houses: BOARD.map((_, i) => st.props[i]?.houses ?? 0),
        }
      : null,
  };
};
