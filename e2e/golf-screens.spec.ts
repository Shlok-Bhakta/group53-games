// Visual review of golf: SCREENS=1 npm run test:e2e -- golf-screens. Writes PNGs to e2e/.state/screens.
import type { Page } from "@playwright/test";
import { createPlayer, expect, phone, test } from "./fixtures";

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
    for (const p of pages) {
      await p.goto("/golf");
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
