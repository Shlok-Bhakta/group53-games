import type { PreviewBoard } from "../previews";
import { potOf, type PokerState } from "./engine";

export const pokerPreview: PreviewBoard = async (_ctx, m, players) => {
  const st = m.state as PokerState | null;
  return {
    seats: m.players.length,
    points: null,
    board: [],
    toMove: m.status === "active" && st && st.turn >= 0 ? (players[st.turn]?.color ?? null) : null,
    poker: st
      ? {
          hand: st.hand,
          board: st.board,
          stacks: st.stacks,
          pot: m.status === "active" ? potOf(st) + st.bets.reduce((a, b) => a + b, 0) : 0,
          out: st.out.map((o) => o.seat),
        }
      : null,
  };
};
