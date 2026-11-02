// Visual review of the crew chart and profiles, with no real market data: SCREENS=1 npm run test:e2e -- stonks-crew-screens.
// A crew of five trades a made-up week of prices. Writes PNGs to e2e/.state/screens.
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";
import { admin, createPlayer, expect, phone, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

const STOCKS: Record<string, number> = { NVDA: 200, AAPL: 270, MSFT: 520, TSLA: 400, AMZN: 220, META: 700, GOOGL: 300 };

test("stonks crew screens", async ({ browser }) => {
  test.setTimeout(240_000);
  const { url } = JSON.parse(readFileSync("e2e/.state/backend.json", "utf8"));
  const a = admin();
  await a.mutation(anyApi.stonks.holdings, { asOf: "2026-10-29", holdings: Object.entries(STOCKS).map(([symbol, base], i) => ({ symbol, name: symbol, weight: 8 - i, base })), indexBase: 6000 });
  const prices = { ...STOCKS, "^GSPC": 6000 } as Record<string, number>;
  const tick = async () => {
    const now = Date.now() + 1000;
    await a.mutation(anyApi.stonks.ingest, { ticks: Object.entries(prices).map(([symbol, price]) => ({ symbol, price: +price.toFixed(2), time: now, recv: now, source: "yahoo", session: "regular" })) });
  };
  await tick();
  const player = await createPlayer("Shlok");
  const orders: [string, [string, string, number][]][] = [
    ["chrisis14", [["AAPL", "buy", 5000], ["MSFT", "buy", 2000], ["TSLA", "short", 1500]]],
    ["samwise", [["TSLA", "short", 4000], ["META", "buy", 3000]]],
    ["alex_dev", [["NVDA", "buy", 9000]]],
    ["bytes", [["GOOGL", "buy", 1000]]],
  ];
  const clients: ConvexHttpClient[] = [];
  for (const [name, list] of orders) {
    const p = await createPlayer(name);
    const c = new ConvexHttpClient(url);
    c.setAuth(p.token);
    clients.push(c);
    for (const [symbol, side, dollars] of list) await c.mutation(anyApi.stonks.order, { symbol, side, dollars });
  }
  const me = new ConvexHttpClient(url);
  me.setAuth(player.token);
  for (const [symbol, side, dollars] of [["NVDA", "buy", 3000], ["AAPL", "buy", 1500], ["MSFT", "short", 1000], ["TSLA", "buy", 800], ["AMZN", "buy", 1200], ["META", "buy", 600], ["GOOGL", "short", 400]] as const) await me.mutation(anyApi.stonks.order, { symbol, side, dollars });
  await new Promise((r) => setTimeout(r, 1200));
  await tick();
  // A week of swings, a net worth row after each.
  const drift: Record<string, number> = { NVDA: 0.012, AAPL: -0.004, MSFT: 0.003, TSLA: -0.008, AMZN: 0.002, META: -0.001, GOOGL: 0.007 };
  for (let i = 0; i < 26; i++) {
    for (const s of Object.keys(STOCKS)) prices[s] *= 1 + drift[s] + 0.012 * Math.sin(i / 2 + s.charCodeAt(0));
    await tick();
    await a.mutation(anyApi.stonks.recordWorth, {});
    await new Promise((r) => setTimeout(r, 120));
  }
  // Cards with something on them, since a profile wears its owner's card.
  await me.mutation(anyApi.profiles.update, { frame: "neon", frameColor: "#a855f7", glow: true, effect: "foil", badge: "🦀", tagline: "buy high, sell never" });
  await clients[1].mutation(anyApi.profiles.update, { frame: "gold", effect: "crt", tagline: "rm -rf portfolio" });
  // Something waiting, for the profile to show.
  await me.mutation(anyApi.stonks.order, { symbol: "AMZN", side: "buy", dollars: 250 });
  await clients[0].mutation(anyApi.stonks.order, { symbol: "NVDA", side: "buy", dollars: 500 });

  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await phone(ctx, { player, notifications: "granted" });
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const shot = async (name: string) => {
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-stonks-${name}.png`, animations: "allow" });
    };
    await page.goto("/stonks");
    const crew = page.getByRole("region", { name: "Crew", exact: true });
    await crew.scrollIntoViewIfNeeded();
    await shot("crew-chart");
    const chart = crew.getByRole("img", { name: /^Everyone's net worth/ });
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
    await shot("crew-scrub");
    await page.mouse.move(box.x, box.y + box.height + 400);
    await page.getByRole("link", { name: "Your profile" }).click();
    await expect(page.getByRole("heading", { name: "You", level: 1 })).toBeVisible();
    await shot("profile-me");
    await page.mouse.wheel(0, 460);
    await shot("profile-me-pie");
    await page.mouse.wheel(0, 700);
    await shot("profile-me-rows");
    await page.mouse.wheel(0, 900);
    await shot("profile-me-history");
    await page.goto("/stonks");
    await page.getByRole("link", { name: "samwise's profile" }).click();
    await expect(page.getByRole("heading", { name: "samwise", level: 1 })).toBeVisible();
    await shot("profile-friend");
    await page.mouse.wheel(0, 460);
    await shot("profile-friend-pie");
  }
  await ctx.close();
});
