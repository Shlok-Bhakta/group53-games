import type { PreviewBoard } from "../previews";
import { isOutOfHand, type UnoState } from "./engine";

export const unoPreview: PreviewBoard = async (_ctx, m, players) => {
  const st = m.state as UnoState | null;
  return {
    seats: m.players.length,
    points: st && st.rules.goal > 0 ? st.scores : null,
    board: [],
    toMove: m.status === "active" && st && st.turn >= 0 ? (players[st.turn]?.color ?? null) : null,
    uno: st
      ? {
          deck: st.rules.deck,
          hand: st.hand,
          goal: st.rules.goal,
          top: st.top,
          color: st.color,
          dir: st.dir,
          counts: st.counts,
          out: st.counts.map((_, i) => isOutOfHand(st, i)),
          pending: st.pending?.kind === "draw" ? st.pending.amount : 0,
          scores: st.scores,
        }
      : null,
  };
};
