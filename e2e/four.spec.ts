import type { Browser, Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test, type Player } from "./fixtures";

async function otherPhone(browser: Browser, player: Player) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  return { context, page: await phone(context, { player, notifications: "granted" }) };
}

async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByRole("link", { name: "Play" }).first()).toBeVisible();
}

const getMatch = (id: string) => admin().query(anyApi.testing.getMatch, { id });
const matchIdOf = (page: Page) => page.url().split("/chess/")[1].split("?")[0];

async function tapMove(page: Page, from: string, to: string) {
  await page.locator(`[data-square=${from}]`).click();
  await page.locator(`[data-square=${to}]`).click();
}

// Four signed-in phones with push on. The first uses the test's own context.
async function fourPhones(browser: Browser, context: Parameters<typeof phone>[0], names = ["Shlok", "Chris", "Sam", "Alex"]) {
  const players = await Promise.all(names.map((n) => createPlayer(n)));
  const first = await phone(context, { player: players[0], notifications: "granted" });
  const rest = await Promise.all(players.slice(1).map((p) => otherPhone(browser, p)));
  const pages = [first, ...rest.map((r) => r.page)];
  for (const p of pages) await enablePush(p);
  return { players, pages, close: () => Promise.all(rest.map((r) => r.context.close())) };
}

// The phone playing each color.
async function byColor(id: string, players: Player[], pages: Page[]) {
  const m = await getMatch(id);
  const pageOf = (color: string) => pages[players.findIndex((p) => p.userId === m.players.find((s: { color: string }) => s.color === color).userId)];
  return { red: pageOf("red"), blue: pageOf("blue"), yellow: pageOf("yellow"), green: pageOf("green") };
}

// Real-time pieces are placed by transform; this checks one sits on a square.
async function pieceOn(page: Page, piece: string, square: string) {
  const sq = await page.locator(`[data-square=${square}]`).boundingBox();
  const boxes = await page.locator(`[data-piece="${piece}"]`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  return boxes.some((b) => Math.abs(b.x - sq!.x) < 2 && Math.abs(b.y - sq!.y) < 2);
}

test.describe("4-player chess", () => {
  test("the chess screen has async and real-time columns, and each mode opens its own page", async ({ context }) => {
    const me = await createPlayer("Shlok");
    const page = await phone(context, { player: me, notifications: "granted" });
    await enablePush(page);
    await page.goto("/chess");
    const async = page.getByRole("region", { name: "Async" });
    const realtime = page.getByRole("region", { name: "Real-time" });
    await expect(async.getByRole("link")).toHaveText([/Classic/, /4-Player/]);
    await expect(realtime.getByRole("link")).toHaveText([/Real-time/, /4-Player/]);
    // Side by side, not stacked.
    const [l, r] = [await async.boundingBox(), await realtime.boundingBox()];
    expect(Math.abs(l!.y - r!.y)).toBeLessThan(2);
    expect(r!.x).toBeGreaterThan(l!.x + l!.width - 1);

    await async.getByRole("link", { name: "Async 4-Player" }).click();
    await expect(page.getByRole("heading", { name: "4-player chess" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Find a game" })).toBeVisible();
    await page.getByRole("link", { name: "Back to chess" }).click();
    await realtime.getByRole("link", { name: "Real-time 4-Player" }).click();
    await expect(page.getByRole("heading", { name: "4-player real-time chess" })).toBeVisible();
    // Old links still land on the right mode.
    await page.goto("/chess?mode=chess:realtime");
    await expect(page.getByRole("heading", { name: "Real-time chess" })).toBeVisible();
  });

  test("challenge three friends; a push link, the home inbox, and a notification tap each put them in the game", async ({ context, browser }) => {
    test.setTimeout(120_000);
    const { players, pages, close } = await fourPhones(browser, context);
    const [a, b, c, d] = pages;

    await a.goto("/chess/mode/four");
    await a.getByRole("button", { name: "Challenge" }).click();
    const sheet = a.getByRole("dialog");
    for (const name of ["Chris", "Sam", "Alex"]) await sheet.getByRole("button", { name: new RegExp(name) }).click();
    await sheet.getByRole("button", { name: "Send challenge" }).click();
    await expect(a.getByRole("heading", { name: "Challenge sent" })).toBeVisible();
    await expect(a.getByRole("list", { name: "Seats" }).getByLabel("Asked Chris")).toBeVisible();
    const id = matchIdOf(a);

    // Chris opens the link from the push: that alone accepts.
    await b.goto(`/chess/${id}?accept=1`);
    await expect(b.getByRole("heading", { name: "You're in. Waiting for 2 more" })).toBeVisible();
    await expect(a.getByRole("list", { name: "Seats" }).getByLabel("Asked Chris")).toHaveCount(0);

    // Sam accepts from the home screen inbox.
    await c.goto("/");
    await c.getByRole("region", { name: "Challenge from Shlok" }).getByRole("button", { name: "Accept" }).click();
    await expect(c.getByRole("heading", { name: "You're in. Waiting for 1 more" })).toBeVisible();
    await expect(a.getByRole("heading", { name: "Waiting for 1 more" })).toBeVisible();

    // Alex taps the notification while the app is open on the home screen: the service worker hands the
    // URL to the app, which routes there and takes the seat.
    await d.goto("/");
    await expect(d.getByRole("region", { name: "Challenge from Shlok" })).toBeVisible();
    await d.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "navigate", url } })), `${new URL(d.url()).origin}/chess/${id}?accept=1`);
    for (const p of pages) await expect(p.getByRole("grid", { name: "4-player chess board" })).toBeVisible();
    expect(d.url()).not.toContain("accept=1");

    const m = await getMatch(id);
    expect(m.status).toBe("active");
    expect(m.players.map((p: { color: string }) => p.color).sort()).toEqual(["blue", "green", "red", "yellow"]);
    const g = await byColor(id, players, pages);

    // Everyone sees their own army at the bottom of their board.
    for (const [color, page] of Object.entries(g)) {
      const board = (await page.getByRole("grid", { name: "4-player chess board" }).boundingBox())!;
      const king = (await page.locator(`[data-piece="${color}K"]`).boundingBox())!;
      expect(king.y, `${color}'s king sits at the bottom`).toBeGreaterThan(board.y + board.height * 0.8);
    }

    // Red moves first; it shows up live for blue, whose turn it is next.
    await expect(g.red.locator('[data-seat="red"]')).toContainText("Move");
    await tapMove(g.red, "e2", "e4");
    await expect(g.blue.getByLabel("Moves")).toContainText("e4");
    await expect(g.blue.locator('[data-seat="blue"]')).toContainText("Move");
    await expect(g.red.locator('[data-seat="red"]')).not.toContainText("Move");
    // Red can't move again out of turn.
    await g.red.locator("[data-square=d2]").click();
    await expect(g.red.locator("[data-square=d3] span.rounded-full")).toHaveCount(0);
    await tapMove(g.blue, "b5", "d5");
    await expect(g.yellow.getByLabel("Moves")).toContainText("d5");

    // Green resigns out of turn; the game goes on and green's army turns grey everywhere.
    await g.green.getByRole("button", { name: "Resign" }).click();
    await g.green.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
    await expect(g.red.locator('[data-seat="green"]')).toContainText("Resigned");
    await expect(g.red.locator('[data-piece="deadK"]')).toHaveCount(1);
    await expect(g.green.getByText("You're out")).toBeVisible();

    // Blue and yellow resign too, so red is the last one standing.
    for (const p of [g.yellow, g.blue]) {
      await p.getByRole("button", { name: "Resign" }).click();
      await p.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
    }
    await expect(g.red.getByRole("heading", { name: "You won" })).toBeVisible();
    await expect(g.blue.getByRole("heading", { name: "You placed 2nd" })).toBeVisible();
    await expect(g.green.getByRole("heading", { name: "You placed 4th" })).toBeVisible();
    await expect(g.red.getByRole("list", { name: "Final standings" }).getByRole("listitem")).toHaveCount(4);
    await expect(g.red.getByText("Last one standing")).toBeVisible();

    // A rematch needs all four.
    await g.red.getByRole("button", { name: "Rematch" }).click();
    await expect(g.red.getByText(/Waiting for .* and /)).toBeVisible();
    for (const p of [g.blue, g.yellow]) await p.getByRole("button", { name: "Accept rematch" }).click();
    await expect(g.green.getByText("(3/4 in)")).toBeVisible();
    await g.green.getByRole("button", { name: "Accept rematch" }).click();
    for (const p of pages) await expect.poll(() => matchIdOf(p)).not.toBe(id);
    for (const p of pages) await expect(p.getByRole("grid", { name: "4-player chess board" })).toHaveCount(1);
    await close();
  });

  test("an open 4-player lobby fills from the queue", async ({ context, browser }) => {
    test.setTimeout(90_000);
    const { pages, close } = await fourPhones(browser, context);
    await pages[0].goto("/chess/mode/four");
    await pages[0].getByRole("button", { name: "Find a game" }).click();
    await expect(pages[0].getByRole("heading", { name: "Waiting for 3 more" })).toBeVisible();
    const id = matchIdOf(pages[0]);
    for (const [i, p] of pages.slice(1).entries()) {
      await p.goto("/chess/mode/four");
      await expect(p.getByText("Open seats")).toBeVisible();
      await p.getByRole("button", { name: "Join a game" }).click();
      if (i < 2) await expect(p.getByRole("heading", { name: `You're in. Waiting for ${2 - i} more` })).toBeVisible();
    }
    for (const p of pages) await expect(p.getByRole("grid", { name: "4-player chess board" })).toBeVisible();
    expect((await getMatch(id)).status).toBe("active");
    await close();
  });

  test("real-time 4-player: everyone's army at the bottom, moves land on every phone, and a fallen king greys an army", async ({ context, browser }) => {
    test.setTimeout(120_000);
    const { players, pages, close } = await fourPhones(browser, context);
    const id = await admin().action(anyApi.testing.startFour, { mode: "chess:realtime4", players: players.map((p) => p.userId) });
    for (const p of pages) await p.goto(`/chess/${id}`);
    for (const p of pages) await expect(p.getByRole("grid", { name: "4-player real-time chess board" })).toBeVisible();
    await expect.poll(async () => (await getMatch(id)).state?.startAt ?? null, { timeout: 15_000 }).not.toBeNull();
    const [red, blue, yellow, green] = pages;
    await expect(red.locator("[data-piece]")).toHaveCount(64);
    for (const [color, page] of [["red", red], ["blue", blue], ["yellow", yellow], ["green", green]] as const) {
      const board = (await page.getByRole("grid", { name: "4-player real-time chess board" }).boundingBox())!;
      const king = (await page.locator(`[data-piece="${color}K"]`).boundingBox())!;
      expect(king.y, `${color}'s king sits at the bottom`).toBeGreaterThan(board.y + board.height * 0.8);
    }

    // Countdown, then all four move at once.
    await red.waitForTimeout(3400);
    await tapMove(red, "e2", "e3");
    await tapMove(blue, "b5", "c5");
    await tapMove(yellow, "e13", "e12");
    await tapMove(green, "m5", "l5");
    for (const p of pages) {
      await expect.poll(() => pieceOn(p, "redP", "e3"), { timeout: 6000 }).toBe(true);
      await expect.poll(() => pieceOn(p, "greenP", "l5"), { timeout: 6000 }).toBe(true);
    }

    // Green resigns: its army freezes in grey on every board, and green can't move it.
    await green.getByRole("button", { name: "Resign" }).click();
    await green.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
    for (const p of pages) await expect(p.locator('[data-piece^="dead"]')).toHaveCount(16, { timeout: 6000 });
    await expect(red.locator('[data-seat="green"]')).toContainText("King fell");
    await expect(green.getByText("Your king fell")).toBeVisible();
    await close();
  });

  test("a notification tapped while the app was closed is picked up when it opens", async ({ context }) => {
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const page = await phone(context, { player: chris, notifications: "granted" });
    await enablePush(page);
    const id = await admin().action(anyApi.testing.startMatch, { mode: "chess:classic", a: shlok.userId, b: chris.userId });
    // What public/sw.js leaves behind when iOS opens the app at its start page instead.
    await page.evaluate(async (url) => {
      const cache = await caches.open("group53-pending");
      await cache.put("/__pending-navigation", new Response(JSON.stringify({ url, at: Date.now() })));
    }, `/chess/${id}`);
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/chess/${id}$`));
    await expect(page.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    // It's used once: going home stays home.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Games" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
