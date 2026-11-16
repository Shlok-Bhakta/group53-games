import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { Page } from "@playwright/test";
import { admin, backend, createPlayer, expect, phone, readyForShot, test } from "./fixtures";

const BIN = "stonks/target/release/stonks";
test.skip(!process.env.SCREENS || !existsSync(BIN), "Set SCREENS=1 and build the sidecar to capture review screenshots");

const chartDrawn = (page: Page) =>
  expect
    .poll(async () => Number(await page.getByRole("slider").first().getAttribute("aria-valuemax")), { timeout: 30_000 })
    .toBeGreaterThan(1);

test("stonks screens", async ({ browser }) => {
  test.setTimeout(480_000);
  const { url, adminKey } = backend();
  const sidecar = spawn(BIN, [], {
    env: { ...process.env, CONVEX_URL: url, ADMIN_KEY: adminKey },
    stdio: ["ignore", "inherit", "inherit"],
  });
  try {
    const a = admin();
    await expect.poll(async () => (await a.query(anyApi.stonks.board, {})).rows.length, { timeout: 120_000, intervals: [2000] }).toBe(20);
    await expect
      .poll(async () => (await a.query(anyApi.stonks.profile, { symbol: "NVDA" })).stats?.marketCap ?? 0, {
        timeout: 120_000,
        intervals: [2000],
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await a.query(anyApi.stonks.chart, { symbol: "NVDA", range: "5Y" })).points.length, {
        timeout: 240_000,
        intervals: [3000],
      })
      .toBeGreaterThan(100);
    const player = await createPlayer("Shlok");
    const friend = async (name: string, symbol: string, side: string, dollars: number) => {
      const p = await createPlayer(name);
      const client = new ConvexHttpClient(url);
      client.setAuth(p.token);
      await client.mutation(anyApi.stonks.order, { symbol, side, dollars });
    };
    await friend("chrisis14", "AAPL", "buy", 6000);
    await friend("samwise", "TSLA", "short", 3000);
    await friend("alex_dev", "NVDA", "buy", 9000);
    const fills = async () => {
      const board = await a.query(anyApi.stonks.board, {});
      const now = Date.now() + 1000;
      await a.mutation(anyApi.stonks.ingest, {
        ticks: board.rows.map((r: { symbol: string; price: number }) => ({
          symbol: r.symbol,
          price: r.price,
          time: now,
          recv: now,
          source: "yahoo",
          session: "regular",
        })),
      });
    };
    await fills();
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await phone(ctx, { player, notifications: "granted" });
    await page.goto("/");
    await page.getByRole("button", { name: "Turn on notifications" }).click();
    await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const shot = async (name: string) => {
        await readyForShot(page);
        await page.screenshot({ path: `e2e/.state/screens/${scheme}-stonks-${name}.png`, animations: "allow" });
      };
      await page.goto("/games");
      await page.getByRole("heading", { name: "Stonks" }).scrollIntoViewIfNeeded();
      await shot("games");
      await page.evaluate(() => localStorage.setItem("stonks-range", "1D"));
      await page.goto("/stonks");
      await expect(page.getByRole("heading", { name: "Top 20" })).toBeVisible();
      await shot("board");
      await page.mouse.wheel(0, 460);
      await shot("board-market");
      await page.mouse.wheel(0, 900);
      await shot("board-movers");
      await page.mouse.wheel(0, 900);
      await shot("board-rows");
      await page.mouse.wheel(0, 3000);
      await shot("board-news");
      await page.goto("/stonks/NVDA");
      await expect(page.getByRole("region", { name: "Stats" })).toBeVisible();
      await shot("nvda-1d");
      const chart = page.getByRole("slider", { name: /^NVIDIA Corporation, \w+day,/ });
      const box = (await chart.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.42, box.y + box.height / 2);
      await shot("nvda-scrub");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
      for (const r of ["1W", "1M", "1Y", "5Y"]) {
        await page.getByRole("radio", { name: r }).click();
        await expect(page.getByRole("radio", { name: r })).toBeChecked();
        await shot(`nvda-${r.toLowerCase()}`);
      }
      if (scheme === "dark") {
        await page.getByRole("radio", { name: "1D" }).click();
        await page.getByRole("button", { name: "Buy", exact: true }).click();
        await shot("trade-sheet");
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^Buy \$/ })
          .click();
        await shot("order-waiting");
        await fills();
        await expect(page.getByRole("region", { name: "Your position" })).toBeVisible({ timeout: 30_000 });
        await shot("position");
      }
      if (scheme === "dark") {
        await page.goto("/stonks");
        const box = page.getByRole("searchbox", { name: "Search anything" });
        await box.click();
        await shot("search-picks");
        await box.fill("toyota");
        await expect(page.getByRole("link", { name: /^7203\.T,/ })).toContainText("¥", { timeout: 20_000 });
        await shot("search-results");
        await page.getByRole("link", { name: /^7203\.T,/ }).click();
        await chartDrawn(page);
        await shot("tokyo");
        await page.goto("/stonks/BTC-USD");
        await expect(page.getByRole("button", { name: "Buy", exact: true })).toBeEnabled({ timeout: 20_000 });
        await chartDrawn(page);
        await shot("bitcoin");
        await page.getByRole("button", { name: "Buy", exact: true }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^Buy \$/ })
          .click();
        await expect(page.getByRole("region", { name: "Your position" })).toBeVisible({ timeout: 30_000 });
        await shot("bitcoin-bought");
        await page.goto("/stonks/NVDA");
        await expect(page.getByRole("region", { name: "Stats" })).toBeVisible();
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
    const exited = new Promise((r) => sidecar.once("exit", r));
    sidecar.kill("SIGKILL");
    await exited;
  }
});
