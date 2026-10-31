// Link previews for Discord and other unfurlers. nginx sends crawler requests here; people never see this.
// Each page gets Open Graph tags, and its image is rendered on demand from live Convex data.
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const require = createRequire(import.meta.url);
const SITE = process.env.SITE_URL ?? "https://group53.shlokbhakta.dev";
const PORT = Number(process.env.PORT ?? 8787);
const EMBED_COLOR = "#e8b647";

const convex = new ConvexHttpClient(process.env.CONVEX_URL ?? "http://convex:3210");
convex.setAdminAuth(readFileSync(process.env.ADMIN_KEY_FILE ?? "/run/secrets/admin_key", "utf8").trim());

const font = (weight) => readFileSync(require.resolve(`@fontsource/rubik/files/rubik-latin-${weight}-normal.woff`));
const FONTS = [
  { name: "Rubik", data: font(500), weight: 500, style: "normal" },
  { name: "Rubik", data: font(800), weight: 800, style: "normal" },
];

// Mirrors the ring styles in src/style.css. satori has no conic gradients, so holo is linear.
const RINGS = {
  none: null,
  white: "#f8fafc",
  green: "#5fae57",
  yellow: "#e3b341",
  red: "#e5484d",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  gold: "linear-gradient(135deg, #fef3c7, #f59e0b 45%, #b45309 70%, #fde68a)",
  fire: "linear-gradient(200deg, #fde047, #f97316 45%, #dc2626)",
  toxic: "linear-gradient(160deg, #ecfccb, #84cc16 45%, #166534)",
  holo: "linear-gradient(135deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #8b5cf6)",
  rgb: "linear-gradient(90deg, #ff0040, #ffbf00, #00ff80, #0080ff, #bf00ff)",
  ice: "linear-gradient(160deg, #f0f9ff, #7dd3fc 45%, #2563eb)",
};

const TILE = { green: "#5fae57", yellow: "#e3b341", gray: "#5d6b66", hit: "#e5484d", blank: "#2b5a48", cream: "#f3e2bd" };
const INK = { yellow: "#1d2a24", cream: "#2d2215" };

// Each shareable path: its title, description, and which image to draw.
const PAGES = {
  "/": {
    title: () => "Group 53 Games",
    description: (crew) => `${crew.length} in the crew. Little games for the group, built so you can mess with each other.`,
    card: "home",
  },
  "/wordle": {
    title: () => "PvP Wordle",
    description: () => "Everyone gets the same word. Solve it, then spend what you earn messing up someone else's board.",
    card: "wordle",
  },
  "/chess": {
    title: () => "Chess",
    description: () => "Classic, real-time, and 4-player free-for-all chess. Come take a seat.",
    card: "chess",
  },
  "/scrabble": {
    title: () => "Scrabble",
    description: () => "Up to 8 of you on one board, at your own pace or live with a turn timer. Plan your words while you wait.",
    card: "scrabble",
  },
  "/poker": {
    title: () => "Poker",
    description: () => "Hold'em, Omaha, Short Deck and five-card draw, up to 8 of you over the day. Come take a seat.",
    card: "poker",
  },
  "/crew": {
    title: () => "The crew",
    description: (crew) => crew.map((p) => p.name).join(", "),
    card: "home",
  },
};

// --- tiny element helper for satori ---
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", boxSizing: "border-box", ...style }, children: children.flat() } });

function tiles(word, states, size) {
  return h(
    "div",
    { gap: size * 0.12 },
    [...word].map((ch, i) => {
      const state = states[i] ?? "blank";
      return h(
        "div",
        {
          width: size,
          height: size,
          borderRadius: size * 0.17,
          background: TILE[state],
          color: INK[state] ?? "#ffffff",
          fontSize: size * 0.56,
          fontWeight: 800,
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `inset 0 -${size * 0.07}px 0 rgba(0,0,0,0.2)`,
          transform: state === "hit" ? `rotate(-9deg) translateY(${size * 0.06}px)` : undefined,
        },
        ch,
      );
    }),
  );
}

function avatar(p, size, image) {
  const ring = p.frame === "none" ? null : (["solid", "comet", "pulse", "neon"].includes(p.frame) ? p.frameColor : RINGS[p.frame]) ?? null;
  const pad = ring ? size * 0.06 : 0;
  const face = image
    ? { type: "img", props: { src: image, width: size - pad * 2 - size * 0.07, height: size - pad * 2 - size * 0.07, style: { borderRadius: 9999 } } }
    : h(
        "div",
        { width: "100%", height: "100%", borderRadius: 9999, background: "#2f6b55", color: "#d7efe4", fontSize: size * 0.42, fontWeight: 800, alignItems: "center", justifyContent: "center" },
        p.name.slice(0, 1).toUpperCase(),
      );
  return h(
    "div",
    { position: "relative", width: size, height: size },
    h(
      "div",
      { width: size, height: size, borderRadius: 9999, padding: pad, background: ring ?? "transparent", backgroundImage: ring?.startsWith("linear") ? ring : undefined },
      h("div", { width: "100%", height: "100%", borderRadius: 9999, padding: size * 0.035, background: "#123b2d", alignItems: "center", justifyContent: "center" }, face),
    ),
    p.badge ? h("div", { position: "absolute", right: -size * 0.06, bottom: -size * 0.06, fontSize: size * 0.36 }, p.badge) : [],
  );
}

function crewRow(crew, images, size = 92) {
  const shown = crew.slice(0, 7);
  return h(
    "div",
    { alignItems: "center" },
    shown.map((p, i) => h("div", { marginLeft: i === 0 ? 0 : -size * 0.18 }, avatar(p, size, images[i]))),
    crew.length > shown.length
      ? h("div", { marginLeft: 16, color: "#d7efe4", fontSize: 34, fontWeight: 800 }, `+${crew.length - shown.length}`)
      : [],
  );
}

function frame(...children) {
  return h(
    "div",
    {
      width: 1200,
      height: 630,
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "56px 64px",
      backgroundImage: "linear-gradient(140deg, #1f6b4f 0%, #134232 55%, #0b261d 100%)",
      color: "#f2fbf6",
      fontFamily: "Rubik",
    },
    h("div", { alignItems: "center", gap: 18 }, tiles("53", ["green", "yellow"], 58), h("div", { fontSize: 40, fontWeight: 800 }, "Group 53 Games")),
    ...children,
  );
}

const CARDS = {
  chess: (crew, images) =>
    frame(
      h(
        "div",
        { flexDirection: "column", gap: 28 },
        tiles("CHESS", ["green", "yellow", "green", "hit", "green"], 118),
        h("div", { fontSize: 40, fontWeight: 500, color: "#cfe9dd", maxWidth: 940, lineHeight: 1.25 }, "Classic at your own pace, or real-time with no turns."),
      ),
      h("div", { alignItems: "center", justifyContent: "space-between" }, crewRow(crew, images, 84), h("div", { color: EMBED_COLOR, fontSize: 34, fontWeight: 800 }, "Tap to play")),
    ),
  scrabble: (crew, images) =>
    frame(
      h(
        "div",
        { flexDirection: "column", gap: 28 },
        tiles("SCRABBLE", Array(8).fill("cream"), 104),
        h("div", { fontSize: 40, fontWeight: 500, color: "#cfe9dd", maxWidth: 940, lineHeight: 1.25 }, "Up to 8 of you on one board. Plan your words while you wait."),
      ),
      h("div", { alignItems: "center", justifyContent: "space-between" }, crewRow(crew, images, 84), h("div", { color: EMBED_COLOR, fontSize: 34, fontWeight: 800 }, "Tap to play")),
    ),
  poker: (crew, images) =>
    frame(
      h(
        "div",
        { flexDirection: "column", gap: 28 },
        tiles("POKER", ["green", "yellow", "green", "hit", "green"], 118),
        h("div", { fontSize: 40, fontWeight: 500, color: "#cfe9dd", maxWidth: 940, lineHeight: 1.25 }, "Bet, bluff and take everyone's chips over the day."),
      ),
      h("div", { alignItems: "center", justifyContent: "space-between" }, crewRow(crew, images, 84), h("div", { color: EMBED_COLOR, fontSize: 34, fontWeight: 800 }, "Tap to play")),
    ),
  home: (crew, images) =>
    frame(
      h("div", { fontSize: 88, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, maxWidth: 980 }, "Who are we ruining today?"),
      h(
        "div",
        { alignItems: "center", justifyContent: "space-between" },
        crewRow(crew, images),
        h("div", { flexDirection: "column", alignItems: "flex-end", color: "#bfe3d3", fontSize: 30, fontWeight: 500 }, `${crew.length} in the crew`, h("div", { color: EMBED_COLOR, fontWeight: 800 }, "Tap to join")),
      ),
    ),
  wordle: (crew, images) =>
    frame(
      h(
        "div",
        { flexDirection: "column", gap: 28 },
        tiles("WORDLE", ["green", "yellow", "gray", "green", "hit", "green"], 118),
        h("div", { fontSize: 40, fontWeight: 500, color: "#cfe9dd", maxWidth: 900, lineHeight: 1.25 }, "Same word for everyone. Solve it, then wreck someone else's board."),
      ),
      h("div", { alignItems: "center", justifyContent: "space-between" }, crewRow(crew, images, 84), h("div", { color: EMBED_COLOR, fontSize: 34, fontWeight: 800 }, "PvP Wordle")),
    ),
};

// --- chess game previews ---

const PIECES_URL = process.env.PIECES_URL ?? "http://web/pieces";
const pieceCache = new Map();
async function pieceImage(code) {
  if (!pieceCache.has(code)) {
    const res = await fetch(`${PIECES_URL}/${code}.svg`, { signal: AbortSignal.timeout(3000) });
    pieceCache.set(code, `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`);
  }
  return pieceCache.get(code);
}

const MODE_TITLES = {
  "chess:classic": "Classic chess",
  "chess:realtime": "Real-time chess",
  "chess:four": "4-player chess",
  "chess:realtime4": "4-player real-time chess",
  "poker:holdem": "Texas Hold'em",
  "poker:omaha": "Omaha",
  "poker:short": "Short Deck Hold'em",
  "poker:draw": "Five-card draw",
  "scrabble:classic": "Scrabble",
  "scrabble:live": "Live Scrabble",
};
const COLOR_NAMES = { w: "White", b: "Black", red: "Red", blue: "Blue", yellow: "Yellow", green: "Green" };
const SEAT_COLORS = { red: "#e0503f", blue: "#3f7be0", yellow: "#e8b928", green: "#3faa5a", purple: "#9b5de5", orange: "#f08a24", teal: "#1fb5a8", pink: "#e8559a" };
const listNames = (names) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function matchText(m) {
  const seats = m.seats ?? 2;
  const names = m.players.map((p) => p.name);
  const realtime = m.mode === "chess:realtime" || m.mode === "chess:realtime4";
  const mode = MODE_TITLES[m.mode] ?? "Chess";
  const title = m.players.length < 2 ? `${names[0]} wants a game` : seats > 2 ? listNames(names) : names.join(" vs ");
  if (m.mode.startsWith("poker:")) {
    if (m.status === "waiting") return { title: `${names[0]} wants ${mode}`, status: `${m.players.length} at the table so far. Tap to take a seat.`, mode };
    if (m.status === "cancelled") return { title, status: "This game was called off.", mode };
    if (m.status === "finished") {
      const top = Math.max(...(m.poker?.stacks ?? [0]));
      return { title, status: m.result.draw ? "A tie." : `${m.result.winner} won with ${top.toLocaleString("en-US")} chips.`, mode };
    }
    const mover = m.players.find((p) => p.color === m.toMove);
    return { title, status: `Hand ${m.poker?.hand ?? 1}, ${(m.poker?.pot ?? 0).toLocaleString("en-US")} in the pot. ${mover?.name ?? "Someone"} to act.`, mode };
  }
  if (m.status === "waiting" && m.scrabble) {
    return { title: `${names[0]} wants ${mode.toLowerCase().replace("live scrabble", "live Scrabble").replace("scrabble", "Scrabble")}`, status: `${m.players.length} in so far. Tap to take a seat.`, mode };
  }
  if (m.status === "waiting") {
    const status =
      seats > 2
        ? `${m.players.length} of ${seats} seats taken. ${realtime ? "It starts when everyone's on the board." : "Tap to take one."}`
        : realtime ? "Waiting for an opponent. It starts the moment you join." : "Waiting for an opponent. Tap to take the other seat.";
    return { title: m.players.length < 2 ? title : `${names[0]} wants ${mode.toLowerCase()}`, status, mode };
  }
  if (m.status === "cancelled") return { title, status: "This game was called off.", mode };
  if (m.status === "finished") {
    const how = { checkmate: "by checkmate", resign: "by resignation", king: "by taking the king", last_king: "as the last king standing", last_player: "as the last one standing" }[m.result.reason] ?? "";
    if (m.scrabble) {
      const top = Math.max(...m.scrabble.scores);
      return { title, status: m.result.draw ? `Tied on ${top}.` : `${m.result.winner} won with ${top} points.`, mode };
    }
    return { title, status: m.result.draw ? "Drawn." : `${m.result.winner} won ${how}.`.replace(" .", "."), mode };
  }
  if (m.toMove && m.scrabble) {
    const mover = m.players.find((p) => p.color === m.toMove);
    const last = m.scrabble.last ? ` Last word: ${m.scrabble.last.word} for ${m.scrabble.last.score}.` : "";
    return { title, status: `${mover?.name ?? "Someone"} to play.${last}`, mode };
  }
  if (m.toMove) {
    const mover = m.players.find((p) => p.color === m.toMove);
    return { title, status: `${mover?.name ?? "Someone"} to move. ${m.moveCount} moves in.`, mode };
  }
  return { title, status: "Live right now. Tap to watch.", mode };
}

// A Scrabble board: bonus squares, and the tiles on it edged in their player's color.
const PREMIUM = { T: ["#e5484d", "3W"], D: ["#5fae57", "2W"], "*": ["#5fae57", "★"], t: ["#e3b341", "3L"], d: ["#3f7be0", "2L"] };
function scrabbleBoard(s, side) {
  const cell = side / s.size;
  const at = new Map(s.tiles.map((t) => [`${t.x},${t.y}`, t]));
  const rows = [];
  for (let y = 0; y < s.size; y++) {
    const cells = [];
    for (let x = 0; x < s.size; x++) {
      const t = at.get(`${x},${y}`);
      const p = PREMIUM[s.premium[y][x]];
      cells.push(
        h(
          "div",
          { width: cell, height: cell, padding: 1, flexShrink: 0 },
          t
            ? h(
                "div",
                { width: "100%", height: "100%", borderRadius: cell * 0.16, background: "#f3e2bd", color: t.blank ? "#8a7656" : "#2d2215", fontSize: cell * 0.6, fontWeight: 800, alignItems: "center", justifyContent: "center", boxShadow: `inset 0 -${Math.max(2, cell * 0.08)}px 0 ${SEAT_COLORS[s.colors[t.seat]] ?? "#cdb07c"}` },
                t.letter,
              )
            : h("div", { width: "100%", height: "100%", borderRadius: 2, background: p?.[0] ?? "#1d4a3a", color: "#ffffff", fontSize: cell * 0.34, fontWeight: 800, alignItems: "center", justifyContent: "center" }, p?.[1] ?? ""),
        ),
      );
    }
    rows.push(h("div", { flexDirection: "row" }, cells));
  }
  return h("div", { width: side, height: side, flexShrink: 0, flexDirection: "column", borderRadius: 10, overflow: "hidden", background: "#0f3428" }, rows);
}

// A poker table: the felt with the board cards and the pot. Never anyone's own cards.
const SUIT_INK = { s: "#1d1d1f", h: "#d23a3f", d: "#2a6cd0", c: "#1d8648" };
const PIPS = { s: "♠", h: "♥", d: "♦", c: "♣" };
function pokerTable(p, side) {
  const w = 84;
  const card = (c) =>
    c
      ? h("div", { width: w, height: w * 1.4, borderRadius: 8, background: "#fbfaf6", color: SUIT_INK[c[1]], flexDirection: "column", padding: "6px 9px", boxShadow: "0 4px 10px rgba(0,0,0,0.35)" }, h("div", { fontSize: 38, fontWeight: 800, lineHeight: 1 }, c[0] === "T" ? "10" : c[0]), h("div", { fontSize: 40, lineHeight: 1, marginTop: 4 }, PIPS[c[1]]))
      : h("div", { width: w, height: w * 1.4, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "2px solid rgba(255,255,255,0.16)" });
  return h(
    "div",
    { width: side, height: side, flexShrink: 0, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, borderRadius: 120, backgroundImage: "radial-gradient(ellipse at 50% 42%, #2f8a5d 0%, #237049 55%, #1a5639 100%)", boxShadow: "inset 0 0 0 10px rgba(0,0,0,0.18), 0 18px 40px rgba(0,0,0,0.4)" },
    h("div", { fontSize: 34, fontWeight: 800, color: "#f3f7f2", background: "rgba(0,0,0,0.25)", borderRadius: 40, padding: "8px 26px" }, `Pot ${(p?.pot ?? 0).toLocaleString("en-US")}`),
    h("div", { gap: 8 }, ...[0, 1, 2, 3, 4].map((i) => card(p?.board?.[i]))),
  );
}

async function renderMatch(m) {
  if (m.scrabble) m.scrabble.colors = m.players.map((p) => p.color);
  const size = m.scrabble || m.mode.startsWith("poker:") ? 0 : m.board.length;
  const cell = 512 / size;
  const rows = [];
  for (let r = 0; r < size; r++) {
    const cells = [];
    for (let c = 0; c < size; c++) {
      const code = m.board[r][c];
      const dark = (r + c) % 2 === 1;
      cells.push(
        h(
          "div",
          { width: cell, height: cell, flexShrink: 0, background: code === null ? "transparent" : dark ? "#739552" : "#ebecd0", alignItems: "center", justifyContent: "center" },
          code ? { type: "img", props: { src: await pieceImage(code), width: cell - 2, height: cell - 2 } } : [],
        ),
      );
    }
    rows.push(h("div", { flexDirection: "row" }, cells));
  }
  const text = matchText(m);
  const four = size > 8 || m.players.length > 3;
  const images = await Promise.all(m.players.map((p) => fetchImage(p.image)));
  const order = four ? ["red", "blue", "yellow", "green"].map((c) => m.players.findIndex((p) => p.color === c)).filter((i) => i >= 0) : m.players.map((_, i) => i);
  const shown = order.length ? order : m.players.map((_, i) => i);
  const tree = h(
    "div",
    { width: 1200, height: 630, padding: 55, gap: 56, alignItems: "center", backgroundImage: "linear-gradient(140deg, #1f6b4f 0%, #134232 55%, #0b261d 100%)", color: "#f2fbf6", fontFamily: "Rubik" },
    m.mode.startsWith("poker:") ? pokerTable(m.poker, 512) : m.scrabble ? scrabbleBoard(m.scrabble, 512) : h("div", { width: 512, height: 512, flexShrink: 0, flexDirection: "column", borderRadius: four ? 6 : 18, overflow: "hidden", boxShadow: four ? "none" : "0 18px 40px rgba(0,0,0,0.4)" }, rows),
    h(
      "div",
      { flexDirection: "column", gap: four ? 18 : 26, flex: 1 },
      h("div", { alignItems: "center", gap: 14 }, tiles("53", ["green", "yellow"], 44), h("div", { fontSize: 30, fontWeight: 800, color: "#bfe3d3" }, text.mode)),
      h(
        "div",
        { flexDirection: "column", gap: four ? 10 : 16 },
        ...shown.slice(0, 5).map((i) => {
          const p = m.players[i];
          const big = !four;
          return h(
            "div",
            { alignItems: "center", gap: 16 },
            p.color && SEAT_COLORS[p.color] ? h("div", { width: 12, height: 48, borderRadius: 6, background: SEAT_COLORS[p.color] }) : [],
            avatar({ name: p.name, frame: "none" }, big ? 64 : 48, images[i]),
            h("div", { fontSize: big ? 40 : 32, fontWeight: 800 }, p.name),
            m.poker && m.status !== "waiting" ? h("div", { fontSize: 24, color: "#9fcbb6", fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap" }, m.poker.out.includes(i) ? "out" : `${(m.poker.stacks[i] ?? 0).toLocaleString("en-US")} chips`)
            : m.scrabble && m.status !== "waiting" ? h("div", { fontSize: 24, color: "#9fcbb6", fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap" }, `${m.scrabble.scores[i] ?? 0} pts`)
            : m.points && p.color ? h("div", { fontSize: 24, color: "#9fcbb6", fontWeight: 500 }, `${m.points[p.color]} pts`) : p.color ? h("div", { fontSize: 24, color: "#9fcbb6", fontWeight: 500 }, COLOR_NAMES[p.color] ?? "") : [],
          );
        }),
      ),
      h("div", { fontSize: four ? 28 : 32, fontWeight: 500, color: "#d7efe4", lineHeight: 1.3 }, text.status),
      h("div", { fontSize: 30, fontWeight: 800, color: EMBED_COLOR }, m.status === "finished" ? "Tap for a rematch" : m.status === "waiting" ? "Tap to join" : "Tap to open"),
    ),
  );
  const svg = await satori(tree, { width: 1200, height: 630, fonts: FONTS, loadAdditionalAsset });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

// --- data and assets ---
async function getCrew() {
  return await convex.query(anyApi.previews.crew, {});
}

// satori can't decode GIFs, so ask Discord's CDN for PNGs and inline them.
async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url.replace(/\.gif(\?|$)/, ".png$1"), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

// Emoji badges come from Twemoji.
async function loadAdditionalAsset(code, segment) {
  if (code !== "emoji") return undefined;
  const points = [...segment].map((c) => c.codePointAt(0).toString(16)).filter((c) => c !== "fe0f").join("-");
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${points}.svg`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return undefined;
    return `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return undefined;
  }
}

const version = (crew) => createHash("sha1").update(JSON.stringify(crew)).digest("hex").slice(0, 10);

// Renders are cheap but not free; keep each (card, data version) for a few minutes.
const rendered = new Map();
async function renderCard(card) {
  const crew = await getCrew();
  const key = `${card}:${version(crew)}`;
  const hit = rendered.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.png;
  const images = await Promise.all(crew.slice(0, 7).map((p) => fetchImage(p.image)));
  const svg = await satori(CARDS[card](crew, images), { width: 1200, height: 630, fonts: FONTS, loadAdditionalAsset });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  rendered.set(key, { png, at: Date.now() });
  return png;
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function pageHtml(pathname, search) {
  let title, description, image;
  const game = pathname.match(/^\/(?:chess|scrabble|poker)\/([a-z0-9]+)$/);
  const m = game ? await convex.query(anyApi.previews.match, { id: game[1] }) : null;
  if (m) {
    const text = matchText(m);
    title = text.title;
    description = `${text.mode}. ${text.status}`;
    image = `${SITE}/og/match/${game[1]}.png?v=${version([m.status, m.moveCount, m.board, m.scrabble?.tiles.length ?? 0, m.poker?.hand ?? 0])}`;
  } else {
    // A game we don't draw a board for (a poker table) still gets its game's card.
    const page = PAGES[pathname] ?? PAGES[`/${pathname.split("/")[1]}`] ?? PAGES["/"];
    const crew = await getCrew();
    title = page.title(crew);
    description = page.description(crew);
    image = `${SITE}/og/image/${page.card}.png?v=${version(crew)}`;
  }
  const url = `${SITE}${pathname}${search}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta property="og:site_name" content="Group 53 Games">
<meta property="og:type" content="website">
<meta property="og:url" content="${escape(url)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${escape(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escape(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${EMBED_COLOR}">
</head><body><a href="${escape(url)}">${escape(title)}</a></body></html>`;
}

http
  .createServer(async (req, res) => {
    const { pathname, search } = new URL(req.url ?? "/", SITE);
    try {
      const image = pathname.match(/^\/og\/image\/(\w+)\.png$/);
      if (image) {
        if (!CARDS[image[1]]) return void res.writeHead(404).end();
        const png = await renderCard(image[1]);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=300" });
        return void res.end(png);
      }
      const matchImage = pathname.match(/^\/og\/match\/([a-z0-9]+)\.png$/);
      if (matchImage) {
        const m = await convex.query(anyApi.previews.match, { id: matchImage[1] });
        if (!m) return void res.writeHead(404).end();
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=60" });
        return void res.end(await renderMatch(m));
      }
      if (pathname === "/og/health") return void res.writeHead(200).end("ok");
      const html = await pageHtml(pathname, search);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(html);
    } catch (err) {
      console.error(req.url, err);
      res.writeHead(500).end();
    }
  })
  .listen(PORT, () => console.log(`og listening on ${PORT}`));
