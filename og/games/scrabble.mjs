import { SCRABBLE, SEAT_COLORS } from "../palette.mjs";
import { h } from "../layout.mjs";
import { LIVE_NOW, moverName, scoreText, seatsSoFar } from "../match.mjs";

const PREMIUM_LABEL = { T: "3W", D: "2W", "*": "★", t: "3L", d: "2L" };

function wantsText(mode) {
  return mode.toLowerCase().replace("live scrabble", "live Scrabble").replace("scrabble", "Scrabble");
}

export const scrabble = {
  key: "scrabble",
  paths: ["/scrabble"],
  page: {
    title: "Scrabble",
    description: "Up to 8 of you on one board, at your own pace or live with a turn timer. Plan your words while you wait.",
  },
  card: {
    word: "SCRABBLE",
    states: Array(8).fill("cream"),
    tileSize: 104,
    blurb: "Up to 8 of you on one board. Plan your words while you wait.",
  },
  modeTitles: { "scrabble:classic": "Scrabble", "scrabble:live": "Live Scrabble" },
  text(m, { names, mode, title }) {
    if (m.status === "waiting") return { title: `${names[0]} wants ${wantsText(mode)}`, status: seatsSoFar(m) };
    if (m.status === "finished") {
      const top = Math.max(...m.scrabble.scores);
      return { title, status: m.result.draw ? `Tied on ${top}.` : `${m.result.winner} won with ${top} points.` };
    }
    if (m.toMove) {
      const last = m.scrabble.last ? ` Last word: ${m.scrabble.last.word} for ${m.scrabble.last.score}.` : "";
      return { title, status: `${moverName(m)} to play.${last}` };
    }
    return { title, status: LIVE_NOW };
  },
  board(m, { side }) {
    const s = m.scrabble;
    const colors = m.players.map((p) => p.color);
    const cell = side / s.size;
    const at = new Map(s.tiles.map((t) => [`${t.x},${t.y}`, t]));
    const rows = [];
    for (let y = 0; y < s.size; y++) {
      const cells = [];
      for (let x = 0; x < s.size; x++) {
        const t = at.get(`${x},${y}`);
        const premium = s.premium[y][x];
        cells.push(
          h(
            "div",
            { width: cell, height: cell, padding: 1, flexShrink: 0 },
            t
              ? h(
                  "div",
                  {
                    width: "100%",
                    height: "100%",
                    borderRadius: cell * 0.16,
                    background: SCRABBLE.tile,
                    color: t.blank ? SCRABBLE.blankInk : SCRABBLE.ink,
                    fontSize: cell * 0.6,
                    fontWeight: 800,
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: `inset 0 -${Math.max(2, cell * 0.08)}px 0 ${SEAT_COLORS[colors[t.seat]] ?? SCRABBLE.edge}`,
                  },
                  t.letter,
                )
              : h(
                  "div",
                  {
                    width: "100%",
                    height: "100%",
                    borderRadius: 2,
                    background: SCRABBLE.premium[premium] ?? SCRABBLE.square,
                    color: SCRABBLE.squareInk,
                    fontSize: cell * 0.34,
                    fontWeight: 800,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  PREMIUM_LABEL[premium] ?? "",
                ),
          ),
        );
      }
      rows.push(h("div", { flexDirection: "row" }, cells));
    }
    return h(
      "div",
      {
        width: side,
        height: side,
        flexShrink: 0,
        flexDirection: "column",
        borderRadius: 10,
        overflow: "hidden",
        background: SCRABBLE.board,
      },
      rows,
    );
  },
  seatScore: (m, i) => (m.status !== "waiting" ? scoreText(`${m.scrabble.scores[i] ?? 0} pts`) : undefined),
  version: (m) => [m.scrabble?.tiles.length ?? 0],
};
