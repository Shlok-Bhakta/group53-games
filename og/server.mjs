import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { CREW_SHOWN, crewRow, fetchImage, frame, gameCard, h, renderPng } from "./layout.mjs";
import { renderMatch, matchText } from "./match.mjs";
import { BRAND, CARD } from "./palette.mjs";
import { chess } from "./games/chess.mjs";
import { scrabble } from "./games/scrabble.mjs";
import { poker } from "./games/poker.mjs";
import { golf } from "./games/golf.mjs";
import { landlord } from "./games/landlord.mjs";
import { hexhaven } from "./games/hexhaven.mjs";
import { stonks } from "./games/stonks.mjs";
import { wordle } from "./games/wordle.mjs";

const SITE = process.env.SITE_URL ?? "https://group53.shlokbhakta.dev";
const PORT = Number(process.env.PORT ?? 8787);
const CARD_CACHE_MS = 5 * 60_000;

const convex = new ConvexHttpClient(process.env.CONVEX_URL ?? "http://convex:3210");
convex.setAdminAuth(readFileSync(process.env.ADMIN_KEY_FILE ?? "/run/secrets/admin_key", "utf8").trim());

const MATCH_GAMES = { chess, scrabble, poker, golf, landlord, hexhaven };
const PAGE_GAMES = [wordle, chess, scrabble, poker, golf, landlord, hexhaven, stonks];
const LIVE_PAGES = [stonks];

const gameOfMode = (mode) => MATCH_GAMES[mode.split(":")[0]] ?? chess;
const MATCH_PATH = new RegExp(
  `^(?:${Object.values(MATCH_GAMES)
    .flatMap((g) => g.paths)
    .join("|")})/([a-z0-9]+)$`,
);

const home = (crew, images) =>
  frame(
    h("div", { fontSize: 88, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, maxWidth: 980 }, "Who are we ruining today?"),
    h(
      "div",
      { alignItems: "center", justifyContent: "space-between" },
      crewRow(crew, images),
      h(
        "div",
        { flexDirection: "column", alignItems: "flex-end", color: CARD.soft, fontSize: 30, fontWeight: 500 },
        `${crew.length} in the crew`,
        h("div", { color: BRAND, fontWeight: 800 }, "Tap to join"),
      ),
    ),
  );

const CARDS = { home, ...Object.fromEntries(PAGE_GAMES.map((g) => [g.key, gameCard(g.card)])) };

const PAGES = {
  "/": {
    title: () => "Group 53 Games",
    description: (crew) => `${crew.length} in the crew. Little games for the group, built so you can mess with each other.`,
    card: "home",
  },
  ...Object.fromEntries(
    PAGE_GAMES.flatMap((g) =>
      g.paths.map((path) => [path, { title: () => g.page.title, description: () => g.page.description, card: g.key }]),
    ),
  ),
  "/crew": {
    title: () => "The crew",
    description: (crew) => crew.map((p) => p.name).join(", "),
    card: "home",
  },
};

const getCrew = () => convex.query(anyApi.previews.crew, {});

const version = (data) => createHash("sha1").update(JSON.stringify(data)).digest("hex").slice(0, 10);

const matchVersion = (m) => version([m.status, m.moveCount, m.board, ...(gameOfMode(m.mode).version?.(m) ?? [])]);

const rendered = new Map();
async function renderCard(card) {
  const crew = await getCrew();
  const key = `${card}:${version(crew)}`;
  const hit = rendered.get(key);
  if (hit && Date.now() - hit.at < CARD_CACHE_MS) return hit.png;
  const images = await Promise.all(crew.slice(0, CREW_SHOWN).map((p) => fetchImage(p.image)));
  const png = await renderPng(CARDS[card](crew, images));
  rendered.set(key, { png, at: Date.now() });
  return png;
}

async function livePage(pathname) {
  for (const g of LIVE_PAGES) {
    const page = await g.livePage(convex, pathname);
    if (page) return page;
  }
  return null;
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function pageHtml(pathname, search) {
  let title, description, image;
  const game = pathname.match(MATCH_PATH);
  const m = game ? await convex.query(anyApi.previews.match, { id: game[1] }) : null;
  const live = await livePage(pathname);
  if (live) {
    ({ title, description } = live);
    image = `${SITE}${live.image.path}?v=${version(live.image.version)}`;
  } else if (m) {
    const text = matchText(gameOfMode(m.mode), m);
    title = text.title;
    description = `${text.mode}. ${text.status}`;
    image = `${SITE}/og/match/${game[1]}.png?v=${matchVersion(m)}`;
  } else {
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
<meta name="theme-color" content="${BRAND}">
</head><body><a href="${escape(url)}">${escape(title)}</a></body></html>`;
}

const png = (res, body, maxAge) => {
  res.writeHead(200, { "content-type": "image/png", "cache-control": `public, max-age=${maxAge}` });
  res.end(body);
};

async function liveImage(pathname) {
  for (const g of LIVE_PAGES) {
    const image = await g.image(convex, pathname);
    if (image !== undefined) return image;
  }
  return undefined;
}

http
  .createServer(async (req, res) => {
    const { pathname, search } = new URL(req.url ?? "/", SITE);
    try {
      const card = pathname.match(/^\/og\/image\/(\w+)\.png$/);
      if (card) {
        if (!CARDS[card[1]]) return void res.writeHead(404).end();
        return png(res, await renderCard(card[1]), 300);
      }
      const matchImage = pathname.match(/^\/og\/match\/([a-z0-9]+)\.png$/);
      if (matchImage) {
        const m = await convex.query(anyApi.previews.match, { id: matchImage[1] });
        if (!m) return void res.writeHead(404).end();
        return png(res, await renderMatch(gameOfMode(m.mode), m), 60);
      }
      const image = await liveImage(pathname);
      if (image === null) return void res.writeHead(404).end();
      if (image) return png(res, image, 60);
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
