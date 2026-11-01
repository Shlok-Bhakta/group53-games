import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { marketClock } from "../convex/stonks/market";
import { admin, createPlayer, expect, phone, test } from "./fixtures";

// Stonks on a phone: the card on Games, the board ranked by share of the index, a trade arriving from
// the sidecar (here, straight through its internal mutation) and moving the board live, and a stock's
// page with a chart you can put your finger on.

const HOLDINGS = [
  { symbol: "NVDA", name: "NVIDIA CORP", weight: 7.77, base: 200 },
  { symbol: "AAPL", name: "APPLE INC", weight: 7.65, base: 270 },
  { symbol: "MSFT", name: "MICROSOFT CORP", weight: 5.92, base: 520 },
];

// A day of prices on today's session (or the last one, out of hours): a gentle walk from 4am to 8pm.
async function seed() {
  const a = admin();
  const { day } = marketClock(Date.now());
  const start = day.open - 5.5 * 3600_000;
  const walk = (base: number, k: number) => Array.from({ length: 16 * 60 }, (_, i) => [start + i * 60_000, +(base * (1 + 0.01 * Math.sin(i / (40 + k)) + i * 0.00001 * (k - 1))).toFixed(2)]);
  await a.mutation(anyApi.stonks.holdings, { asOf: "2026-10-29", holdings: HOLDINGS, indexBase: 6000 });
  const series = [["^GSPC", 6000, "S&P 500", 5990], ["NVDA", 200, "NVIDIA Corporation", 199], ["AAPL", 270, "Apple Inc.", 268], ["MSFT", 520, "Microsoft Corporation", 521]] as const;
  for (const [i, [symbol, base, name, prevClose]] of series.entries()) {
    const points = walk(base, i);
    await a.mutation(anyApi.stonks.series, { symbol, range: "1D", points, prevClose, name });
    await a.mutation(anyApi.stonks.series, { symbol, range: "1W", points: points.filter((_, j) => j % 5 === 0).map(([t, p], j) => [t - (400 - j) * 3_600_000, p * 0.97]) });
    const last = points.at(-1)!;
    if (symbol !== "^GSPC")
      await a.mutation(anyApi.stonks.setProfile, {
        symbol,
        stats: { marketCap: base * 1e10, trailingPE: 31.4, avgVolume: 40_000_000, targetLow: base * 0.8, targetMean: base * 1.1, targetHigh: base * 1.3, analysts: 38, rating: "buy", sector: "Technology", summary: `${name} makes things.` },
        news: [{ title: `${name} does a thing`, publisher: "Yahoo Finance", link: "https://example.com/news", time: Date.now() - 3600_000 }],
      });
    else await a.mutation(anyApi.stonks.setProfile, { symbol, news: [{ title: "Stocks do stock things", publisher: "Reuters", link: "https://example.com/market", time: Date.now() - 600_000 }] });
    await a.mutation(anyApi.stonks.ingest, { ticks: [{ symbol, price: last[1], time: last[0], recv: Date.now(), source: "yahoo", session: "post" }], feeds: [{ source: "yahoo", state: "live" }] });
  }
  return a;
}

async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}

async function intoStonks(page: Page) {
  await enablePush(page);
  await page.goto("/stonks");
  await expect(page.getByRole("heading", { name: "Stonks" })).toBeVisible();
}

// Records whether a loading skeleton ever shows from now on (they all carry aria-busy).
const watchForSkeletons = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __skeleton: string | false };
    const check = () => {
      const el = document.querySelector("[aria-busy=true]");
      if (el && !w.__skeleton) w.__skeleton = `${location.pathname}: ${el.querySelector("h1")?.textContent ?? "?"}`;
    };
    w.__skeleton = false;
    check();
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
const sawSkeleton = (page: Page) => page.evaluate(() => (window as unknown as { __skeleton: string | false }).__skeleton);

const rowOrder = (page: Page) => page.getByRole("link", { name: /^(NVDA|AAPL|MSFT),/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.split(",")[0]));

test("Stonks has a card on Games, and Play opens the board", async ({ context }) => {
  await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await enablePush(page);
  await page.goto("/games");
  await page.getByRole("heading", { name: "Stonks" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: "A stock chart going to the moon" })).toBeVisible();
  await page.getByRole("link", { name: "Play Stonks" }).click();
  await expect(page).toHaveURL(/\/stonks$/);
  await expect(page.getByRole("region", { name: "S&P 500 chart" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top 3" })).toBeVisible();
  expect(await rowOrder(page)).toEqual(["NVDA", "AAPL", "MSFT"]);
  await expect(page.getByText(/weights from SPY, Oct 29/)).toBeVisible();
});

test("a trade from the sidecar moves the board live, and the ranking follows the price", async ({ context }) => {
  const a = await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await intoStonks(page);
  await expect.poll(() => rowOrder(page)).toEqual(["NVDA", "AAPL", "MSFT"]);
  const now = Date.now();
  // Apple jumps 10%: its share of the index passes NVIDIA's.
  await a.mutation(anyApi.stonks.ingest, { ticks: [{ symbol: "AAPL", price: 297, time: now, recv: now, source: "yahoo", session: marketClock(now).state === "open" ? "regular" : "post" }] });
  const apple = page.getByRole("link", { name: /^AAPL,/ });
  await expect(apple).toContainText("$297.00");
  await expect.poll(() => rowOrder(page)).toEqual(["AAPL", "NVDA", "MSFT"]);
});

test("a stock's page: price, stats, ranges, and a chart you can scrub", async ({ context }) => {
  await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await intoStonks(page);
  await page.getByRole("link", { name: /^MSFT,/ }).click();
  await expect(page).toHaveURL(/\/stonks\/MSFT$/);
  await expect(page.getByRole("heading", { name: "MSFT" })).toBeVisible();
  await expect(page.getByText("Microsoft Corporation").first()).toBeVisible();
  const stats = page.getByRole("region", { name: "Stats" });
  await expect(stats.getByText("Share of the S&P 500")).toBeVisible();
  await expect(stats.getByText("$521.00")).toBeVisible(); // previous close
  const section = page.getByRole("region", { name: "Microsoft Corporation chart" });
  const hero = section.locator(".font-display.text-title-lg");
  const live = await hero.textContent();
  // A finger on the chart shows that moment's price and time; letting go goes back to the live price.
  const chart = section.getByRole("img", { name: /^Microsoft Corporation, (today|\w+day),/ });
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect(chart).toHaveAttribute("data-scrubbing", "");
  await expect(section.getByText(/ ET$/).first()).toBeVisible();
  await expect(hero).not.toHaveText(live!);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 120);
  await expect(hero).toHaveText(live!);
  // Other ranges, remembered on the phone.
  await section.getByRole("radio", { name: "1W" }).click();
  await expect(section.getByText("Past week")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "1W" })).toBeChecked();
});

test("everything you can tap is already loaded: no skeleton from the Games card, the board or a stock", async ({ context }) => {
  await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await enablePush(page);
  await page.goto("/games");
  await page.getByRole("heading", { name: "Stonks" }).scrollIntoViewIfNeeded();
  // The card on screen starts loading the board: its code and its data.
  await page.waitForTimeout(1500);
  await watchForSkeletons(page);
  await page.getByRole("link", { name: "Play Stonks" }).click();
  await expect(page.getByRole("heading", { name: "Top 3" })).toBeVisible();
  // Rows on screen (or nearly) are warm, so a stock opens straight into its page.
  await page.getByRole("link", { name: /^MSFT,/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.getByRole("link", { name: /^MSFT,/ }).click();
  await expect(page.getByRole("region", { name: "Stats" })).toBeVisible();
  await expect(page.getByText("Microsoft Corporation does a thing")).toBeVisible();
  expect(await sawSkeleton(page)).toBe(false);
});

test("pro mode: key stats, analysts and about, one tap away and remembered", async ({ context }) => {
  await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await intoStonks(page);
  await expect(page.getByRole("heading", { name: "Market news" })).toBeVisible();
  await page.getByRole("link", { name: /^NVDA,/ }).click();
  await expect(page.getByRole("region", { name: "Key stats" })).toHaveCount(0);
  // The board slides away; then there's one Pro button, the stock's.
  await expect(page.getByRole("button", { name: "Pro mode" })).toHaveCount(1);
  const pro = page.getByRole("button", { name: "Pro mode" });
  await expect(pro).toHaveAttribute("aria-pressed", "false");
  await pro.click();
  await expect(pro).toHaveAttribute("aria-pressed", "true");
  const stats = page.getByRole("region", { name: "Key stats" });
  await expect(stats.getByText("Market cap")).toBeVisible();
  await expect(stats.getByText("$2T")).toBeVisible();
  await expect(page.getByRole("region", { name: "Analysts" }).getByText("Buy · 38 analysts")).toBeVisible();
  await expect(page.getByRole("region", { name: "About" }).getByText("NVIDIA Corporation makes things.")).toBeVisible();
  // The year's chart gets its moving averages, with a key.
  await page.getByRole("radio", { name: "1W" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Pro mode" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Key stats" })).toBeVisible();
});
