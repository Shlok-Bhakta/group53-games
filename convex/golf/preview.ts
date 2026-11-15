import type { PreviewBoard } from "../previews";
import { parSoFar, totals, type GolfState } from "./round";

export const golfPreview: PreviewBoard = async (_ctx, m, players) => {
  const st = m.state as GolfState | null;
  const hole = st && st.hole >= 0 ? st.holes[st.hole] : null;
  const t = st ? totals(st, m.players.length) : [];
  return {
    seats: m.players.length,
    points: null,
    board: [],
    toMove: m.status === "active" && m.turn ? (players.find((p) => p.userId === m.turn)?.color ?? null) : null,
    golf: st
      ? {
          hole: st.hole + 1,
          total: st.total,
          name: hole?.name ?? null,
          par: hole?.par ?? null,
          theme: hole?.theme ?? "hills",
          totals: t,
          par0: parSoFar(st),
          played: st.scores.length,
          out: st.out,
          last: st.last ?? null,
          seed: m.settings?.seed ?? null,
        }
      : null,
  };
};
