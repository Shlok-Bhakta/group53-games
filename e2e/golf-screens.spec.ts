import type { Page } from "@playwright/test";
import { createPlayer, expect, fillLobby, getMatch, matchIdOf, phone, readyForShot, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

type GolfHook = {
  balls(): { id: string; x: number; y: number; mode: string }[];
  me(): string;
  shownFor(): number;
  shoot(a: number, p: number): void;
};
const balls = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: GolfHook }).__golf?.balls() ?? []);
const meOn = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: GolfHook }).__golf?.me());
const HOLE_INTRO_S = 1.6;

async function holeUp(page: Page) {
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __golf?: GolfHook }).__golf?.shownFor() ?? 0), {
      message: "the hole has come up",
    })
    .toBeGreaterThan(HOLE_INTRO_S);
}

async function rolling(page: Page, who: "me" | "others") {
  const me = await meOn(page);
  await expect
    .poll(async () => (await balls(page)).some((b) => b.mode === "roll" && (who === "me") === (b.id === me)), {
      message: `${who === "me" ? "my ball" : "someone else's ball"} is rolling`,
    })
    .toBe(true);
}

async function putt(page: Page, dx: number, dy: number, hold = 0) {
  const box = (await page.getByLabel("Driftwood Bay, an open course").boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  if (hold) return;
  await page.mouse.up();
}

for (const scheme of ["dark", "light"] as const) {
  test(`golf screens ${scheme}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const names = ["WashableBowl700", "chrisis14", "Boiler"];
    const players = await Promise.all(names.map((n) => createPlayer(n)));
    const ctxs = await Promise.all(
      players.map(() =>
        browser.newContext({
          viewport: { width: 393, height: 852 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          colorScheme: scheme,
        }),
      ),
    );
    const pages = await Promise.all(players.map((p, i) => phone(ctxs[i], { player: p, notifications: "granted" })));
    for (const p of pages) {
      await p.goto("/");
      await p.getByRole("button", { name: "Turn on notifications" }).click();
    }
    const [a, b, c] = pages;
    const shot = async (name: string, page = a) => {
      await readyForShot(page);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-golf-${name}.png`, animations: "allow" });
    };
    await a.goto("/games");
    await a.getByRole("heading", { name: "Golf" }).scrollIntoViewIfNeeded();
    await expect(a.getByRole("img", { name: "A putt rolling into the cup" })).toHaveAttribute("data-played", "");
    await shot("games");
    await a.goto("/golf");
    await a.getByRole("link", { name: /^Async/ }).waitFor();
    await shot("hub");
    await a.goto("/golf/practice");
    await a.getByRole("heading", { name: "Cold Start" }).waitFor();
    await shot("practice");
    await a.screenshot({ path: `e2e/.state/screens/${scheme}-golf-hub-full.png`, fullPage: true, animations: "allow" });
    for (const [name, path] of [
      ["hole-green", "/golf/plains/3"],
      ["hole-big", "/golf/plains/7"],
      ["hole-ice", "/golf/cold/5"],
      ["hole-floes", "/golf/cold/8"],
      ["hole-final", "/golf/cold/9"],
    ] as const) {
      await a.goto(path);
      await holeUp(a);
      await shot(name);
    }
    for (const p of pages) {
      await p.goto("/golf/world");
      await holeUp(p);
    }
    await shot("world");
    await putt(b, 40, 90);
    await putt(c, -60, 30);
    await rolling(a, "others");
    await shot("others-moving");
    await putt(a, 0, 110, 1);
    await shot("aiming");
    await a.mouse.up();
    await rolling(a, "me");
    await shot("rolling");
    await a.getByRole("button", { name: "See the whole map" }).click();
    await shot("overview");
  });
}

for (const scheme of ["dark", "light"] as const) {
  test(`golf game screens ${scheme}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const players = await Promise.all(["WashableBowl700", "chrisis14", "Boiler"].map((n) => createPlayer(n)));
    const ctxs = await Promise.all(
      players.map(() =>
        browser.newContext({
          viewport: { width: 393, height: 852 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          colorScheme: scheme,
        }),
      ),
    );
    const pages = await Promise.all(players.map((p, i) => phone(ctxs[i], { player: p, notifications: "granted" })));
    for (const p of pages) {
      await p.goto("/");
      await p.getByRole("button", { name: "Turn on notifications" }).click();
    }
    const [a, b, c] = pages;
    const shot = async (name: string, page = a, full = false) => {
      await readyForShot(page);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-golfgame-${name}.png`, animations: "allow", fullPage: full });
    };
    const seed = process.env.SEED ?? "4242";
    const style = process.env.STYLE ?? "Both";
    await a.goto("/golf/mode/turns");
    await a.getByRole("button", { name: "Settings" }).click();
    await a.getByRole("radiogroup", { name: "Holes like" }).getByRole("radio", { name: style, exact: true }).click();
    await a.getByRole("textbox", { name: "Seed" }).fill(seed);
    await a.getByRole("textbox", { name: "Seed" }).press("Enter");
    await shot("mode", a, true);
    await expect(a.getByRole("list", { name: "The holes" }).getByRole("button", { name: /^Hole \d+, / })).toHaveCount(6, {
      timeout: 120_000,
    });
    await a.getByRole("textbox", { name: "Seed" }).scrollIntoViewIfNeeded();
    await shot("mode-holes-open");
    await a.getByRole("button", { name: "Settings" }).click();
    await a.evaluate(() => window.scrollTo(0, 0));
    await shot("mode-holes");
    await a.getByRole("button", { name: "Settings" }).click();
    await a.getByRole("button", { name: "Open a game" }).click();
    await a.getByRole("heading", { name: "Waiting for players" }).waitFor();
    await fillLobby(a, [b, c]);
    for (const p of pages) await expect(p.getByLabel(/hole 1 of \d+/)).toBeVisible({ timeout: 60_000 });
    for (const p of pages) await holeUp(p);
    const id = matchIdOf(a);
    const up = async () => {
      const turn = (await getMatch(id))?.turn;
      for (const p of pages)
        if ((await meOn(p)) === turn && (await p.getByLabel(/hole \d+ of \d+/).getAttribute("data-turn")) === "mine") return p;
      return null;
    };
    await expect.poll(async () => (await up()) !== null, { message: "someone is up" }).toBe(true);
    const first = (await up())!;
    await shot("my-turn", first);
    await shot(
      "their-turn",
      pages.find((p) => p !== first)!,
    );
    await first.getByRole("button", { name: "Menu" }).click();
    await shot("menu", first);
    await first.keyboard.press("Escape");
    const holeCard = a.getByRole("list", { name: /Hole 1 scores/ });
    for (let k = 0; k < 40 && !(await holeCard.isVisible()); k++) {
      const p = await up();
      if (!p) {
        await expect.poll(async () => (await holeCard.isVisible()) || (await up()) !== null, { timeout: 30_000 }).toBe(true);
        continue;
      }
      const before = (await getMatch(id))?.moveCount;
      await p.evaluate(() =>
        (window as unknown as { __golf: GolfHook }).__golf.shoot(-Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.3),
      );
      await expect
        .poll(async () => (await holeCard.isVisible()) || (await getMatch(id))?.moveCount !== before, {
          timeout: 30_000,
          message: "the turn moves on",
        })
        .toBe(true);
    }
    if (await holeCard.isVisible()) await shot("hole-card");
    await shot("hole-2-or-later");
  });
}
