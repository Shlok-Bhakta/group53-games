// Visual review of golf: SCREENS=1 npm run test:e2e -- golf-screens. Writes PNGs to e2e/.state/screens.
import type { Page } from "@playwright/test";
import { createPlayer, expect, fillLobby, phone, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

async function putt(page: Page, dx: number, dy: number, hold = 0) {
  const box = (await page.getByLabel("Driftwood Bay, an open course").boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
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
    const ctxs = await Promise.all(players.map(() => browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme })));
    const pages = await Promise.all(players.map((p, i) => phone(ctxs[i], { player: p, notifications: "granted" })));
    for (const p of pages) {
      await p.goto("/");
      await p.getByRole("button", { name: "Turn on notifications" }).click();
    }
    const [a, b, c] = pages;
    const shot = async (name: string, page = a) => {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-golf-${name}.png`, animations: "allow" });
    };
    await a.goto("/games");
    await a.waitForTimeout(2600);
    await a.getByRole("heading", { name: "Golf" }).scrollIntoViewIfNeeded();
    await shot("games");
    await a.goto("/golf");
    await a.getByRole("link", { name: /^Async/ }).waitFor();
    await shot("hub");
    await a.goto("/golf/practice");
    await a.getByRole("heading", { name: "Cold Start" }).waitFor();
    await shot("practice");
    await a.screenshot({ path: `e2e/.state/screens/${scheme}-golf-hub-full.png`, fullPage: true, animations: "allow" });
    for (const [name, path] of [["hole-green", "/golf/plains/3"], ["hole-big", "/golf/plains/7"], ["hole-ice", "/golf/cold/5"], ["hole-floes", "/golf/cold/8"], ["hole-final", "/golf/cold/9"]] as const) {
      await a.goto(path);
      await expect(a.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
      await a.waitForTimeout(1500);
      await shot(name);
    }
    for (const p of pages) {
      await p.goto("/golf/world");
      await expect(p.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
    }
    await shot("world");
    await putt(b, 40, 90);
    await putt(c, -60, 30);
    await a.waitForTimeout(400);
    await shot("others-moving");
    await putt(a, 0, 110, 1);
    await shot("aiming");
    await a.mouse.up();
    await a.waitForTimeout(300);
    await shot("rolling");
    await a.getByRole("button", { name: "See the whole map" }).click();
    await shot("overview");
  });
}

// A game on a generated course: the mode page and its settings, the lobby, the hole on whoever's turn it
// is and on everyone else's, the menu with the card, and the scores after a hole.
for (const scheme of ["dark", "light"] as const) {
  test(`golf game screens ${scheme}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const players = await Promise.all(["WashableBowl700", "chrisis14", "Boiler"].map((n) => createPlayer(n)));
    const ctxs = await Promise.all(players.map(() => browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme })));
    const pages = await Promise.all(players.map((p, i) => phone(ctxs[i], { player: p, notifications: "granted" })));
    for (const p of pages) {
      await p.goto("/");
      await p.getByRole("button", { name: "Turn on notifications" }).click();
    }
    const [a, b, c] = pages;
    const shot = async (name: string, page = a, full = false) => {
      await page.waitForTimeout(900);
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
    // The holes for that seed, once they're all made.
    await expect(a.getByRole("list", { name: "The holes" }).getByRole("button", { name: /^Hole \d+, / })).toHaveCount(6, { timeout: 120_000 });
    await a.getByRole("list", { name: "The holes" }).scrollIntoViewIfNeeded();
    await shot("mode-holes");
    await a.getByRole("button", { name: "Open a game" }).click();
    await a.getByRole("heading", { name: "Waiting for players" }).waitFor();
    await fillLobby(a, [b, c]);
    for (const p of pages) await expect(p.getByLabel(/hole 1 of \d+/)).toBeVisible({ timeout: 60_000 });
    await expect(a.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
    await a.waitForTimeout(1600);
    const up = async () => {
      for (const p of pages) if ((await p.getByLabel(/hole \d+ of \d+/).getAttribute("data-turn")) === "mine") return p;
      return null;
    };
    const first = (await up())!;
    await shot("my-turn", first);
    await shot("their-turn", pages.find((p) => p !== first)!);
    await first.getByRole("button", { name: "Menu" }).click();
    await shot("menu", first);
    await first.keyboard.press("Escape");
    // Everyone plays the hole out with the test hook, so the hole card comes up.
    for (let k = 0; k < 40; k++) {
      const p = await up();
      if (!p) {
        await a.waitForTimeout(500);
        if (await a.getByRole("list", { name: /Hole 1 scores/ }).isVisible()) break;
        continue;
      }
      await p.evaluate(() => {
        const g = (window as unknown as { __golf: { shoot(a: number, p: number): void; balls(): { id: string; x: number; y: number }[]; me(): string } }).__golf;
        g.shoot(-Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.3);
      });
      await p.waitForTimeout(2500);
      if (await a.getByRole("list", { name: /Hole 1 scores/ }).isVisible()) break;
    }
    if (await a.getByRole("list", { name: /Hole 1 scores/ }).isVisible()) await shot("hole-card");
    await shot("hole-2-or-later");
  });
}
