import { BOARD_SHADOW, HEXHAVEN, SEAT_COLORS } from "../palette.mjs";
import { h, img, svgDataUrl } from "../layout.mjs";
import { moverName, scoreText, seatsSoFar } from "../match.mjs";

const TITLE_STATES = ["green", "yellow", "green", "gray", "hit"];
const PAD = 0.8;
const VILLAGE = "M-.17 .13 V-.05 L0 -.21 L.17 -.05 V.13Z";
const TOWN = "M-.26 .16 V-.05 L-.12 -.18 L.02 -.05 V-.09 H.26 V.16Z";

const pts = (list) => list.map(([x, y]) => `${x},${y}`).join(" ");

function svgOf(b, colors, px) {
  const xs = b.hexes.flatMap((x) => x.corners.map((c) => c[0]));
  const ys = b.hexes.flatMap((x) => x.corners.map((c) => c[1]));
  const minX = Math.min(...xs) - PAD;
  const maxX = Math.max(...xs) + PAD;
  const minY = Math.min(...ys) - PAD;
  const maxY = Math.max(...ys) + PAD;
  const side = Math.max(maxX - minX, maxY - minY);
  const vx = (minX + maxX) / 2 - side / 2;
  const vy = (minY + maxY) / 2 - side / 2;
  const seat = (i) => SEAT_COLORS[colors[i]] ?? HEXHAVEN.unknownSeat;
  const hexes = b.hexes
    .map((x) => {
      const fill = x.r < 0 ? HEXHAVEN.desert : HEXHAVEN.terrain[x.r];
      const token = x.n ? `<circle cx="${x.c[0]}" cy="${x.c[1]}" r=".34" fill="${HEXHAVEN.token}"/>` : "";
      return `<polygon points="${pts(x.corners)}" fill="${fill}" stroke="${HEXHAVEN.sand}" stroke-width=".07"/>${token}`;
    })
    .join("");
  const roads = b.roads
    .map((r) => {
      const [ax, ay] = [r.a[0] + (r.b[0] - r.a[0]) * 0.16, r.a[1] + (r.b[1] - r.a[1]) * 0.16];
      const [bx, by] = [r.b[0] + (r.a[0] - r.b[0]) * 0.16, r.b[1] + (r.a[1] - r.b[1]) * 0.16];
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${HEXHAVEN.pieceEdge}" stroke-width=".22" stroke-linecap="round"/><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${seat(r.seat)}" stroke-width=".14" stroke-linecap="round"/>`;
    })
    .join("");
  const spots = b.spots
    .map(
      (s) =>
        `<path d="${s.town ? TOWN : VILLAGE}" transform="translate(${s.c[0]} ${s.c[1]}) scale(1.3)" fill="${seat(s.seat)}" stroke="${HEXHAVEN.pieceEdge}" stroke-width=".04"/>`,
    )
    .join("");
  const bandit = `<circle cx="${b.bandit[0] - 0.46}" cy="${b.bandit[1] - 0.06}" r=".13" fill="${HEXHAVEN.bandit}"/><path d="M${b.bandit[0] - 0.64} ${b.bandit[1] + 0.34} Q${b.bandit[0] - 0.62} ${b.bandit[1] + 0.02} ${b.bandit[0] - 0.46} ${b.bandit[1] + 0.02} Q${b.bandit[0] - 0.3} ${b.bandit[1] + 0.02} ${b.bandit[0] - 0.28} ${b.bandit[1] + 0.34}Z" fill="${HEXHAVEN.bandit}"/>`;
  return {
    vx,
    vy,
    side,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${vx} ${vy} ${side} ${side}"><rect x="${vx}" y="${vy}" width="${side}" height="${side}" rx=".6" fill="${HEXHAVEN.sea}"/>${hexes}${bandit}${roads}${spots}</svg>`,
  };
}

export const hexhaven = {
  key: "hexhaven",
  paths: ["/catan", "/hexhaven"],
  page: {
    title: "Catan",
    description: "Settle an island of hexes, 2 to 6 of you over a few days. Roll, build, trade and rob each other.",
  },
  card: { word: "CATAN", states: TITLE_STATES, tileSize: 104, blurb: "Settle the island. Build, trade, rob your friends." },
  modeTitles: { "hexhaven:classic": "Catan" },
  text(m, { names, title }) {
    if (m.status === "waiting") return { title: `${names[0]} wants a game of Catan`, status: seatsSoFar(m) };
    if (m.status === "finished") return { title, status: `${m.result.winner ?? "Someone"} won ${m.result.how || ""}`.trim() + "." };
    const x = m.hexhaven;
    if (x?.setup) return { title, status: `Settling the island. ${moverName(m)} to place.` };
    return { title, status: `Turn ${x?.turn ?? 1}, first to ${x?.goal ?? 10}. ${moverName(m)} to move.` };
  },
  board(m, { side }) {
    const b = m.hexhaven;
    const style = { borderRadius: 18, boxShadow: BOARD_SHADOW, flexShrink: 0 };
    if (!b) return h("div", { ...style, width: side, height: side, background: HEXHAVEN.sea });
    const view = svgOf(
      b,
      m.players.map((p) => p.color),
      side,
    );
    const px = (v, from) => ((v - from) / view.side) * side;
    const token = (side / view.side) * 0.68;
    return h(
      "div",
      { ...style, position: "relative", width: side, height: side },
      img(svgDataUrl(view.svg), side, side, { position: "absolute", left: 0, top: 0 }),
      ...b.hexes
        .filter((x) => x.n)
        .map((x) =>
          h(
            "div",
            {
              position: "absolute",
              left: px(x.c[0], view.vx) - token / 2,
              top: px(x.c[1], view.vy) - token / 2,
              width: token,
              height: token,
              alignItems: "center",
              justifyContent: "center",
              fontSize: token * 0.52,
              fontWeight: 800,
              color: x.n === 6 || x.n === 8 ? HEXHAVEN.hot : HEXHAVEN.tokenInk,
            },
            String(x.n),
          ),
        ),
    );
  },
  seatScore: (m, i) =>
    m.hexhaven && m.status !== "waiting" ? scoreText(m.hexhaven.out[i] ? "left" : `${m.hexhaven.points[i] ?? 0} pts`) : undefined,
  version: (m) => [m.hexhaven?.turn ?? 0, m.hexhaven?.points ?? []],
};
