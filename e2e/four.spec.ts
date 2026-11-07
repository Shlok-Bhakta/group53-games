import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, getMatch, holdsStill, matchIdOf, resign, test, type Phones, type Player } from "./fixtures";

async function tapMove(page: Page, from: string, to: string) {
  await page.locator(`[data-square=${from}]`).click();
  await page.locator(`[data-square=${to}]`).click();
}

// Four signed-in phones with push on, all opened at once.
async function fourPhones(phones: Phones, names = ["Shlok", "Chris", "Sam", "Alex"]) {
  const players = await Promise.all(names.map((n) => createPlayer(n)));
  const pages = await Promise.all(players.map((player) => phones.open({ player, push: "on" })));
  return { players, pages };
}

// A four-player game already under way, everyone on it: seats go red, blue, yellow, green in the order given.
async function fourGame(phones: Phones, mode: "chess:four" | "chess:realtime4") {
  const { players, pages } = await fourPhones(phones);
  const id: string = await admin().action(anyApi.testing.startFour, { mode, players: players.map((p) => p.userId) });
  await Promise.all(pages.map((p) => p.goto(`/chess/${id}`)));
  const [red, blue, yellow, green] = pages;
  return { id, players, pages, red, blue, yellow, green };
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

// Everyone sees their own army at the bottom of their board.
async function armiesAtTheBottom(g: Record<"red" | "blue" | "yellow" | "green", Page>, board: string) {
  for (const [color, page] of Object.entries(g)) {
    const box = (await page.getByRole("grid", { name: board }).boundingBox())!;
    const king = (await page.locator(`[data-piece="${color}K"]`).boundingBox())!;
    expect(king.y, `${color}'s king sits at the bottom`).toBeGreaterThan(box.y + box.height * 0.8);
  }
}

test.describe("4-player chess", () => {
  test("the chess page has async and real-time mode cards, and each opens its own page", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.goto("/games");
    await page.getByRole("link", { name: "Play Chess" }).click();
    await expect(page).toHaveURL(/\/chess$/);
    const async = page.getByRole("region", { name: "Async" });
    const realtime = page.getByRole("region", { name: "Real-time" });
    await expect(async.getByRole("link")).toHaveText([/1v1/, /4-Player/]);
    await expect(realtime.getByRole("link")).toHaveText([/1v1/, /4-Player/]);
    // Each card shows my Elo.
    await expect(async.getByRole("link", { name: "Async 1v1" }).getByLabel("Your rating 1200")).toBeVisible();

    await async.getByRole("link", { name: "Async 4-Player" }).click();
    await expect(page.getByRole("heading", { name: "4-Player", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Find a game" })).toBeVisible();
    // New to the mode, so the rules start open.
    await expect(page.getByRole("button", { name: "How to play" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Check two kings with one move")).toBeVisible();
    // Closing shrinks smoothly all the way down: no jump at the end when the list leaves the page.
    const rules = page.locator("section", { has: page.getByRole("button", { name: "How to play" }) });
    const open = (await rules.boundingBox())!.height;
    const heights: number[] = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll<HTMLElement>("[data-screen]:not([inert]) button")].find((b) => b.textContent?.includes("How to play"))!;
      const section = btn.closest("section")!;
      const out: number[] = [];
      btn.click();
      const t0 = performance.now();
      while (performance.now() - t0 < 600) {
        out.push(section.getBoundingClientRect().height);
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    const closed = heights.at(-1)!;
    expect(closed).toBeLessThan(60);
    expect(heights.some((h) => h > closed + 40 && h < open - 40), "passes through in-between heights").toBe(true);
    const steps = heights.slice(1).map((h, i) => heights[i] - h);
    expect(Math.max(...steps), "no frame drops more than a quarter of the way").toBeLessThan((open - closed) / 4);
    await page.getByRole("button", { name: "Back" }).click();
    await realtime.getByRole("link", { name: "Real-time 4-Player" }).click();
    await expect(page.getByRole("heading", { name: "Real-time 4-Player", level: 1 })).toBeVisible();
  });

  test("challenge three friends; a push link, the home inbox, and a notification tap each put them in the game", async ({ phones }) => {
    const { players, pages } = await fourPhones(phones);
    const [a, b, c, d] = pages;

    await a.goto("/chess/mode/four");
    for (const name of ["Chris", "Sam", "Alex"]) await a.getByRole("button", { name, exact: true }).click();
    await a.getByRole("button", { name: "Send challenge" }).click();
    await expect(a.getByRole("heading", { name: "Challenge sent" })).toBeVisible();
    await expect(a.getByRole("list", { name: "Seats" }).getByLabel("Asked Chris")).toBeVisible();
    const id = matchIdOf(a);

    // Chris opens the link from the push: that alone accepts.
    await b.goto(`/chess/${id}?accept=1`);
    await expect(b.getByRole("heading", { name: "You're in. Waiting for 2 more" })).toBeVisible();
    await expect(a.getByRole("list", { name: "Seats" }).getByLabel("Asked Chris")).toHaveCount(0);

    // Sam accepts from Home.
    await c.goto("/");
    await c.getByRole("region", { name: "Challenge from Shlok" }).getByRole("button", { name: "Accept" }).click();
    await expect(c.getByRole("heading", { name: "You're in. Waiting for 1 more" })).toBeVisible();
    await expect(a.getByRole("heading", { name: "Waiting for 1 more" })).toBeVisible();

    // Alex taps the notification while the app is open on Home: the service worker hands the
    // URL to the app, which routes there and takes the seat.
    await d.goto("/");
    await expect(d.getByRole("region", { name: "Challenge from Shlok" })).toBeVisible();
    await d.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "navigate", url } })), `${new URL(d.url()).origin}/chess/${id}?accept=1`);
    for (const p of pages) await expect(p.getByRole("grid", { name: "4-player chess board" })).toBeVisible();
    expect(d.url()).not.toContain("accept=1");

    const m = await getMatch(id);
    expect(m.status).toBe("active");
    expect(m.players.map((p: { color: string }) => p.color).sort()).toEqual(["blue", "green", "red", "yellow"]);
    await armiesAtTheBottom(await byColor(id, players, pages), "4-player chess board");
  });

  test("a move waits for Confirm and lands live, a resignation greys an army, the move line steps back, and the last one standing wins", async ({ phones }) => {
    const g = await fourGame(phones, "chess:four");
    for (const p of g.pages) await expect(p.getByRole("grid", { name: "4-player chess board" })).toBeVisible();

    // Red moves first; it shows up live for blue, whose turn it is next.
    await expect(g.red.getByText("Your move")).toBeVisible();
    await expect(g.blue.getByText(/^(\S+ is on it|Waiting for \D+)$/)).toBeVisible();
    // The ring around whoever's up is a circle hugging their avatar.
    const ring = await g.blue.locator('[data-seat="red"] > span').first().boundingBox();
    expect(ring!.height).toBeCloseTo(ring!.width, 0);
    // Where the board sits on the page once the screen has settled (on the page, not the screen, since
    // tapping Cancel can scroll it into view); a waiting move mustn't shift it.
    await holdsStill(g.red);
    const boardY = () => g.red.getByRole("grid").evaluate((el) => el.getBoundingClientRect().y + window.scrollY);
    const before = await boardY();
    await g.red.locator("[data-square=e2]").click();
    await expect(g.red.locator("[data-target]")).toHaveCount(2);
    await g.red.locator("[data-square=e3]").click();
    await expect(g.red.getByRole("button", { name: /^Confirm/ })).toBeVisible();
    await expect.poll(() => pieceOn(g.red, "redP", "e3")).toBe(true);
    expect((await getMatch(g.id)).state.moves).toHaveLength(0);
    await expect.poll(() => pieceOn(g.blue, "redP", "e2")).toBe(true);
    await g.red.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => pieceOn(g.red, "redP", "e2")).toBe(true);
    expect(await boardY()).toBeCloseTo(before, 0);
    await tapMove(g.red, "e2", "e4");
    await g.red.getByRole("button", { name: /^Confirm/ }).click();
    await expect(g.blue.getByLabel("Moves")).toContainText("e4");
    await expect(g.blue.getByText("Your move")).toBeVisible();
    await expect(g.red.getByText("Your move")).toHaveCount(0);
    // Red can't move again out of turn.
    await expect(g.red.getByRole("grid")).toHaveAttribute("data-disabled", "true");
    await g.red.locator("[data-square=d2]").click();
    await expect(g.red.locator("[data-target]")).toHaveCount(0);
    await tapMove(g.blue, "b5", "d5");
    await g.blue.getByRole("button", { name: /^Confirm/ }).click();
    await expect(g.yellow.getByLabel("Moves")).toContainText("d5");

    // A resignation changes the position and cancels any unconfirmed move.
    await tapMove(g.yellow, "f13", "f11");
    await expect(g.yellow.getByRole("button", { name: /^Confirm/ })).toBeVisible();
    expect((await getMatch(g.id)).state.moves).toHaveLength(2);

    // Green resigns out of turn; the game goes on and green's army turns grey everywhere.
    await resign(g.green);
    await expect(g.red.locator('[data-seat="green"]')).toContainText("Resigned");
    await expect(g.red.locator('[data-piece="deadK"]')).toHaveCount(1);
    await expect(g.yellow.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
    await expect.poll(() => pieceOn(g.yellow, "yellowP", "f13")).toBe(true);
    expect((await getMatch(g.id)).state.moves).toHaveLength(2);
    await expect(g.green.getByText("You're out")).toBeVisible();

    // Stepping back shows the board as it stood, green's army still in colour before it resigned.
    await g.red.getByRole("button", { name: "Previous move" }).click();
    await expect(g.red.getByLabel("Moves").locator("[aria-current=step]")).toContainText("e4");
    await expect.poll(() => pieceOn(g.red, "blueP", "b5")).toBe(true);
    await expect(g.red.locator('[data-piece="deadK"]')).toHaveCount(0);
    await g.red.getByRole("button", { name: "Next move" }).click();
    await expect(g.red.locator('[data-piece="deadK"]')).toHaveCount(1);
    await expect(g.red.getByRole("button", { name: "Next move" })).toBeDisabled();

    // Blue and yellow resign too, so red is the last one standing.
    for (const p of [g.yellow, g.blue]) await resign(p);
    await expect(g.red.getByRole("heading", { name: "You won" })).toBeVisible();
    await expect(g.blue.getByRole("heading", { name: "You placed 2nd" })).toBeVisible();
    await expect(g.green.getByRole("heading", { name: "You placed 4th" })).toBeVisible();
    await expect(g.red.getByRole("list", { name: "Final standings" }).getByRole("listitem")).toHaveCount(4);
    await expect(g.red.getByText("Last one standing")).toBeVisible();
  });

  test("a rematch needs all four, and lands everyone in the new game", async ({ phones }) => {
    const g = await fourGame(phones, "chess:four");
    for (const p of [g.green, g.yellow, g.blue]) {
      await expect(p.getByRole("grid", { name: "4-player chess board" })).toBeVisible();
      await resign(p);
    }
    await expect(g.red.getByRole("heading", { name: "You won" })).toBeVisible();

    await g.red.getByRole("button", { name: "Rematch" }).click();
    await expect(g.red.getByText(/Waiting for .* and /)).toBeVisible();
    for (const p of [g.blue, g.yellow]) await p.getByRole("button", { name: "Accept rematch" }).click();
    await expect(g.green.getByText("(3/4 in)")).toBeVisible();
    await g.green.getByRole("button", { name: "Accept rematch" }).click();
    for (const p of g.pages) await expect.poll(() => matchIdOf(p)).not.toBe(g.id);
    const next = matchIdOf(g.red);
    for (const p of g.pages) {
      expect(matchIdOf(p)).toBe(next);
      await expect(p.getByRole("grid", { name: "4-player chess board" })).toHaveCount(1);
    }
    expect((await getMatch(next)).status).toBe("active");
  });

  test("an open 4-player lobby fills from the queue", async ({ phones }) => {
    const { pages } = await fourPhones(phones);
    await pages[0].goto("/chess/mode/four");
    await pages[0].getByRole("button", { name: "Find a game" }).click();
    await expect(pages[0].getByRole("heading", { name: "Waiting for 3 more" })).toBeVisible();
    const id = matchIdOf(pages[0]);
    for (const [i, p] of pages.slice(1).entries()) {
      await p.goto("/chess/mode/four");
      await p.getByRole("button", { name: "Join a game" }).click();
      if (i < 2) await expect(p.getByRole("heading", { name: `You're in. Waiting for ${2 - i} more` })).toBeVisible();
    }
    for (const p of pages) await expect(p.getByRole("grid", { name: "4-player chess board" })).toBeVisible();
    expect((await getMatch(id)).status).toBe("active");
  });

  test("real-time 4-player: everyone's army at the bottom, moves land on every phone, and a fallen king greys an army", async ({ phones }) => {
    test.setTimeout(60_000);
    const g = await fourGame(phones, "chess:realtime4");
    const board = "4-player real-time chess board";
    for (const p of g.pages) await expect(p.getByRole("grid", { name: board })).toBeVisible();
    await expect(g.red.locator("[data-piece]")).toHaveCount(64);
    await armiesAtTheBottom({ red: g.red, blue: g.blue, yellow: g.yellow, green: g.green }, board);

    // Once the countdown's over on every phone, all four move at once.
    for (const p of g.pages) await expect(p.getByRole("grid", { name: board })).toHaveAttribute("data-playing", "true", { timeout: 15_000 });
    await Promise.all([tapMove(g.red, "e2", "e3"), tapMove(g.blue, "b5", "c5"), tapMove(g.yellow, "e13", "e12"), tapMove(g.green, "m5", "l5")]);
    for (const p of g.pages) {
      await expect.poll(() => pieceOn(p, "redP", "e3"), { timeout: 6000 }).toBe(true);
      await expect.poll(() => pieceOn(p, "greenP", "l5"), { timeout: 6000 }).toBe(true);
    }

    // Green resigns: its army freezes in grey on every board, and green can't move it.
    await resign(g.green);
    for (const p of g.pages) await expect(p.locator('[data-piece^="dead"]')).toHaveCount(16, { timeout: 6000 });
    await expect(g.red.locator('[data-seat="green"]')).toContainText("King fell");
    await expect(g.green.getByText("Your king fell")).toBeVisible();
  });

  test("a notification tapped while the app was closed is picked up when it opens", async ({ phones }) => {
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const page = await phones.open({ player: chris, push: "on" });
    await page.goto("/");
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
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
