import { UNO } from "../palette.mjs";
import { h } from "../layout.mjs";
import { moverName, scoreText, seatsSoFar } from "../match.mjs";

const COLOR = { r: "Red", y: "Yellow", g: "Green", b: "Blue" };
const FACE = {
  S: "SKIP",
  R: "REV",
  D2: "+2",
  D4: "+4",
  SA: "ALL",
  DA: "DROP",
  W: "WILD",
  W4: "+4",
  WR4: "+4",
  W6: "+6",
  W10: "+10",
  WC: "SPIN",
};
const NAME = {
  S: "Skip",
  R: "Reverse",
  D2: "Draw 2",
  D4: "Draw 4",
  SA: "Skip Everyone",
  DA: "Discard All",
  W: "Wild",
  W4: "Wild Draw 4",
  WR4: "Wild Reverse Draw 4",
  W6: "Wild Draw 6",
  W10: "Wild Draw 10",
  WC: "Color Roulette",
};

const cardName = (c) => (c[0] === "w" ? NAME[c.slice(1)] : `${COLOR[c[0]]} ${NAME[c.slice(1)] ?? c.slice(1)}`);

function card(c, w, chosen) {
  const face = c ? (FACE[c.slice(1)] ?? c.slice(1)) : "";
  const wild = c?.[0] === "w";
  const label = face.length > 3 ? 0.26 : face.length > 2 ? 0.34 : 0.5;
  return h(
    "div",
    {
      width: w,
      height: w * 1.4,
      borderRadius: w * 0.09,
      background: c ? (wild ? UNO.wild : UNO[c[0]]) : UNO.back,
      border: `${Math.round(w * 0.055)}px solid ${UNO.edge}`,
      boxShadow: UNO.cardShadow,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      color: UNO.ink,
      fontWeight: 800,
    },
    c ? h("div", { fontSize: Math.round(w * label), lineHeight: 1 }, face) : null,
    wild && chosen ? h("div", { marginTop: w * 0.12, width: w * 0.5, height: w * 0.1, borderRadius: w, background: UNO[chosen] }) : null,
  );
}

export const uno = {
  key: "uno",
  paths: ["/uno"],
  page: {
    title: "Uno",
    description: "Classic or No Mercy Uno for 2 to 8, at your own pace. Stacking, 7-0, jump-ins and every other house rule.",
  },
  card: {
    word: "UNO",
    states: ["hit", "yellow", "green"],
    tileSize: 150,
    blurb: "Match the color, stack the draws, and get out first.",
    cta: "Uno",
  },
  modeTitles: { "uno:classic": "Uno", "uno:nomercy": "No Mercy Uno" },
  text(m, { names, mode, title }) {
    if (m.status === "waiting") return { title: `${names[0]} wants a game of ${mode}`, status: seatsSoFar(m) };
    const x = m.uno;
    if (m.status === "finished") return { title, status: `${m.result.winner ?? "Someone"} won ${m.result.how || ""}`.trim() + "." };
    if (!x) return { title, status: "Dealing." };
    const stack = x.pending ? ` +${x.pending} is waiting on them.` : "";
    return { title, status: `Hand ${x.hand}. ${moverName(m)} to play on ${cardName(x.top)}.${stack}` };
  },
  version: (m) => (m.uno ? `${m.uno.top}:${m.uno.counts.join(",")}:${m.uno.pending}` : ""),
  seatScore: (m, i) => {
    const x = m.uno;
    if (!x || m.status === "waiting") return undefined;
    if (x.out[i]) return scoreText("out");
    const n = x.counts[i];
    return scoreText(x.goal ? `${x.scores[i]} pts` : n === 1 ? "UNO!" : `${n} cards`);
  },
  board(m, { side }) {
    const x = m.uno;
    const w = Math.round(side * 0.27);
    return h(
      "div",
      {
        width: side,
        height: side,
        flexShrink: 0,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 34,
        borderRadius: 120,
        backgroundImage: UNO.table,
        boxShadow: UNO.tableShadow,
      },
      h(
        "div",
        { alignItems: "center", gap: 46 },
        card(null, Math.round(w * 0.8)),
        h(
          "div",
          { padding: 8, borderRadius: w * 0.14, border: `6px solid ${x ? UNO[x.color] : UNO.back}` },
          card(x?.top ?? null, w, x?.color),
        ),
      ),
      x?.pending
        ? h(
            "div",
            { fontSize: 40, fontWeight: 800, color: UNO.ink, background: UNO.hit, borderRadius: 40, padding: "8px 28px" },
            `+${x.pending}`,
          )
        : h(
            "div",
            { fontSize: 34, fontWeight: 800, color: UNO.ink, background: UNO.pill, borderRadius: 40, padding: "8px 26px" },
            x ? `${COLOR[x.color]} is up` : "Uno",
          ),
    );
  },
};
