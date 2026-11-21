import http from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { startBackend, stopBackend, waitForUrl } from "./backend.mjs";
import { admin, createPlayer, holdsStill, phone, type Player } from "./fixtures.ts";

const PLAYERS = (process.env.PLAYERS ?? "Ada,Linus,Grace,Ken").split(",");
const GOAL = process.env.GOAL ?? "5";
const PORT = 4600;
const LIMIT_MS = Number(process.env.LIMIT_MIN ?? 75) * 60 * 1000;
const TIME_TO_LOOK_AT_RESULTS_MS = 120_000;
const WAIT_MS = 25_000;
const APP = "http://127.0.0.1:4573";

type Wordle = {
  round: number;
  over: boolean;
  rules: { goal: number };
  players: { coins: number; solved: number; guesses: number; done: boolean; picked: boolean; effects: { item: string }[] }[];
  history: { buys: unknown[] }[];
};

const backend = await startBackend();
// platform: detached gives npx its own process group, so killing the group also stops the vite it starts.
const preview = spawn("npx", ["vite", "preview", "--outDir", "e2e/.state/dist", "--port", "4573", "--strictPort", "--host", "127.0.0.1"], {
  stdio: "ignore",
  detached: true,
});
await waitForUrl(APP);
const browser = await chromium.launch();

type Seat = { player: Player; page: Page; errors: string[] };
const seats = new Map<string, Seat>();
for (const name of PLAYERS) {
  const player = await createPlayer(name);
  const context = await browser.newContext({
    baseURL: APP,
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  const page = await phone(context, { player, notifications: "granted" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => void (m.type() === "error" && errors.push(`console: ${m.text().slice(0, 400)}`)));
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  seats.set(name, { player, page, errors });
}

const pages = [...seats.values()].map((s) => s.page);
const host = pages[0];
await host.goto("/wordle/mode/classic");
await host.getByRole("button", { name: "Settings" }).click();
await host.getByRole("radiogroup", { name: "Words to win" }).getByRole("radio", { name: GOAL, exact: true }).click();
await host.getByRole("radiogroup", { name: "Time per word" }).getByRole("radio", { name: "No limit", exact: true }).click();
await host.getByRole("button", { name: "Open a game" }).click();
await host.getByRole("heading", { name: "Waiting for players" }).waitFor();
const id = host.url().split("/wordle/")[1].split("?")[0];
for (const [i, p] of pages.slice(1).entries()) {
  await p.goto(`/wordle/${id}?accept=1`);
  await host.getByRole("heading", { name: `${i + 2} in` }).waitFor();
}
await host.getByRole("button", { name: `Start with ${pages.length}` }).click();
for (const p of pages) await p.getByRole("group", { name: "Keyboard" }).waitFor({ timeout: 20_000 });

const getMatch = (matchId: string) => admin().query(anyApi.testing.getMatch, { id: matchId });
const seatOf = (m: { players: { userId: string }[] }, name: string) =>
  m.players.findIndex((p) => p.userId === seats.get(name)!.player.userId);

async function screen(name: string, extra: Record<string, unknown> = {}) {
  const s = seats.get(name)!;
  await holdsStill(s.page).catch(() => {});
  const tree = await s.page
    .locator("body")
    .ariaSnapshot()
    .catch((e) => `(no snapshot: ${e.message})`);
  return { ...extra, errors: s.errors.splice(0), screen: tree || "(blank screen)" };
}

async function status() {
  const m = await getMatch(id);
  const s = m.state as Wordle;
  return {
    status: m.status,
    word: s.round + 1,
    goal: s.rules.goal,
    result: m.result?.reason ?? null,
    waitingOn: (m.waitingOn ?? []).map((u: string) => [...seats].find(([, x]) => x.player.userId === u)?.[0]),
    players: Object.fromEntries(
      [...seats.keys()].map((n) => {
        const p = s.players[seatOf(m, n)];
        return [n, { solved: p.solved, coins: p.coins, guesses: p.guesses, doneWithWord: p.done, shopped: p.picked }];
      }),
    ),
  };
}

const body = (req: http.IncomingMessage) =>
  new Promise<string>((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });

const toasts = (page: Page) =>
  page
    .locator("[data-sonner-toast]")
    .allInnerTexts()
    .catch(() => [] as string[]);

const server = http.createServer(async (req, res) => {
  const send = (code: number, data: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(data, null, 1));
  };
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/status") return send(200, await status());
    const m = url.pathname.match(/^\/p\/([^/]+)(?:\/(wait|tap|type|key|shot))?$/);
    const name = m && decodeURIComponent(m[1]);
    if (!name || !seats.has(name)) return send(404, { error: `No player like that. Players: ${[...seats.keys()].join(", ")}` });
    const s = seats.get(name)!;
    if (m![2] === "wait") {
      const end = Date.now() + WAIT_MS;
      while (Date.now() < end) {
        const g = await getMatch(id);
        if (g.status !== "active" || (g.waitingOn ?? []).includes(s.player.userId)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      const g = await getMatch(id);
      const yourMove = g.status === "active" && (g.waitingOn ?? []).includes(s.player.userId);
      return send(200, await screen(name, { yourMove, over: g.status !== "active" }));
    }
    if (m![2] === "type" && req.method === "POST") {
      const { word = "" } = JSON.parse((await body(req)) || "{}");
      const keys = s.page.getByRole("group", { name: "Keyboard" });
      if (!(await keys.isVisible())) return send(400, { error: "No keyboard on screen right now.", ...(await screen(name)) });
      for (let i = 0; i < 5; i++) await keys.getByRole("button", { name: "Delete" }).click();
      for (const ch of String(word).toLowerCase()) {
        const key = keys.getByRole("button", { name: new RegExp(`^${ch.toUpperCase()}(, jammed)?$`) });
        await key.click({ timeout: 3000 });
      }
      const grid = s.page.getByRole("grid", { name: "Your board" });
      const before = await grid.getAttribute("data-played");
      await keys.getByRole("button", { name: "Enter" }).click();
      await Promise.race([
        s.page.locator(`[role=grid][data-played]:not([data-played="${before}"])`).waitFor(),
        s.page.locator("[data-sonner-toast]").first().waitFor(),
      ]).catch(() => {});
      return send(200, await screen(name, { messages: await toasts(s.page) }));
    }
    if (m![2] === "tap" && req.method === "POST") {
      const { role = "button", name: label, exact = true } = JSON.parse((await body(req)) || "{}");
      const target = s.page.getByRole(role, { name: label, exact });
      const count = await target.count();
      if (count === 0) return send(400, { error: `Nothing on screen with role ${role} and name "${label}".`, ...(await screen(name)) });
      await target.first().click({ timeout: 5000 });
      return send(200, await screen(name, { messages: await toasts(s.page) }));
    }
    if (m![2] === "key" && req.method === "POST") {
      const { key = "Escape" } = JSON.parse((await body(req)) || "{}");
      await s.page.keyboard.press(String(key));
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
  if (st.status !== "active" || Date.now() - started > LIMIT_MS) {
    const m = await getMatch(id);
    writeFileSync(
      "e2e/.state/playtest-wordle.json",
      JSON.stringify(
        { status: st, state: m.state, leftoverErrors: Object.fromEntries([...seats].map(([n, x]) => [n, x.errors])) },
        null,
        1,
      ),
    );
    console.log("Playtest over", JSON.stringify(st));
    await new Promise((r) => setTimeout(r, TIME_TO_LOOK_AT_RESULTS_MS));
    break;
  }
}
server.close();
await browser.close();
process.kill(-preview.pid!);
stopBackend(backend.name);
process.exit(0);
