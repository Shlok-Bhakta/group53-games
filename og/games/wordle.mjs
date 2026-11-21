import { BOARD_SHADOW, TILE, WORDLE } from "../palette.mjs";
import { h } from "../layout.mjs";
import { scoreText, seatsSoFar } from "../match.mjs";

const MARK = [TILE.gray, TILE.yellow, TILE.green];
const ROWS = 6;

function mini(marks, rows, cell) {
  const gap = Math.max(2, Math.round(cell / 7));
  return h(
    "div",
    { flexDirection: "column", gap },
    ...Array.from({ length: ROWS }, (_, r) =>
      h(
        "div",
        { gap },
        ...Array.from({ length: 5 }, (_, i) => {
          const m = marks?.[r]?.[i];
          const background = m !== undefined ? MARK[Number(m)] : r < rows ? WORDLE.played : WORDLE.empty;
          return h("div", { width: cell, height: cell, borderRadius: Math.round(cell / 6), background });
        }),
      ),
    ),
  );
}

export const wordle = {
  key: "wordle",
  paths: ["/wordle"],
  page: {
    title: "PvP Wordle",
    description: "Everyone gets the same word. Solve it, then spend what you earn messing up someone else's board.",
  },
  card: {
    word: "WORDLE",
    states: ["green", "yellow", "gray", "green", "hit", "green"],
    tileSize: 118,
    blurb: "Same word for everyone. Solve it, then wreck someone else's board.",
    blurbWidth: 900,
    cta: "PvP Wordle",
  },
  modeTitles: { "wordle:classic": "PvP Wordle" },
  text(m, { names, title }) {
    if (m.status === "waiting") return { title: `${names[0]} wants a game of PvP Wordle`, status: seatsSoFar(m) };
    const x = m.wordle;
    if (m.status === "finished") {
      const word = x?.last?.word ? ` The last word was ${x.last.word.toUpperCase()}.` : "";
      return { title, status: `${m.result.winner ?? "Someone"} won ${m.result.how || ""}`.trim() + `.${word}` };
    }
    const done = x ? x.done.filter(Boolean).length : 0;
    return { title, status: `Word ${x?.round ?? 1}, first to ${x?.goal ?? 5}. ${done} of ${m.players.length} done with it.` };
  },
  version: (m) => (m.wordle ? `${m.wordle.round}:${m.wordle.rows.join("")}` : ""),
  seatScore: (m, i) => (m.wordle ? scoreText(`${m.wordle.solved[i]} of ${m.wordle.goal}`) : []),
  board(m, { side }) {
    const x = m.wordle;
    const n = Math.max(1, m.players.length);
    const cols = n <= 2 ? n : n <= 4 ? 2 : 4;
    const lines = Math.ceil(n / cols);
    const pad = 28;
    const cellByW = (side - pad * 2 - (cols - 1) * 26) / cols / 5.9;
    const cellByH = (side - pad * 2 - (lines - 1) * 26) / lines / 7;
    const cell = Math.floor(Math.min(cellByW, cellByH, 52));
    return h(
      "div",
      {
        width: side,
        height: side,
        flexShrink: 0,
        flexWrap: "wrap",
        alignContent: "center",
        justifyContent: "center",
        gap: 26,
        padding: pad,
        borderRadius: 18,
        background: WORDLE.board,
        boxShadow: BOARD_SHADOW,
      },
      ...m.players.map((_, i) => mini(x?.last?.marks?.[i] ?? null, x?.last ? 0 : (x?.rows?.[i] ?? 0), cell)),
    );
  },
};
