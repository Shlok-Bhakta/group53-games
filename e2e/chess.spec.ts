import type { Browser, Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test, type Player } from "./fixtures";

// A second phone in its own browser context.
async function otherPhone(browser: Browser, player: Player) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  return { context, page: await phone(context, { player, notifications: "granted" }) };
}

// Games are locked until notifications are on; turn them on the way a player would.
async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByRole("link", { name: "Play" }).first()).toBeVisible();
}

const matchIdOf = (page: Page) => page.url().split("/chess/")[1].split("?")[0];
const getMatch = (id: string) => admin().query(anyApi.testing.getMatch, { id });
const rtCommands = (id: string) => admin().query(anyApi.testing.rtCommands, { id });

async function colorsOf(id: string, a: Player) {
  const m = await getMatch(id);
  const white = m.players.find((p: { color: string }) => p.color === "w").userId;
  return white === a.userId ? "a-white" : "b-white";
}

// Taps a piece and then its destination, the way a player would on a phone.
async function tapMove(page: Page, from: string, to: string) {
  await page.locator(`[data-square=${from}]`).click();
  await page.locator(`[data-square=${to}]`).click();
}

async function startClassic(browser: Browser, context: Parameters<typeof phone>[0]) {
  const shlok = await createPlayer("Shlok");
  const chris = await createPlayer("Chris");
  const a = await phone(context, { player: shlok, notifications: "granted" });
  const b = await otherPhone(browser, chris);
  await enablePush(a);
  await enablePush(b.page);

  await a.goto("/chess/mode/classic");
  await a.getByRole("button", { name: "Find a game" }).click();
  await expect(a.getByRole("heading", { name: "Looking for an opponent" })).toBeVisible();
  const id = matchIdOf(a);

  await b.page.goto("/chess/mode/classic");
  await expect(b.page.getByText("Waiting for an opponent")).toBeVisible();
  await b.page.getByRole("button", { name: "Join a game" }).click();
  await expect(b.page.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
  await expect(a.getByRole("grid", { name: "Classic chess board" })).toBeVisible();

  const order = await colorsOf(id, shlok);
  const [white, black] = order === "a-white" ? [a, b.page] : [b.page, a];
  const [whitePlayer, blackPlayer] = order === "a-white" ? [shlok, chris] : [chris, shlok];
  return { id, white, black, whitePlayer, blackPlayer, close: () => b.context.close() };
}

test.describe("chess", () => {
  test("game routes stay locked until notifications are on", async ({ context }) => {
    const me = await createPlayer("Shlok");
    const page = await phone(context, { player: me });
    await page.goto("/chess");
    await expect(page.getByText("Turn on notifications to play")).toBeVisible();
    await expect(page.getByRole("button", { name: "Find a game" })).toHaveCount(0);
  });

  test("classic: find a game, play moves live on both phones, resign, and see the leaderboard", async ({ context, browser }) => {
    const g = await startClassic(browser, context);

    // Black can't move first.
    await g.black.locator("[data-square=e7]").click();
    await expect(g.black.locator("[data-square=e5] span.rounded-full")).toHaveCount(0);

    await tapMove(g.white, "e2", "e4");
    await expect(g.black.getByLabel("Moves")).toContainText("e4");
    await expect(g.white.getByLabel("Moves")).toContainText("e4");

    await tapMove(g.black, "e7", "e5");
    await expect(g.white.getByLabel("Moves")).toContainText("e5");

    // Drag a knight out on the white phone.
    const from = await g.white.locator("[data-square=g1]").boundingBox();
    const to = await g.white.locator("[data-square=f3]").boundingBox();
    await g.white.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await g.white.mouse.down();
    await g.white.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
    await g.white.mouse.up();
    await expect(g.black.getByLabel("Moves")).toContainText("Nf3");

    const stored = await getMatch(g.id);
    expect(stored.state.moves.map((m: { san: string }) => m.san)).toEqual(["e4", "e5", "Nf3"]);

    await g.white.getByRole("button", { name: "Resign" }).click();
    await g.white.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
    await expect(g.white.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(g.black.getByRole("heading", { name: "You won" })).toBeVisible();
    await expect(g.black.getByText("1216")).toBeVisible();

    await g.black.goto("/chess/mode/classic");
    const board = g.black.getByRole("list", { name: "Classic leaderboard" });
    await expect(board.getByRole("listitem").first()).toContainText(g.blackPlayer.name);
    await expect(board.getByRole("listitem").first()).toContainText("1216");
    await expect(board).toContainText("1184");
    await g.close();
  });

  test("classic: checkmate ends the game for both players", async ({ context, browser }) => {
    const g = await startClassic(browser, context);
    await tapMove(g.white, "f2", "f3");
    await expect(g.black.getByLabel("Moves")).toContainText("f3");
    await tapMove(g.black, "e7", "e5");
    await expect(g.white.getByLabel("Moves")).toContainText("e5");
    await tapMove(g.white, "g2", "g4");
    await expect(g.black.getByLabel("Moves")).toContainText("g4");
    await tapMove(g.black, "d8", "h4");
    await expect(g.black.getByRole("heading", { name: "You won" })).toBeVisible();
    await expect(g.white.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(g.white.getByText("Checkmate")).toBeVisible();
    await g.close();
  });

  test("challenge someone, they accept from the inbox on the home screen", async ({ context, browser }) => {
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const a = await phone(context, { player: shlok, notifications: "granted" });
    const b = await otherPhone(browser, chris);
    await enablePush(a);
    await enablePush(b.page);

    await a.goto("/chess/mode/classic");
    await a.getByRole("button", { name: "Challenge" }).click();
    await a.getByRole("dialog").getByRole("button", { name: /Chris/ }).click();
    await expect(a.getByRole("heading", { name: "Challenge sent" })).toBeVisible();

    // The challenge shows up live on the home screen, not on a mode page.
    await b.page.goto("/");
    const invite = b.page.getByRole("region", { name: "Challenge from Shlok" });
    await expect(invite).toBeVisible();
    await expect(invite).toContainText("Classic");
    await invite.getByRole("button", { name: "Accept" }).click();
    await expect(b.page.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    await expect(a.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    await b.context.close();
  });

  test("real-time: countdown, then pieces move without turns and show up on the other phone", async ({ context, browser }) => {
    test.setTimeout(60_000);
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const a = await phone(context, { player: shlok, notifications: "granted" });
    const b = await otherPhone(browser, chris);
    await enablePush(a);
    await enablePush(b.page);

    await a.goto("/chess/mode/realtime");
    await a.getByRole("button", { name: "Find a game" }).click();
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    const id = matchIdOf(a);
    await b.page.goto(`/chess/${id}`);
    await b.page.getByRole("button", { name: "Join game" }).click();
    await expect(a.getByRole("grid", { name: "Real-time chess board" })).toBeVisible();
    await expect(b.page.getByRole("grid", { name: "Real-time chess board" })).toBeVisible();

    const m = await getMatch(id);
    await expect.poll(async () => (await getMatch(id)).state?.startAt ?? null, { timeout: 10_000 }).not.toBeNull();
    const white = m.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId ? a : b.page;
    const black = white === a ? b.page : a;

    // Wait out the countdown, then both players move at the same time.
    await white.waitForTimeout(3300);
    await tapMove(white, "e2", "e4");
    await tapMove(black, "d7", "d5");

    // The white pawn lands on e4 on black's screen.
    const e4 = black.locator("[data-square=e4]");
    await expect
      .poll(async () => {
        const sq = await e4.boundingBox();
        const pawns = await black.locator('[data-piece="wP"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
        return pawns.some((p) => Math.abs(p.x - sq!.x) < 2 && Math.abs(p.y - sq!.y) < 2);
      }, { timeout: 6000 })
      .toBe(true);

    // Both moves are stored once each, as separate inserts.
    await expect.poll(async () => (await rtCommands(id)).map((c: { color: string }) => c.color).sort()).toEqual(["b", "w"]);

    // The pawn is cooling down now: picking it up offers premoves, and an arrow shows the queued one.
    await tapMove(white, "e4", "e5");
    await expect(white.locator("svg line")).toHaveCount(1);
    // Tapping the piece again cancels it.
    await white.locator("[data-square=e4]").click();
    await expect(white.locator("svg line")).toHaveCount(0);
    // Queue it again; it fires by itself the moment the cooldown ends.
    await tapMove(white, "e4", "e5");
    await expect
      .poll(async () => {
        const sq = await black.locator("[data-square=e5]").boundingBox();
        const pawns = await black.locator('[data-piece="wP"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
        return pawns.some((p) => Math.abs(p.x - sq!.x) < 2 && Math.abs(p.y - sq!.y) < 2);
      }, { timeout: 9000 })
      .toBe(true);

    await white.getByRole("button", { name: "Resign" }).click();
    await white.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
    await expect(black.getByRole("heading", { name: "You won" })).toBeVisible();
    await b.context.close();
  });

  test("real-time: taking the king ends the game on its own, with no further moves", async ({ context, browser }) => {
    test.setTimeout(90_000);
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const a = await phone(context, { player: shlok, notifications: "granted" });
    const b = await otherPhone(browser, chris);
    await enablePush(a);
    await enablePush(b.page);
    await a.goto("/chess/mode/realtime");
    await a.getByRole("button", { name: "Find a game" }).click();
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    const id = matchIdOf(a);
    await b.page.goto(`/chess/${id}`);
    await b.page.getByRole("button", { name: "Join game" }).click();
    await expect.poll(async () => (await getMatch(id)).state?.startAt ?? null, { timeout: 10_000 }).not.toBeNull();
    const m = await getMatch(id);
    const white = m.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId ? a : b.page;
    const black = white === a ? b.page : a;
    await white.waitForTimeout(3300);

    // e4, queen out to h5, queen takes f7, queen takes the king. Each wait covers travel plus cooldown.
    await tapMove(white, "e2", "e4");
    await white.waitForTimeout(7200);
    await tapMove(white, "d1", "h5");
    await white.waitForTimeout(9300);
    await tapMove(white, "h5", "f7");
    await white.waitForTimeout(7300);
    await tapMove(white, "f7", "e8");

    await expect(white.getByRole("heading", { name: "You won" })).toBeVisible({ timeout: 8000 });
    await expect(black.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(black.getByText("King captured")).toBeVisible();
    expect((await getMatch(id)).result.reason).toBe("king");
    await b.context.close();
  });

  test("real-time: your own move never jumps backwards on your screen", async ({ context, browser }) => {
    test.setTimeout(60_000);
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const a = await phone(context, { player: shlok, notifications: "granted" });
    const b = await otherPhone(browser, chris);
    await enablePush(a);
    await enablePush(b.page);
    await a.goto("/chess/mode/realtime");
    await a.getByRole("button", { name: "Find a game" }).click();
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    const id = matchIdOf(a);
    await b.page.goto(`/chess/${id}`);
    await b.page.getByRole("button", { name: "Join game" }).click();
    await expect.poll(async () => (await getMatch(id)).state?.startAt ?? null, { timeout: 10_000 }).not.toBeNull();
    const m = await getMatch(id);
    const white = m.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId ? a : b.page;
    await white.waitForTimeout(3300);

    // The e-pawn travels two squares up the screen; sample it every 40ms and check it never goes back.
    const pawn = white.locator('[data-piece="wP"]').nth(4);
    await tapMove(white, "e2", "e4");
    const ys: number[] = [];
    for (let i = 0; i < 40; i++) {
      ys.push((await pawn.boundingBox())!.y);
      await white.waitForTimeout(40);
    }
    for (let i = 1; i < ys.length; i++) expect(ys[i], `frame ${i}: ${ys.join(",")}`).toBeLessThanOrEqual(ys[i - 1] + 0.5);
    const e4 = (await white.locator("[data-square=e4]").boundingBox())!;
    expect(Math.abs(ys.at(-1)! - e4.y)).toBeLessThan(2);
    await b.context.close();
  });

  test("the game header scrolls with the page and the share button lines up with the title", async ({ context, browser }) => {
    const g = await startClassic(browser, context);
    // The game's own header (the page we came from may still be fading out).
    const header = g.white.locator("header", { has: g.white.getByRole("heading", { name: "Classic chess", level: 1 }) });
    // iOS blurs things pinned to the top edge, so nothing with text there may be sticky or fixed.
    expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe("static");
    const title = (await g.white.getByRole("heading", { name: "Classic chess", level: 1 }).boundingBox())!;
    const share = (await g.white.getByRole("button", { name: "Share this game" }).boundingBox())!;
    expect(Math.abs(title.y + title.height / 2 - (share.y + share.height / 2))).toBeLessThan(4);
    // And it starts below the strip that covers the band iOS blurs under the status bar.
    expect(title.y).toBeGreaterThanOrEqual(32);
    await g.close();
  });

  test("mashing Find a game or a challenge only ever makes one game", async ({ context, browser }) => {
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const a = await phone(context, { player: shlok, notifications: "granted" });
    await enablePush(a);
    await a.goto("/chess/mode/classic");
    const find = a.getByRole("button", { name: "Find a game" });
    await find.evaluate((el: HTMLElement) => { for (let i = 0; i < 8; i++) el.click(); });
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    await a.goto("/chess/mode/realtime");
    await a.getByRole("button", { name: "Challenge" }).click();
    const row = a.getByRole("dialog").getByRole("button", { name: /Chris/ });
    await expect(row).toBeVisible();
    await row.evaluate((el: HTMLElement) => { for (let i = 0; i < 8; i++) el.click(); });
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    const all = await admin().query(anyApi.testing.allMatches, {});
    expect(all.filter((m: { mode: string }) => m.mode === "chess:classic")).toHaveLength(1);
    expect(all.filter((m: { mode: string }) => m.mode === "chess:realtime")).toHaveLength(1);
    void chris;
  });

  test("real-time pieces sit on their squares while waiting for the other player", async ({ context }) => {
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const a = await phone(context, { player: shlok, notifications: "granted" });
    await enablePush(a);
    const id = await admin().action(anyApi.testing.startMatch, { mode: "chess:realtime", a: shlok.userId, b: chris.userId });
    await a.goto(`/chess/${id}`);
    await expect(a.getByText(/Waiting for Chris/)).toBeVisible();
    const corner = (await a.locator("[data-square]").first().boundingBox())!;
    const boxes = await a.locator("[data-piece]").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(32);
    const inCorner = boxes.filter((b) => Math.abs(b.x - corner.x) < 2 && Math.abs(b.y - corner.y) < 2);
    expect(inCorner.length).toBeLessThanOrEqual(1);
  });

  test("rematch: ask in place, the other player accepts, and both land in the new game", async ({ context, browser }) => {
    const g = await startClassic(browser, context);
    await g.white.getByRole("button", { name: "Resign" }).click();
    await g.white.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
    await expect(g.black.getByRole("heading", { name: "You won" })).toBeVisible();
    const oldUrl = g.white.url();

    await g.white.getByRole("button", { name: "Rematch" }).click();
    await expect(g.white.getByText(/Waiting for/)).toBeVisible();
    await expect(g.black.getByText(/wants a rematch/)).toBeVisible();
    expect(g.white.url()).toBe(oldUrl);

    await g.black.getByRole("button", { name: "Accept rematch" }).click();
    await g.white.waitForURL((u) => u.toString() !== oldUrl);
    await g.black.waitForURL((u) => u.toString() !== oldUrl);
    expect(g.white.url()).toBe(g.black.url());
    await expect(g.white.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    // Colors swap: last game's black is white now.
    const next = await getMatch(matchIdOf(g.white));
    expect(next.players.find((p: { color: string }) => p.color === "w").userId).toBe(g.blackPlayer.userId);
    await g.close();
  });

  test("rematch: leaving the page declines it", async ({ context, browser }) => {
    const g = await startClassic(browser, context);
    await g.white.getByRole("button", { name: "Resign" }).click();
    await g.white.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
    await g.white.getByRole("button", { name: "Rematch" }).click();
    await expect(g.black.getByText(/wants a rematch/)).toBeVisible();
    await g.black.getByRole("button", { name: "Back", exact: true }).click();
    await expect(g.white.getByText(/passed on a rematch/)).toBeVisible();
    await expect(g.white.getByRole("button", { name: "New game" })).toBeVisible();
    await g.close();
  });

  test("someone else can watch a game but not touch it", async ({ context, browser }) => {
    const g = await startClassic(browser, context);
    const boiler = await createPlayer("Boiler");
    const c = await otherPhone(browser, boiler);
    await enablePush(c.page);
    await c.page.goto(`/chess/${g.id}`);
    await expect(c.page.getByText("You're watching.")).toBeVisible();
    await expect(c.page.getByRole("button", { name: "Resign" })).toHaveCount(0);
    await tapMove(g.white, "e2", "e4");
    await expect(c.page.getByLabel("Moves")).toContainText("e4");
    await c.context.close();
    await g.close();
  });
});
