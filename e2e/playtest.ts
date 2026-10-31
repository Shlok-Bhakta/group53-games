// A staging table for playtesting with agents:
//   PLAYWRIGHT_BROWSERS_PATH=0 node --experimental-strip-types e2e/playtest.ts
//
// Starts a throwaway backend and the built app (like the e2e suite), opens one phone per player, sets up the
// games below through the UI, and serves each phone over HTTP on 127.0.0.1:4600 so an agent can play it:
//   GET  /p/:name            the screen as an accessibility tree, the URL, and errors since the last look
//   GET  /p/:name/wait       waits (up to 25s) until it's that player's move or the game is over, then the screen
//   POST /p/:name/tap        {"role":"button","name":"Call 20","exact":true} taps it, then the screen
//   POST /p/:name/shot       saves a screenshot and returns its path
//   GET  /status             every game's status, hand and whose turn
// It stops by itself once every game is over (or after 40 minutes) and writes e2e/.state/playtest.json.
import http from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { startBackend, stopBackend } from "./backend.mjs";
import { admin, createPlayer, phone, type Player } from "./fixtures.ts";

const GAMES = [
  { mode: "holdem", players: ["Ada", "Linus", "Grace"], hands: "5" },
  { mode: "draw", players: ["Ken", "Barbara"], hands: "5" },
];
const PORT = 4600;
const LIMIT_MS = 40 * 60 * 1000;

const backend = await startBackend();
// Its own process group, so stopping it also stops the vite under npx.
const preview = spawn("npx", ["vite", "preview", "--outDir", "e2e/.state/dist", "--port", "4573", "--strictPort", "--host", "127.0.0.1"], { stdio: "ignore", detached: true });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch();

type Seat = { player: Player; page: Page; errors: string[]; matchId: string };
const seats = new Map<string, Seat>();
const matchIds: string[] = [];

for (const g of GAMES) {
  const pages: Page[] = [];
  const players: Player[] = [];
  for (const name of g.players) {
    const player = await createPlayer(name);
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:4573", viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
    const page = await phone(context, { player, notifications: "granted" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => void (m.type() === "error" && errors.push(`console: ${m.text().slice(0, 400)}`)));
    await page.goto("/");
    await page.getByRole("button", { name: "Turn on notifications" }).click();
    pages.push(page);
    players.push(player);
    seats.set(name, { player, page, errors, matchId: "" });
  }
  const host = pages[0];
  await host.goto(`/poker/mode/${g.mode}`);
  await host.getByRole("button", { name: "Settings" }).click();
  await host.getByRole("radiogroup", { name: "Hands" }).getByRole("radio", { name: g.hands, exact: true }).click();
  await host.getByRole("button", { name: "Open a game" }).click();
  await host.getByRole("heading", { name: "Waiting for players" }).waitFor();
  const id = host.url().split("/poker/")[1].split("?")[0];
  for (const p of pages.slice(1)) await p.goto(`/poker/${id}?accept=1`);
  await host.getByRole("heading", { name: `${pages.length} in` }).waitFor();
  await host.getByRole("button", { name: `Start with ${pages.length}` }).click();
  matchIds.push(id);
  for (const name of g.players) seats.get(name)!.matchId = id;
}

const getMatch = (id: string) => admin().query(anyApi.testing.getMatch, { id });
async function screen(name: string) {
  const s = seats.get(name)!;
  await s.page.waitForTimeout(600);
  const tree = await s.page.locator("body").ariaSnapshot().catch((e) => `(no snapshot: ${e.message})`);
  const errors = s.errors.splice(0);
  return { url: s.page.url(), errors, screen: tree || "(blank screen)" };
}
async function status() {
  return Promise.all(
    matchIds.map(async (id) => {
      const m = await getMatch(id);
      const up = m.state?.turn >= 0 ? [...seats.entries()].find(([, s]) => s.player.userId === m.players[m.state.turn].userId)?.[0] : null;
      return { id, mode: m.mode, status: m.status, hand: m.state?.hand, turn: m.status === "active" ? up : null, stacks: m.state?.stacks, result: m.result?.reason ?? null };
    }),
  );
}

const body = (req: http.IncomingMessage) => new Promise<string>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const server = http.createServer(async (req, res) => {
  const send = (code: number, data: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(data, null, 1));
  };
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/status") return send(200, await status());
    const m = url.pathname.match(/^\/p\/([^/]+)(?:\/(wait|tap|shot))?$/);
    const name = m && decodeURIComponent(m[1]);
    if (!name || !seats.has(name)) return send(404, { error: `No player like that. Players: ${[...seats.keys()].join(", ")}` });
    const s = seats.get(name)!;
    if (m![2] === "wait") {
      const end = Date.now() + 25_000;
      while (Date.now() < end) {
        const g = await getMatch(s.matchId);
        if (g.status !== "active" || g.turn === s.player.userId) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return send(200, await screen(name));
    }
    if (m![2] === "tap" && req.method === "POST") {
      const { role = "button", name: label, exact = true } = JSON.parse((await body(req)) || "{}");
      const target = s.page.getByRole(role, { name: label, exact });
      const count = await target.count();
      if (count === 0) return send(400, { error: `Nothing on screen with role ${role} and name "${label}".`, ...(await screen(name)) });
      await target.first().click({ timeout: 5000 });
      return send(200, await screen(name));
    }
    if (m![2] === "shot") {
      const path = `/tmp/playtest-${name}-${Date.now()}.png`;
      await s.page.screenshot({ path });
      return send(200, { path });
    }
    return send(200, await screen(name));
  } catch (e) {
    send(500, { error: String(e) });
  }
});
server.listen(PORT, "127.0.0.1");
console.log(`Playtest ready on http://127.0.0.1:${PORT}. Players: ${[...seats.keys()].join(", ")}`);

const started = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await status();
  if (st.every((g) => g.status !== "active") || Date.now() - started > LIMIT_MS) {
    writeFileSync("e2e/.state/playtest.json", JSON.stringify({ games: st, leftoverErrors: Object.fromEntries([...seats].map(([n, s]) => [n, s.errors])) }, null, 1));
    console.log("Playtest over", JSON.stringify(st));
    // Leave a minute for the agents to look at the result screens.
    await new Promise((r) => setTimeout(r, 90_000));
    break;
  }
}
server.close();
await browser.close();
process.kill(-preview.pid!);
stopBackend(backend.name);
process.exit(0);
