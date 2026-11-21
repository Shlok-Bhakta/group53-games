import type { PreviewBoard } from "../previews";
import type { WordleState } from "./engine";

export const wordlePreview: PreviewBoard = async (_ctx, m) => {
  const st = m.state as WordleState | null;
  const last = st?.history.at(-1);
  return {
    seats: m.players.length,
    points: st ? st.players.map((p) => p.solved) : null,
    board: [],
    toMove: null,
    wordle: st
      ? {
          goal: st.rules.goal,
          round: st.round + 1,
          over: st.over,
          solved: st.players.map((p) => p.solved),
          rows: st.players.map((p) => p.rows),
          done: st.players.map((p) => p.done),
          last: last ? { word: st.over ? last.word : null, marks: last.boards.map((b) => b.marks) } : null,
        }
      : null,
  };
};
