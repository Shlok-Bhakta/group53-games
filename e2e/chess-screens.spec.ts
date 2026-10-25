// Visual review: SCREENS=1 npm run test:e2e -- chess-screens
import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

const AV = {
  shlok: "https://cdn.discordapp.com/avatars/719077732042014761/44639fc5bce7c79f99de5625f7fed7a8.png?size=256",
  chris: "https://cdn.discordapp.com/avatars/492431153375084547/f69aa29f75cacbf294c0d465c351d701.png?size=256",
};

async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}
const shot = async (page: Page, name: string, full = false) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `e2e/.state/screens/chess-${name}.png`, fullPage: full });
};
const tap = async (page: Page, from: string, to: string) => {
  await page.locator(`[data-square=${from}]`).click();
  await page.locator(`[data-square=${to}]`).click();
};

test("chess screens", async ({ browser }) => {
  test.setTimeout(120_000);
  const shlok = await createPlayer("WashableBowl700", { image: AV.shlok, frame: "holo", badge: "🐐" });
  const chris = await createPlayer("chrisis14", { image: AV.chris, frame: "comet", frameColor: "#3b82f6" });
  const mk = async (p: typeof shlok, scheme: "dark" | "light" = "dark") => {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme });
    return phone(ctx, { player: p, notifications: "granted" });
  };
  const a = await mk(shlok);
  const b = await mk(chris, "light");
  await enablePush(a);
  await enablePush(b);

  await a.goto("/");
  await shot(a, "home-empty");
  await a.goto("/games");
  await shot(a, "games");
  await a.goto("/chess");
  await shot(a, "hub", true);
  await a.goto("/chess/mode/classic");
  await shot(a, "mode-classic", true);
  await a.getByRole("button", { name: "Find a game" }).click();
  await a.waitForURL(/\/chess\/[a-z0-9]+$/);
  await shot(a, "lobby");
  const id = a.url().split("/chess/")[1];

  await b.goto("/chess/mode/classic");
  await shot(b, "mode-join-light", true);
  await b.getByRole("button", { name: "Join a game" }).click();
  await expect(b.getByRole("grid")).toBeVisible();
  const m = await admin().query(anyApi.testing.getMatch, { id });
  const white = m.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId ? a : b;
  const black = white === a ? b : a;
  for (const [pg, f, t] of [[white, "e2", "e4"], [black, "e7", "e5"], [white, "g1", "f3"], [black, "b8", "c6"], [white, "f1", "c4"]] as const) {
    await tap(pg, f, t);
    await expect(pg === white ? black.getByLabel("Moves") : white.getByLabel("Moves")).toContainText(f === "g1" ? "Nf3" : f === "b8" ? "Nc6" : f === "f1" ? "Bc4" : t);
  }
  await black.locator("[data-square=g8]").click();
  await shot(black, "classic-selected");
  await shot(white, "classic-waiting");

  // Real-time
  await a.goto("/chess/mode/realtime");
  await a.getByRole("button", { name: "Find a game" }).click();
  await a.waitForURL(/\/chess\/[a-z0-9]+$/);
  const rid = a.url().split("/chess/")[1];
  await b.goto(`/chess/${rid}`);
  await b.getByRole("button", { name: "Join game" }).click();
  await a.waitForTimeout(1500);
  await shot(a, "rt-countdown");
  await a.waitForTimeout(2600);
  const rm = await admin().query(anyApi.testing.getMatch, { id: rid });
  const rw = rm.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId ? a : b;
  const rb = rw === a ? b : a;
  await tap(rw, "e2", "e4");
  await tap(rb, "d7", "d5");
  await tap(rw, "g1", "f3");
  await rw.waitForTimeout(500);
  await shot(rw, "rt-moving");
  await rw.waitForTimeout(1700);
  await tap(rw, "e4", "e5");
  await rw.locator("[data-square=f3]").click();
  await shot(rw, "rt-cooldown");
  await rw.getByRole("button", { name: "Resign" }).click();
  await rw.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
  await expect(rb.getByRole("heading", { name: "You won" })).toBeVisible();
  await shot(rb, "result", true);
});

test("four-player screens", async ({ browser }) => {
  test.setTimeout(150_000);
  const people = await Promise.all([
    createPlayer("WashableBowl700", { image: AV.shlok, frame: "holo", badge: "🐐" }),
    createPlayer("chrisis14", { image: AV.chris, frame: "comet", frameColor: "#3b82f6" }),
    createPlayer("samwise"),
    createPlayer("alex_dev"),
  ]);
  const mk = async (p: (typeof people)[number], scheme: "dark" | "light" = "dark") => {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme });
    return phone(ctx, { player: p, notifications: "granted" });
  };
  const pages = [await mk(people[0]), await mk(people[1], "light"), await mk(people[2]), await mk(people[3])];
  for (const p of pages) await enablePush(p);
  const [a, b, c] = pages;

  // A challenge waiting in the home inbox, alongside a classic game where it's your move.
  await admin().action(anyApi.testing.startMatch, { mode: "chess:classic", a: people[1].userId, b: people[0].userId });
  await a.goto("/chess/mode/four");
  for (const n of ["chrisis14", "samwise"]) await a.getByRole("button", { name: n, exact: true }).click();
  await shot(a, "four-challenge-sheet");
  await a.getByRole("button", { name: /Challenge 2/ }).click();
  await a.waitForURL(/\/chess\/[a-z0-9]+$/);
  await shot(a, "four-lobby");
  await b.goto("/");
  await shot(b, "home-inbox-light", true);
  await b.goto("/chess");
  await shot(b, "hub-light", true);

  // A game in progress, from each side.
  const id = await admin().action(anyApi.testing.startFour, { mode: "chess:four", players: people.map((p) => p.userId) });
  for (const p of pages) await p.goto(`/chess/${id}`);
  const moves: [number, string, string][] = [[0, "e2", "e4"], [1, "b5", "d5"], [2, "f13", "f11"], [3, "m10", "k10"], [0, "e1", "f3"], [1, "a5", "c6"]];
  for (const [i, f, t] of moves) {
    await tap(pages[i], f, t);
    await expect(pages[(i + 1) % 4].getByLabel("Moves")).toContainText(t);
  }
  await c.locator("[data-square=f13]").click();
  await shot(c, "four-yellow-selected", true);
  await shot(a, "four-red", true);
  await shot(b, "four-blue-light", true);

  // Real-time.
  const rid = await admin().action(anyApi.testing.startFour, { mode: "chess:realtime4", players: people.map((p) => p.userId) });
  for (const p of pages) await p.goto(`/chess/${rid}`);
  await a.waitForTimeout(1200);
  await shot(a, "four-rt-countdown");
  await a.waitForTimeout(2800);
  await tap(a, "e2", "e4");
  await tap(b, "b5", "d5");
  await a.waitForTimeout(700);
  await shot(a, "four-rt-moving", true);
  await pages[3].getByRole("button", { name: "Resign" }).click();
  await pages[3].getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
  await a.waitForTimeout(1500);
  await shot(a, "four-rt-grey", true);
});
