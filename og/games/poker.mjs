import { POKER } from "../palette.mjs";
import { h, img, svgDataUrl } from "../layout.mjs";
import { moverName, scoreText } from "../match.mjs";

const BOARD_CARDS = 5;
const chips = (n) => n.toLocaleString("en-US");

// platform: satori's fonts have no suit glyphs and the emoji fallback draws clubs black, so suits are paths.
const SUIT_PATH = {
  s: "M12 2C9 6 3 9 3 13.5 3 16 5 18 7.5 18c1.6 0 2.9-.8 3.6-2-.3 2.3-1.2 4.2-2.6 5.5h7c-1.4-1.3-2.3-3.2-2.6-5.5.7 1.2 2 2 3.6 2 2.5 0 4.5-2 4.5-4.5C21 9 15 6 12 2z",
  h: "M12 21s-7-4.5-9.5-9C1 8.5 3 5 6.5 5c2 0 3.5 1.2 5.5 3.5C14 6.2 15.5 5 17.5 5 21 5 23 8.5 21.5 12 19 16.5 12 21 12 21z",
  d: "M12 2l8 10-8 10-8-10z",
  c: "M12 2.5a4 4 0 0 0-3.6 5.8A4 4 0 1 0 10.5 16c-.3 2.2-1.2 4-2.5 5.5h8c-1.3-1.5-2.2-3.3-2.5-5.5a4 4 0 1 0 2.1-7.7A4 4 0 0 0 12 2.5z",
};

const suit = (s, size) =>
  img(
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${POKER.suit[s]}" d="${SUIT_PATH[s]}"/></svg>`),
    size,
    size,
  );

function card(c) {
  const w = 84;
  if (!c) return h("div", { width: w, height: w * 1.4, borderRadius: 8, background: POKER.emptySlot, border: POKER.emptySlotBorder });
  return h(
    "div",
    {
      width: w,
      height: w * 1.4,
      borderRadius: 8,
      background: POKER.card,
      color: POKER.suit[c[1]],
      flexDirection: "column",
      padding: "6px 9px",
      boxShadow: POKER.cardShadow,
    },
    h("div", { fontSize: 38, fontWeight: 800, lineHeight: 1 }, c[0] === "T" ? "10" : c[0]),
    h("div", { marginTop: 6 }, suit(c[1], 38)),
  );
}

export const poker = {
  key: "poker",
  paths: ["/poker"],
  page: {
    title: "Poker",
    description: "Hold'em, Omaha, Short Deck and five-card draw, up to 8 of you over the day. Come take a seat.",
  },
  card: {
    word: "POKER",
    states: ["green", "yellow", "green", "hit", "green"],
    tileSize: 118,
    blurb: "Bet, bluff and take everyone's chips over the day.",
  },
  modeTitles: {
    "poker:holdem": "Texas Hold'em",
    "poker:omaha": "Omaha",
    "poker:short": "Short Deck Hold'em",
    "poker:draw": "Five-card draw",
  },
  text(m, { names, mode, title }) {
    if (m.status === "waiting")
      return { title: `${names[0]} wants ${mode}`, status: `${m.players.length} at the table so far. Tap to take a seat.` };
    if (m.status === "finished") {
      const top = Math.max(...(m.poker?.stacks ?? [0]));
      return { title, status: m.result.draw ? "A tie." : `${m.result.winner} won with ${chips(top)} chips.` };
    }
    return { title, status: `Hand ${m.poker?.hand ?? 1}, ${chips(m.poker?.pot ?? 0)} in the pot. ${moverName(m)} to act.` };
  },
  board(m, { side }) {
    const p = m.poker;
    return h(
      "div",
      {
        width: side,
        height: side,
        flexShrink: 0,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        borderRadius: 120,
        backgroundImage: POKER.felt,
        boxShadow: POKER.feltShadow,
      },
      h(
        "div",
        { fontSize: 34, fontWeight: 800, color: POKER.potInk, background: POKER.potPill, borderRadius: 40, padding: "8px 26px" },
        `Pot ${chips(p?.pot ?? 0)}`,
      ),
      h("div", { gap: 8 }, ...Array.from({ length: BOARD_CARDS }, (_, i) => card(p?.board?.[i]))),
    );
  },
  seatScore: (m, i) =>
    m.poker && m.status !== "waiting" ? scoreText(m.poker.out.includes(i) ? "out" : `${chips(m.poker.stacks[i] ?? 0)} chips`) : undefined,
  version: (m) => [m.poker?.hand ?? 0],
};
