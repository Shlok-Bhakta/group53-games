import { anyApi } from "convex/server";
import { CARD, STONKS } from "../palette.mjs";
import { frame, h, img, renderPng, svgDataUrl } from "../layout.mjs";

const INDEX = "^GSPC";
const SYMBOL = "[A-Za-z0-9.%^-]+";
const PAGE = new RegExp(`^/stonks(?:/(${SYMBOL}))?/?$`);
const IMAGE = new RegExp(`^/og/stonks/(${SYMBOL})\\.png$`);
const MOVERS_IN_DESCRIPTION = 6;
const CHART = { width: 1072, height: 230 };

const stockName = (s) => (s === INDEX ? "S&P 500" : s.replace(/-(?=[A-Z]$)/, "."));
const money = (n, s) =>
  `${s === INDEX ? "" : "$"}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 6 : 2 })}`;
const quoted = (n, q) =>
  !q.currency || q.currency === "USD" || q.symbol === INDEX ? money(n, q.symbol) : `${money(n, INDEX)} ${q.currency}`;

async function stockData(convex, symbol) {
  const [q, chart] = await Promise.all([
    convex.query(anyApi.stonks.quote, { symbol }),
    convex.query(anyApi.stonks.chart, { symbol, range: "1D" }),
  ]);
  if (!q) return null;
  const base = q.prevClose ?? chart.points[0]?.[1];
  const change = base ? q.price - base : 0;
  return { symbol, q, points: chart.points, base, change, pct: base ? (change / base) * 100 : 0 };
}

// platform: the card's font (Rubik) has no arrow glyphs, so changes are signed with plain ASCII.
const changeText = (d) => `${d.change < 0 ? "-" : "+"}${quoted(Math.abs(d.change), d.q)} (${Math.abs(d.pct).toFixed(2)}%)`;
const pctText = (d) => `${d.change < 0 ? "-" : "+"}${Math.abs(d.pct).toFixed(2)}%`;

function lineChart(points, base, color, w, ht) {
  if (points.length < 2) return h("div", { width: w, height: ht });
  const ps = points.map((p) => p[1]);
  let lo = Math.min(...ps, base ?? Infinity);
  let hi = Math.max(...ps, base ?? -Infinity);
  const pad = (hi - lo || 1) * 0.08;
  lo -= pad;
  hi += pad;
  const t0 = points[0][0];
  const t1 = points.at(-1)[0];
  const x = (t) => (((t - t0) / (t1 - t0 || 1)) * (w - 12) + 6).toFixed(1);
  const y = (v) => (ht * (1 - (v - lo) / (hi - lo))).toFixed(1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p[0])},${y(p[1])}`).join("");
  const previousClose =
    base === undefined
      ? ""
      : `<line x1="0" x2="${w}" y1="${y(base)}" y2="${y(base)}" stroke="${STONKS.previousClose}" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">${previousClose}<path d="${d}L${x(t1)},${ht}L${x(t0)},${ht}Z" fill="${color}" fill-opacity="0.16"/><path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  return img(svgDataUrl(svg), w, ht);
}

function renderStock(d) {
  const color = d.change < 0 ? STONKS.down : STONKS.up;
  return renderPng(
    frame(
      h(
        "div",
        { flexDirection: "column", gap: 4 },
        h(
          "div",
          { fontSize: 34, fontWeight: 500, color: CARD.blurb },
          d.symbol === INDEX ? "S&P 500" : `${stockName(d.symbol)}${d.q.name ? ` · ${d.q.name}` : ""}`,
        ),
        h(
          "div",
          { alignItems: "baseline", gap: 28 },
          h("div", { fontSize: 92, fontWeight: 800 }, quoted(d.q.price, d.q)),
          h("div", { fontSize: 42, fontWeight: 800, color }, changeText(d)),
        ),
      ),
      lineChart(d.points, d.base, color, CHART.width, CHART.height),
    ),
  );
}

async function indexDescription(convex) {
  const board = await convex.query(anyApi.stonks.board, {});
  return board.rows
    .slice(0, MOVERS_IN_DESCRIPTION)
    .map(
      (r) =>
        `${stockName(r.symbol)} ${r.prevClose ? pctText({ change: r.price - r.prevClose, pct: ((r.price - r.prevClose) / r.prevClose) * 100 }) : money(r.price, r.symbol)}`,
    )
    .join(", ");
}

export const stonks = {
  key: "stonks",
  paths: ["/stonks"],
  page: { title: "Stonks", description: "The S&P 500's top 20, ranked by their share of the index, every trade live." },
  card: {
    word: "STONKS",
    states: Array(6).fill("green"),
    tileSize: 104,
    blurb: "The S&P 500's top 20, every trade live.",
    cta: "Tap to watch",
  },
  async livePage(convex, pathname) {
    const page = pathname.match(PAGE);
    if (!page) return null;
    const symbol = decodeURIComponent(page[1] ?? INDEX);
    const stock = await stockData(convex, symbol).catch(() => null);
    if (!stock) return null;
    return {
      title: `${stockName(symbol)} ${quoted(stock.q.price, stock.q)} ${pctText(stock)}`,
      description:
        symbol === INDEX
          ? await indexDescription(convex)
          : `${stock.q.name ?? stockName(symbol)}, ${changeText(stock)} today. Live on Stonks.`,
      image: { path: `/og/stonks/${encodeURIComponent(symbol)}.png`, version: [stock.q.price, stock.points.length] },
    };
  },
  async image(convex, pathname) {
    const match = pathname.match(IMAGE);
    if (!match) return undefined;
    const d = await stockData(convex, decodeURIComponent(match[1]));
    return d ? renderStock(d) : null;
  },
};
