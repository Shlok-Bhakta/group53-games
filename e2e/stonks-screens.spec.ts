// Visual review of Stonks with real market data: SCREENS=1 npm run test:e2e -- stonks-screens.
// Builds on the sidecar (cargo build --release in stonks/ first): it's started against the throwaway
// backend, pulls the real holdings and history, and streams whatever's trading. Writes PNGs to e2e/.state/screens.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test } from "./fixtures";

const BIN = "stonks/target/release/stonks";
test.skip(!process.env.SCREENS || !existsSync(BIN), "Set SCREENS=1 and build the sidecar to capture review screenshots");

test("stonks screens", async ({ browser }) => {
  test.setTimeout(420_000);
  const { url, adminKey } = JSON.parse(readFileSync("e2e/.state/backend.json", "utf8"));
  const sidecar = spawn(BIN, [], { env: { ...process.env, CONVEX_URL: url, ADMIN_KEY: adminKey }, stdio: ["ignore", "inherit", "inherit"] });
  try {
    const a = admin();
    // The sidecar reads the holdings, then works through every symbol's history.
    await expect.poll(async () => (await a.query(anyApi.stonks.board, {})).rows.length, { timeout: 120_000, intervals: [2000] }).toBe(20);
    await expect.poll(async () => (await a.query(anyApi.stonks.profile, { symbol: "NVDA" })).stats?.marketCap ?? 0, { timeout: 120_000, intervals: [2000] }).toBeGreaterThan(0);
    await expect.poll(async () => (await a.query(anyApi.stonks.chart, { symbol: "NVDA", range: "5Y" })).points.length, { timeout: 240_000, intervals: [3000] }).toBeGreaterThan(100);
    const player = await createPlayer("Shlok");
    // One phone for both schemes: a signed-in session's refresh token only works once.
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await phone(ctx, { player, notifications: "granted" });
    await page.goto("/");
    await page.getByRole("button", { name: "Turn on notifications" }).click();
    await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const shot = async (name: string) => {
        await page.waitForTimeout(900);
        await page.screenshot({ path: `e2e/.state/screens/${scheme}-stonks-${name}.png`, animations: "allow" });
      };
      await page.goto("/games");
      await page.getByRole("heading", { name: "Stonks" }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1800);
      await shot("games");
      await page.evaluate(() => localStorage.setItem("stonks-range", "1D"));
      await page.goto("/stonks");
      await expect(page.getByRole("heading", { name: "Top 20" })).toBeVisible();
      await shot("board");
      await page.mouse.wheel(0, 520);
      await shot("board-movers");
      await page.mouse.wheel(0, 900);
      await shot("board-rows");
      await page.mouse.wheel(0, 3000);
      await shot("board-news");
      await page.goto("/stonks/NVDA");
      await expect(page.getByRole("region", { name: "Stats" })).toBeVisible();
      await shot("nvda-1d");
      const chart = page.getByRole("img", { name: /^NVIDIA Corporation, \w+day,/ });
      const box = (await chart.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.42, box.y + box.height / 2);
      await shot("nvda-scrub");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
      for (const r of ["1W", "1M", "1Y", "5Y"]) {
        await page.getByRole("radio", { name: r }).click();
        await page.waitForTimeout(600);
        await shot(`nvda-${r.toLowerCase()}`);
      }
      await page.getByRole("button", { name: "Pro mode" }).click();
      await page.getByRole("radio", { name: "1Y" }).click();
      await shot("nvda-pro-1y");
      await page.mouse.wheel(0, 760);
      await shot("nvda-pro-stats");
      await page.mouse.wheel(0, 900);
      await shot("nvda-pro-about");
      await page.mouse.wheel(0, 3000);
      await shot("nvda-news");
      await page.getByRole("button", { name: "Pro mode" }).click();
      await page.getByRole("radio", { name: "1D" }).click();
    }
    await ctx.close();
  } finally {
    // Gone before the next test resets the database, or it would write the real holdings into it.
    const exited = new Promise((r) => sidecar.once("exit", r));
    sidecar.kill("SIGKILL");
    await exited;
  }
});
