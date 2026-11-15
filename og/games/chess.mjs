import { BOARD_SHADOW, CHESS } from "../palette.mjs";
import { h, img } from "../layout.mjs";
import { LIVE_NOW, moverName } from "../match.mjs";

const PIECES_URL = process.env.PIECES_URL ?? "http://web/pieces";
const PIECE_FETCH_TIMEOUT_MS = 3000;
const CLASSIC_SIZE = 8;
const pieceCache = new Map();

async function pieceImage(code) {
  if (!pieceCache.has(code)) {
    const res = await fetch(`${PIECES_URL}/${code}.svg`, { signal: AbortSignal.timeout(PIECE_FETCH_TIMEOUT_MS) });
    pieceCache.set(code, `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`);
  }
  return pieceCache.get(code);
}

const isRealtime = (m) => m.mode === "chess:realtime" || m.mode === "chess:realtime4";

function waitingStatus(m, seats) {
  const realtime = isRealtime(m);
  if (seats > 2)
    return `${m.players.length} of ${seats} seats taken. ${realtime ? "It starts when everyone's on the board." : "Tap to take one."}`;
  return realtime ? "Waiting for an opponent. It starts the moment you join." : "Waiting for an opponent. Tap to take the other seat.";
}

export const chess = {
  key: "chess",
  paths: ["/chess"],
  page: { title: "Chess", description: "Classic, real-time, and 4-player free-for-all chess. Come take a seat." },
  card: {
    word: "CHESS",
    states: ["green", "yellow", "green", "hit", "green"],
    tileSize: 118,
    blurb: "Classic at your own pace, or real-time with no turns.",
  },
  modeTitles: {
    "chess:classic": "Classic chess",
    "chess:realtime": "Real-time chess",
    "chess:four": "4-player chess",
    "chess:realtime4": "4-player real-time chess",
  },
  text(m, { names, mode, title, seats }) {
    if (m.status === "waiting")
      return { title: m.players.length < 2 ? title : `${names[0]} wants ${mode.toLowerCase()}`, status: waitingStatus(m, seats) };
    if (m.status === "finished")
      return { title, status: m.result.draw ? "Drawn." : `${m.result.winner} won ${m.result.how ?? ""}.`.replace(" .", ".") };
    if (m.toMove) return { title, status: `${moverName(m)} to move. ${m.moveCount} moves in.` };
    return { title, status: LIVE_NOW };
  },
  crowded: (m) => m.board.length > CLASSIC_SIZE,
  async board(m, { side, crowded }) {
    const size = m.board.length;
    const cell = side / size;
    const rows = [];
    for (let r = 0; r < size; r++) {
      const cells = [];
      for (let c = 0; c < size; c++) {
        const code = m.board[r][c];
        const dark = (r + c) % 2 === 1;
        cells.push(
          h(
            "div",
            {
              width: cell,
              height: cell,
              flexShrink: 0,
              background: code === null ? "transparent" : dark ? CHESS.dark : CHESS.light,
              alignItems: "center",
              justifyContent: "center",
            },
            code ? img(await pieceImage(code), cell - 2, cell - 2) : [],
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
        borderRadius: crowded ? 6 : 18,
        overflow: "hidden",
        boxShadow: crowded ? "none" : BOARD_SHADOW,
      },
      rows,
    );
  },
  version: () => [],
};
