import { BOARD_SIDE, HEIGHT, WIDTH, avatar, fetchImage, h, listNames, renderPng, tiles } from "./layout.mjs";
import { BRAND, CARD, SEAT_COLORS } from "./palette.mjs";

const COLOR_NAMES = { w: "White", b: "Black", red: "Red", blue: "Blue", yellow: "Yellow", green: "Green" };
const CLOCKWISE_FROM_RED = ["red", "blue", "yellow", "green"];
const PLAYERS_LISTED = 5;
const CROWDED_FROM_PLAYERS = 4;

export const CALLED_OFF = "This game was called off.";
export const LIVE_NOW = "Live right now. Tap to watch.";
export const seatsSoFar = (m) => `${m.players.length} in so far. Tap to take a seat.`;
export const moverName = (m) => m.players.find((p) => p.color === m.toMove)?.name ?? "Someone";
export const moverOf = (m) => m.players.find((p) => p.color === m.toMove);

export const scoreText = (text) =>
  h("div", { fontSize: 24, color: CARD.muted, fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap" }, text);

export function matchText(game, m) {
  const seats = m.seats ?? 2;
  const names = m.players.map((p) => p.name);
  const mode = game.modeTitles[m.mode] ?? "Chess";
  const title = m.players.length < 2 ? `${names[0]} wants a game` : seats > 2 ? listNames(names) : names.join(" vs ");
  if (m.status === "cancelled") return { title, status: CALLED_OFF, mode };
  return { ...game.text(m, { names, mode, title, seats }), mode };
}

function seatDetail(m, p) {
  if (m.points && p.color) return h("div", { fontSize: 24, color: CARD.muted, fontWeight: 500 }, `${m.points[p.color]} pts`);
  if (p.color) return h("div", { fontSize: 24, color: CARD.muted, fontWeight: 500 }, COLOR_NAMES[p.color] ?? "");
  return [];
}

function seatOrder(m, crowded) {
  const order = crowded
    ? CLOCKWISE_FROM_RED.map((c) => m.players.findIndex((p) => p.color === c)).filter((i) => i >= 0)
    : m.players.map((_, i) => i);
  return order.length ? order : m.players.map((_, i) => i);
}

export async function renderMatch(game, m) {
  const crowded = (game.crowded?.(m) ?? false) || m.players.length >= CROWDED_FROM_PLAYERS;
  const board = await game.board(m, { side: BOARD_SIDE, crowded });
  const text = matchText(game, m);
  const images = await Promise.all(m.players.map((p) => fetchImage(p.image)));
  const tree = h(
    "div",
    {
      width: WIDTH,
      height: HEIGHT,
      padding: 55,
      gap: 56,
      alignItems: "center",
      backgroundImage: CARD.background,
      color: CARD.text,
      fontFamily: "Rubik",
    },
    board,
    h(
      "div",
      { flexDirection: "column", gap: crowded ? 18 : 26, flex: 1, minWidth: 0 },
      h(
        "div",
        { alignItems: "center", gap: 14 },
        tiles("53", ["green", "yellow"], 44),
        h("div", { fontSize: 30, fontWeight: 800, color: CARD.soft }, text.mode),
      ),
      h(
        "div",
        { flexDirection: "column", gap: crowded ? 10 : 16 },
        ...seatOrder(m, crowded)
          .slice(0, PLAYERS_LISTED)
          .map((i) => {
            const p = m.players[i];
            const big = !crowded;
            return h(
              "div",
              { alignItems: "center", gap: 16 },
              p.color && SEAT_COLORS[p.color] ? h("div", { width: 12, height: 48, borderRadius: 6, background: SEAT_COLORS[p.color] }) : [],
              avatar({ name: p.name, frame: "none" }, big ? 64 : 48, images[i]),
              h(
                "div",
                {
                  fontSize: big ? 40 : 32,
                  fontWeight: 800,
                  flexShrink: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                },
                p.name,
              ),
              game.seatScore?.(m, i) ?? seatDetail(m, p),
            );
          }),
      ),
      h("div", { fontSize: crowded ? 28 : 32, fontWeight: 500, color: CARD.body, lineHeight: 1.3 }, text.status),
      h(
        "div",
        { fontSize: 30, fontWeight: 800, color: BRAND },
        m.status === "finished" ? "Tap for a rematch" : m.status === "waiting" ? "Tap to join" : "Tap to open",
      ),
    ),
  );
  return renderPng(tree);
}
