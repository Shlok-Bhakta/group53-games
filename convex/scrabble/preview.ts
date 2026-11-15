import type { PreviewBoard } from "../previews";
import { layout, type ScrabbleState } from "./engine";

export const scrabblePreview: PreviewBoard = async (_ctx, m, players) => {
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
};
