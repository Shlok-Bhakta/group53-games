import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { FRAME_COLOR } from "../convex/palette";
import { admin, createPlayer, expect, phone, readyForShot, test } from "./fixtures";
import { rotate } from "./landscape";

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
  await readyForShot(page);
  await page.screenshot({ path: `e2e/.state/screens/chess-${name}.png`, fullPage: full });
};
const countdownShot = async (page: Page, name: string) => {
  await expect(page.locator('[data-countdown="2"]')).toBeVisible();
  await page.screenshot({ path: `e2e/.state/screens/chess-${name}.png` });
};
const playing = async (...pages: Page[]) => {
  for (const page of pages) await expect(page.locator("[data-playing]")).toBeVisible();
};
const tap = async (page: Page, from: string, to: string) => {
  await page.locator(`[data-square=${from}]`).click();
  await page.locator(`[data-square=${to}]`).click();
};

test("chess screens", async ({ browser }) => {
  test.setTimeout(120_000);
  const shlok = await createPlayer("WashableBowl700", { image: AV.shlok, frame: "holo", badge: "🐐" });
  const chris = await createPlayer("chrisis14", { image: AV.chris, frame: "comet", frameColor: FRAME_COLOR.blue });
  const mk = async (p: typeof shlok, scheme: "dark" | "light" = "dark") => {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
    });
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
  for (const [pg, f, t] of [
    [white, "e2", "e4"],
    [black, "e7", "e5"],
    [white, "g1", "f3"],
    [black, "b8", "c6"],
    [white, "f1", "c4"],
  ] as const) {
    await tap(pg, f, t);
    await pg.getByRole("button", { name: /^Confirm/ }).click();
    await expect(pg === white ? black.getByLabel("Moves") : white.getByLabel("Moves")).toContainText(
      f === "g1" ? "Nf3" : f === "b8" ? "Nc6" : f === "f1" ? "Bc4" : t,
    );
  }
  await black.locator("[data-square=g8]").click();
  await shot(black, "classic-selected");
  await shot(white, "classic-waiting");
  await black.locator("[data-square=f6]").click();
  await black.emulateMedia({ colorScheme: "dark" });
  await shot(black, "classic-confirm-dark");
  await black.emulateMedia({ colorScheme: "light" });
  await shot(black, "classic-confirm-light");
  await black.getByRole("button", { name: "Cancel", exact: true }).click();
  await white.getByRole("button", { name: "Previous move" }).click();
  await white.getByRole("button", { name: "Previous move" }).click();
  await expect(white.getByLabel("Moves").locator("[aria-current=step]")).toHaveText("Nf3");
  await shot(white, "classic-history");
  await white.getByRole("button", { name: "Back to the current position" }).click();

  await a.goto("/chess/mode/realtime");
  await a.getByRole("button", { name: "Find a game" }).click();
  await a.waitForURL(/\/chess\/[a-z0-9]+$/);
  const rid = a.url().split("/chess/")[1];
  await b.goto(`/chess/${rid}`);
  await b.getByRole("button", { name: "Join game" }).click();
  await countdownShot(a, "rt-countdown");
  await playing(a, b);
  const rm = await admin().query(anyApi.testing.getMatch, { id: rid });
  const rw = rm.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId ? a : b;
  const rb = rw === a ? b : a;
  await tap(rw, "e2", "e4");
  await tap(rb, "d7", "d5");
  await tap(rw, "g1", "f3");
  await expect(rw.locator('[data-piece="wN"][data-status=moving]')).toHaveCount(1);
  await shot(rw, "rt-moving");
  await expect(rw.locator('[data-piece^="w"][data-status=cooldown]')).toHaveCount(2);
  await tap(rw, "e4", "e5");
  await rw.locator("[data-square=f3]").click();
  await shot(rw, "rt-cooldown");
  await rw.getByRole("button", { name: "Resign" }).click();
  await rw.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
  await expect(rb.getByRole("heading", { name: "You won" })).toBeVisible();
  await shot(rb, "result", true);

  await white.goto(`/chess/${id}`);
  await rotate(white, "landscape");
  await shot(white, "classic-landscape");
});

test("four-player screens", async ({ browser }) => {
  test.setTimeout(150_000);
  const people = await Promise.all([
    createPlayer("WashableBowl700", { image: AV.shlok, frame: "holo", badge: "🐐" }),
    createPlayer("chrisis14", { image: AV.chris, frame: "comet", frameColor: FRAME_COLOR.blue }),
    createPlayer("samwise"),
    createPlayer("alex_dev"),
  ]);
  const mk = async (p: (typeof people)[number], scheme: "dark" | "light" = "dark") => {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
    });
    return phone(ctx, { player: p, notifications: "granted" });
  };
  const pages = [await mk(people[0]), await mk(people[1], "light"), await mk(people[2]), await mk(people[3])];
  for (const p of pages) await enablePush(p);
  const [a, b, c] = pages;

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

  const id = await admin().action(anyApi.testing.startFour, { mode: "chess:four", players: people.map((p) => p.userId) });
  for (const p of pages) await p.goto(`/chess/${id}`);
  const moves: [number, string, string][] = [
    [0, "e2", "e4"],
    [1, "b5", "d5"],
    [2, "f13", "f11"],
    [3, "m10", "k10"],
    [0, "e1", "f3"],
    [1, "a5", "c6"],
  ];
  for (const [i, f, t] of moves) {
    await tap(pages[i], f, t);
    await pages[i].getByRole("button", { name: /^Confirm/ }).click();
    await expect(pages[(i + 1) % 4].getByLabel("Moves")).toContainText(t);
  }
  await c.locator("[data-square=f11]").click();
  await shot(c, "four-yellow-selected", true);
  await shot(a, "four-red", true);
  await shot(b, "four-blue-light", true);
  await c.locator("[data-square=f10]").click();
  await shot(c, "four-confirm", true);
  await c.getByRole("button", { name: "Cancel", exact: true }).click();

  const rid = await admin().action(anyApi.testing.startFour, { mode: "chess:realtime4", players: people.map((p) => p.userId) });
  for (const p of pages) await p.goto(`/chess/${rid}`);
  await countdownShot(a, "four-rt-countdown");
  await playing(a, b);
  await tap(a, "e2", "e4");
  await tap(b, "b5", "d5");
  await expect(a.locator("[data-status=moving]")).toHaveCount(2);
  await shot(a, "four-rt-moving", true);
  await pages[3].getByRole("button", { name: "Resign" }).click();
  await pages[3].getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
  await expect(a.locator('[data-piece^="dead"]')).toHaveCount(16);
  await shot(a, "four-rt-grey", true);
  await rotate(a, "landscape");
  await shot(a, "four-rt-landscape");
  await a.goto(`/chess/${id}`);
  await rotate(a, "landscape");
  await shot(a, "four-landscape");
});
