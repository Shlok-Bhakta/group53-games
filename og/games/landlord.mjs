import { BOARD_SHADOW, LANDLORD, SEAT_COLORS } from "../palette.mjs";
import { h, tiles } from "../layout.mjs";
import { moverName, scoreText, seatsSoFar } from "../match.mjs";

const SQUARES = 40;
const SIDE_SQUARES = 11;
const HOTEL = 5;
const FOR_SALE = -1;
const UNBUYABLE = -2;
const TITLE_STATES = ["green", "yellow", "green", "gray", "green", "yellow", "green", "hit"];

const squareAt = (i) => (i <= 10 ? [10 - i, 10] : i <= 20 ? [0, 20 - i] : i <= 30 ? [i - 20, 0] : [10, i - 30]);

function squareColor(owner, colors) {
  if (owner >= 0) return SEAT_COLORS[colors[owner]] ?? LANDLORD.unknownOwner;
  return owner === FOR_SALE ? LANDLORD.forSale : LANDLORD.unbuyable;
}

export const landlord = {
  key: "landlord",
  paths: ["/landlord"],
  page: { title: "Monopoly", description: "Buy streets, build hotels, trade and bankrupt each other, 2 to 8 of you over a few days." },
  card: { word: "MONOPOLY", states: TITLE_STATES, tileSize: 104, blurb: "Buy streets, build hotels, bankrupt your friends." },
  modeTitles: { "landlord:classic": "Monopoly" },
  text(m, { names, title }) {
    if (m.status === "waiting") return { title: `${names[0]} wants a game of Monopoly`, status: seatsSoFar(m) };
    if (m.status === "finished") return { title, status: `${m.result.winner ?? "Someone"} won ${m.result.how || ""}`.trim() + "." };
    return { title, status: `Round ${m.landlord?.round ?? 1}. ${moverName(m)} to move.` };
  },
  board(m, { side }) {
    const l = m.landlord;
    const colors = m.players.map((p) => p.color);
    const cell = side / SIDE_SQUARES;
    const squares = (l?.owners ?? Array(SQUARES).fill(UNBUYABLE)).map((owner, i) => {
      const [x, y] = squareAt(i);
      const houses = l?.houses?.[i] ?? 0;
      return h(
        "div",
        {
          position: "absolute",
          left: x * cell + 1,
          top: y * cell + 1,
          width: cell - 2,
          height: cell - 2,
          borderRadius: 4,
          background: squareColor(owner, colors),
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
        },
        houses === HOTEL
          ? h("div", {
              width: cell * 0.5,
              height: cell * 0.22,
              borderRadius: 3,
              background: LANDLORD.hotel,
              border: `2px solid ${LANDLORD.buildingEdge}`,
            })
          : Array.from({ length: houses }, () =>
              h("div", {
                width: cell * 0.14,
                height: cell * 0.14,
                borderRadius: 2,
                background: LANDLORD.house,
                border: `1.5px solid ${LANDLORD.buildingEdge}`,
              }),
            ),
      );
    });
    return h(
      "div",
      {
        position: "relative",
        width: side,
        height: side,
        flexShrink: 0,
        borderRadius: 18,
        background: LANDLORD.board,
        boxShadow: BOARD_SHADOW,
      },
      ...squares,
      h(
        "div",
        {
          position: "absolute",
          left: cell,
          top: cell,
          width: cell * 9,
          height: cell * 9,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        },
        tiles("MONOPOLY", TITLE_STATES, 40),
        h("div", { fontSize: 34, fontWeight: 800, color: LANDLORD.ink }, l ? `Round ${l.round}` : "Waiting"),
      ),
    );
  },
  seatScore: (m, i) =>
    m.landlord && m.status !== "waiting"
      ? scoreText(m.landlord.out[i] ? "bankrupt" : `$${(m.landlord.cash[i] ?? 0).toLocaleString("en-US")}`)
      : undefined,
  version: (m) => [m.landlord?.round ?? 0],
};
