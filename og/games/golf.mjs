import { GOLF } from "../palette.mjs";
import { h } from "../layout.mjs";
import { moverOf, scoreText, seatsSoFar } from "../match.mjs";

const vsPar = (s, par) => (s === par ? "E" : s > par ? `+${s - par}` : `${s - par}`);

export const golf = {
  key: "golf",
  paths: ["/golf"],
  page: {
    title: "Golf",
    description: "Handmade and generated courses, up to 8 of you. Knock each other into the water and keep your items from hole to hole.",
  },
  card: {
    word: "GOLF",
    states: ["green", "green", "yellow", "green"],
    tileSize: 118,
    blurb: "One ball at a time, farthest from the cup first. Knock each other into the water.",
  },
  modeTitles: { "golf:turns": "Golf", "golf:live": "Live golf" },
  text(m, { names, title }) {
    const g = m.golf;
    if (m.status === "waiting")
      return { title: `${names[0]} wants ${m.mode === "golf:live" ? "a live round of golf" : "a round of golf"}`, status: seatsSoFar(m) };
    if (m.status === "finished") {
      const best = Math.min(...(g?.totals ?? [0]));
      return { title, status: m.result.draw ? `Tied on ${best}.` : `${m.result.winner} won on ${best} (${vsPar(best, g?.par0 ?? best)}).` };
    }
    const mover = moverOf(m);
    const where = g?.name ? `Hole ${g.hole} of ${g.total}, ${g.name}, par ${g.par}.` : "Building the course.";
    return { title, status: `${where}${mover ? ` ${mover.name} to shoot.` : ""}` };
  },
  board(m, { side }) {
    const g = m.golf;
    const theme = g?.theme === "ice" ? "ice" : "hills";
    const grass = GOLF.grass[theme];
    const mow = GOLF.mow[theme];
    return h(
      "div",
      {
        width: side,
        height: side,
        flexShrink: 0,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        borderRadius: 40,
        backgroundImage: `repeating-linear-gradient(45deg, ${grass} 0px, ${grass} 34px, ${mow} 34px, ${mow} 68px)`,
        boxShadow: GOLF.railShadow,
      },
      h("div", { width: 66, height: 66, borderRadius: 33, background: GOLF.cup }),
      h(
        "div",
        { fontSize: 120, fontWeight: 800, color: GOLF.ink, lineHeight: 1, textShadow: GOLF.numberShadow },
        g?.name ? `${g.hole}` : "...",
      ),
      h(
        "div",
        {
          fontSize: 34,
          fontWeight: 800,
          color: GOLF.ink,
          background: GOLF.pill,
          borderRadius: 40,
          padding: "8px 26px",
          maxWidth: side - 60,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        },
        g?.name ? `${g.name}, par ${g.par}` : "Building the course",
      ),
    );
  },
  seatScore: (m, i) =>
    m.golf && m.golf.played > 0
      ? scoreText(m.golf.out.includes(i) ? "out" : `${m.golf.totals[i]} (${vsPar(m.golf.totals[i], m.golf.par0)})`)
      : undefined,
  version: (m) => [m.golf?.hole ?? 0, m.golf?.played ?? 0],
};
