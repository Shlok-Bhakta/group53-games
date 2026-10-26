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
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}

const getMatch = (id: string) => admin().query(anyApi.testing.getMatch, { id });
const matchIdOf = (page: Page) => page.url().split("/scrabble/")[1].split("?")[0];
const setRack = (id: string, userId: string, letters: string) => admin().mutation(anyApi.testing.setRack, { id, userId, letters });

// Taps a rack tile, then a square. Squares are found by where they are on the board.
async function place(page: Page, letter: string, x: number, y: number) {
  await page.getByRole("button", { name: letter === "?" ? "Blank tile" : `Tile ${letter}` }).first().click();
  await tapSquare(page, x, y);
}
async function tapSquare(page: Page, x: number, y: number) {
  const board = page.getByRole("group", { name: "Board" });
  const box = (await board.boundingBox())!;
  // Find the square on screen from a known tile-free square size: the layer is scaled, so ask the page.
  const pt = await board.evaluate(
    (el, [x, y, size]) => {
      const layer = el.firstElementChild as HTMLElement;
      const m = new DOMMatrix(getComputedStyle(layer).transform);
      const base = el.clientWidth / size;
      return { x: m.e + (x + 0.5) * base * m.a, y: m.f + (y + 0.5) * base * m.d };
    },
    [x, y, 15] as const,
  );
  await page.mouse.click(box.x + pt.x, box.y + pt.y);
}

const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __sfx: string[] }).__sfx);

// Two phones in a started classic game. Returns them in seat order.
async function twoPlayerGame(browser: Browser, context: Parameters<typeof phone>[0], mode = "classic") {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const pa = await phone(context, { player: a, notifications: "granted" });
  const other = await otherPhone(browser, b);
  const pb = other.page;
  await enablePush(pa);
  await enablePush(pb);
  await pa.goto(`/scrabble/mode/${mode}`);
  await pa.getByRole("button", { name: "Open a game" }).click();
  await expect(pa.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  const id = matchIdOf(pa);
  await pb.goto(`/scrabble/${id}?accept=1`);
  await expect(pb.getByRole("heading", { name: "Waiting for Shlok to start" })).toBeVisible();
  await expect(pa.getByRole("heading", { name: "2 in" })).toBeVisible();
  await pa.getByRole("button", { name: "Start with 2" }).click();
  await expect(pa.getByRole("group", { name: "Board" })).toBeVisible();
  await expect(pb.getByRole("group", { name: "Board" })).toBeVisible();
  const m = await getMatch(id);
  const first = m.players[0].userId === a.userId ? { player: a, page: pa } : { player: b, page: pb };
  const second = first.player === a ? { player: b, page: pb } : { player: a, page: pa };
  return { id, first, second, close: () => other.context.close() };
}

test.describe("Scrabble", () => {
  test("the game card opens the Scrabble page with its two modes", async ({ context }) => {
    const me = await createPlayer("Shlok");
    const page = await phone(context, { player: me, notifications: "granted" });
    await enablePush(page);
    await page.goto("/games");
    await page.getByRole("link", { name: "Play Scrabble" }).click();
    await expect(page).toHaveURL(/\/scrabble$/);
    await expect(page.getByRole("region", { name: "Async" }).getByRole("link")).toHaveText([/2–8/]);
    await expect(page.getByRole("region", { name: "Real-time" }).getByRole("link")).toHaveText([/2–8/]);
    await page.getByRole("region", { name: "Real-time" }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Live", level: 1 })).toBeVisible();
    await expect(page.getByText("Each turn has a 90-second timer.")).toBeVisible();
    // Settings change the rules as you pick them.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radiogroup", { name: "Turn timer" }).getByRole("radio", { name: "30s" }).click();
    await expect(page.getByText("Each turn has a 30-second timer.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toContainText("30s turns");
    await page.getByRole("button", { name: "Open a game" }).click();
    await expect(page.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Needs 2 to start" })).toBeDisabled();
    expect((await getMatch(matchIdOf(page))).settings).toEqual({ turnTime: 30 });
  });

  test("the host's setting changes show up live in everyone's lobby", async ({ context, browser }) => {
    const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
    const pa = await phone(context, { player: a, notifications: "granted" });
    const other = await otherPhone(browser, b);
    await enablePush(pa);
    await enablePush(other.page);
    await pa.goto("/scrabble/mode/classic");
    await pa.getByRole("button", { name: "Open a game" }).click();
    await expect(pa.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
    const id = matchIdOf(pa);
    await other.page.goto(`/scrabble/${id}?accept=1`);
    await expect(other.page.getByRole("heading", { name: "Waiting for Shlok to start" })).toBeVisible();
    await pa.getByRole("button", { name: "Settings" }).click();
    await pa.getByRole("radiogroup", { name: "Board" }).getByRole("radio", { name: "21×21" }).click();
    await pa.getByRole("radiogroup", { name: "Rules" }).getByRole("radio", { name: "Letter League" }).click();
    await expect(other.page.getByRole("list", { name: "Settings" })).toHaveText(/21×21 board.*Letter League rules/);
    await pa.getByRole("button", { name: "Start with 2" }).click();
    await expect(other.page.getByRole("group", { name: "Board" })).toBeVisible();
    expect((await getMatch(id)).state.size).toBe(21);
    await other.context.close();
  });

  test("two phones play words, plans survive a reload, and the other phone sees it all live", async ({ context, browser }) => {
    const { id, first, second, close } = await twoPlayerGame(browser, context);
    await setRack(id, first.player.userId, "CATSDOG");
    await setRack(id, second.player.userId, "ZORPHIE");
    const p1 = first.page;
    const p2 = second.page;
    await expect(p1.getByText("Your turn")).toBeVisible();
    await expect(p2.getByText(/is on it|Waiting for/)).toBeVisible();

    // Lay out CAT through the centre: the button names the word and the score before you commit.
    await place(p1, "C", 6, 7);
    await place(p1, "A", 7, 7);
    await place(p1, "T", 8, 7);
    await expect(p1.getByRole("button", { name: "Play CAT for 10" })).toBeEnabled();
    expect(await sounds(p1)).toEqual(expect.arrayContaining(["pick", "place"]));
    // The game screen has music on, once you've touched it.
    await expect.poll(() => p1.evaluate(() => (window as unknown as { __music?: string }).__music)).toBe("lofi");
    // The other phone sees face-down tiles where they're trying things, never the letters.
    await expect(p2.getByLabel("Planning 3 tiles")).toBeVisible();
    await expect(p2.locator("[data-ghost]")).toHaveCount(3);
    await expect(p2.locator('[data-ghost="7,7"]')).toBeVisible();
    expect((await p2.locator("[data-ghost]").allTextContents()).join("")).toBe("");
    await p1.reload();
    await expect(p1.getByRole("button", { name: "Play CAT for 10" })).toBeEnabled();
    await p1.getByRole("button", { name: "Play CAT for 10" }).click();
    await expect.poll(() => sounds(p1)).toContain("play");

    // It lands on the other phone, scores, and passes the turn.
    await expect(p2.locator('[data-cell="7,7"]')).toHaveAttribute("data-letter", "A");
    await expect(p2.locator("[data-ghost]")).toHaveCount(0);
    await expect.poll(() => sounds(p2)).toEqual(expect.arrayContaining(["land", "turn"]));
    await expect(p2.getByText("Your turn")).toBeVisible();
    await expect(p2.getByRole("list", { name: "Scores" }).getByLabel("10 points")).toBeVisible();
    await expect(p1.getByLabel("Your tiles").getByRole("button")).toHaveCount(7);

    // Made-up words can't be played.
    await place(p2, "Z", 7, 8);
    await place(p2, "R", 7, 9);
    await expect(p2.getByRole("button", { name: "AZR isn't a word" })).toBeDisabled();
    await p2.getByRole("button", { name: "Recall tiles" }).click();
    // Tapping a placed tile sends it home too.
    await place(p2, "H", 7, 6);
    await tapSquare(p2, 7, 6);
    await expect(p2.getByRole("button", { name: "Tile H" })).toBeVisible();

    // Meanwhile the first player plans their next word out of turn, and it waits for them.
    await place(p1, "S", 9, 7);
    await expect(p1.getByRole("button", { name: "Planned: CATS, 6" })).toBeDisabled();
    await close();
  });

  test("the turn ring sits inside the score strip, never clipped", async ({ context, browser }) => {
    const { first, close } = await twoPlayerGame(browser, context);
    const strip = (await first.page.getByRole("list", { name: "Scores" }).boundingBox())!;
    const up = (await first.page.locator('[aria-current="true"]').boundingBox())!;
    expect(up.y).toBeGreaterThanOrEqual(strip.y);
    expect(up.y + up.height).toBeLessThanOrEqual(strip.y + strip.height);
    await close();
  });

  test("sound settings: pick music and an effects pack, and they stick", async ({ context }) => {
    const me = await createPlayer("Shlok");
    const page = await phone(context, { player: me, notifications: "granted" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/you");
    const music = page.getByRole("radiogroup", { name: "Music" });
    const effects = page.getByRole("radiogroup", { name: "Sound effects" });
    await expect(music.getByRole("radio", { name: "Lo-fi" })).toBeChecked();
    await expect(effects.getByRole("radio", { name: "Wood" })).toBeChecked();
    await music.getByRole("radio", { name: "Rain" }).click();
    await effects.getByRole("radio", { name: "Arcade" }).click();
    expect(await sounds(page)).toContain("preview");
    await page.reload();
    await expect(page.getByRole("radiogroup", { name: "Music" }).getByRole("radio", { name: "Rain" })).toBeChecked();
    await expect(page.getByRole("radiogroup", { name: "Sound effects" }).getByRole("radio", { name: "Arcade" })).toBeChecked();
    await page.getByRole("radiogroup", { name: "Music" }).getByRole("radio", { name: "Off" }).click();
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sound")))!)).toMatchObject({ music: "off", sfx: "arcade" });
    expect(errors).toEqual([]);
  });

  test("tiles drag from the rack onto the board and back", async ({ context, browser }) => {
    const { id, first, close } = await twoPlayerGame(browser, context);
    await setRack(id, first.player.userId, "HIXYZQJ");
    const p = first.page;
    const tile = p.getByRole("button", { name: "Tile H" });
    await expect(tile).toBeVisible();
    const from = (await tile.boundingBox())!;
    const board = (await p.getByRole("group", { name: "Board" }).boundingBox())!;
    const target = await p.getByRole("group", { name: "Board" }).evaluate((el) => {
      const layer = el.firstElementChild as HTMLElement;
      const m = new DOMMatrix(getComputedStyle(layer).transform);
      const base = el.clientWidth / 15;
      return { x: m.e + 7.5 * base * m.a, y: m.f + 7.5 * base * m.d };
    });
    await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await p.mouse.down();
    // The tile floats above the finger, so aim the finger a little under the square.
    for (let i = 1; i <= 8; i++) await p.mouse.move(from.x + ((board.x + target.x - from.x) * i) / 8, from.y + ((board.y + target.y + 44 - from.y) * i) / 8);
    await p.mouse.up();
    await expect(p.locator('[data-draft][data-cell="7,7"]')).toHaveAttribute("data-letter", "H");
    await place(p, "I", 8, 7);
    await expect(p.getByRole("button", { name: "Play HI for 10" })).toBeEnabled();
    await close();
  });

  test("live games show the turn clock and skip you when it runs out", async ({ context, browser }) => {
    const { id, first, second, close } = await twoPlayerGame(browser, context, "live");
    await expect(first.page.getByLabel(/seconds left/)).toBeVisible();
    await expect(second.page.getByLabel(/seconds left/)).toBeVisible();
    await expect(first.page.getByText("Your turn")).toBeVisible();
    // Run the timer out now: the turn is skipped and both phones move on.
    await admin().mutation(anyApi.scrabble.turnTimeout, { id, moveCount: 0 });
    await expect(second.page.getByText("Your turn")).toBeVisible();
    await expect(first.page.getByText(/ran out of time/)).toBeVisible();
    await close();
  });
});
