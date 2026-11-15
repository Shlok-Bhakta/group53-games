import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { marketClock } from "../convex/stonks/market";
import { admin, convexIdle, createPlayer, expect, ready, test, type Phones, type Player } from "./fixtures";
import { LANDSCAPE, SAFE_LANDSCAPE, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

const HOLDINGS = [
  { symbol: "NVDA", name: "NVIDIA CORP", weight: 7.77, base: 200 },
  { symbol: "AAPL", name: "APPLE INC", weight: 7.65, base: 270 },
  { symbol: "MSFT", name: "MICROSOFT CORP", weight: 5.92, base: 520 },
];

async function seed() {
  const a = admin();
  const { day } = marketClock(Date.now());
  const start = day.open - 5.5 * 3600_000;
  const walk = (base: number, k: number) =>
    Array.from({ length: 16 * 60 }, (_, i) => [
      start + i * 60_000,
      +(base * (1 + 0.01 * Math.sin(i / (40 + k)) + i * 0.00001 * (k - 1))).toFixed(2),
    ]).filter((p) => p[0] < Date.now());
  await a.mutation(anyApi.stonks.holdings, { asOf: "2026-10-29", holdings: HOLDINGS, indexBase: 6000 });
  const series = [
    ["^GSPC", 6000, "S&P 500", 5990],
    ["NVDA", 200, "NVIDIA Corporation", 199],
    ["AAPL", 270, "Apple Inc.", 268],
    ["MSFT", 520, "Microsoft Corporation", 521],
  ] as const;
  for (const [i, [symbol, base, name, prevClose]] of series.entries()) {
    const points = walk(base, i);
    await a.mutation(anyApi.stonks.series, { symbol, range: "1D", points, prevClose, name });
    await a.mutation(anyApi.stonks.series, {
      symbol,
      range: "1W",
      points: points.filter((_, j) => j % 5 === 0).map(([t, p], j) => [t - (400 - j) * 3_600_000, p * 0.97]),
    });
    const last = points.at(-1)!;
    if (symbol !== "^GSPC")
      await a.mutation(anyApi.stonks.setProfile, {
        symbol,
        stats: {
          marketCap: base * 1e10,
          trailingPE: 31.4,
          avgVolume: 40_000_000,
          targetLow: base * 0.8,
          targetMean: base * 1.1,
          targetHigh: base * 1.3,
          analysts: 38,
          rating: "buy",
          sector: "Technology",
          summary: `${name} makes things.`,
        },
        news: [
          { title: `${name} does a thing`, publisher: "Yahoo Finance", link: "https://example.com/news", time: Date.now() - 3600_000 },
        ],
      });
    else
      await a.mutation(anyApi.stonks.setProfile, {
        symbol,
        news: [{ title: "Stocks do stock things", publisher: "Reuters", link: "https://example.com/market", time: Date.now() - 600_000 }],
      });
    await a.mutation(anyApi.stonks.ingest, {
      ticks: [{ symbol, price: last[1], time: last[0], recv: Date.now(), source: "yahoo", session: "post" }],
      feeds: [{ source: "yahoo", state: "live" }],
    });
  }
  return a;
}

async function intoStonks(phones: Phones, player: Player) {
  const page = await phones.open({ player, push: "on" });
  await page.goto("/stonks");
  await expect(page.getByRole("heading", { name: "Stonks" })).toBeVisible();
  return page;
}

async function warmed(page: Page, ...prefixes: string[]) {
  await expect
    .poll(() =>
      page.evaluate(
        (prefixes) =>
          prefixes.filter((p) => !((window as unknown as { __stonksWarmed?: string[] }).__stonksWarmed ?? []).some((k) => k.startsWith(p))),
        prefixes,
      ),
    )
    .toEqual([]);
  await convexIdle(page);
}

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

const rowOrder = (page: Page) =>
  page.getByRole("link", { name: /^(NVDA|AAPL|MSFT),/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.split(",")[0]));

test("Stonks has a card on Games, and Play opens the board", async ({ phones }) => {
  await seed();
  const page = await phones.open({ player: await createPlayer("Shlok"), push: "on" });
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

test("a trade from the sidecar moves the board live, and the ranking follows the price", async ({ phones }) => {
  const a = await seed();
  const page = await intoStonks(phones, await createPlayer("Shlok"));
  await expect.poll(() => rowOrder(page)).toEqual(["NVDA", "AAPL", "MSFT"]);
  const now = Date.now();
  await a.mutation(anyApi.stonks.ingest, {
    ticks: [
      {
        symbol: "AAPL",
        price: 297,
        time: now,
        recv: now,
        source: "yahoo",
        session: marketClock(now).state === "open" ? "regular" : "post",
      },
    ],
  });
  const apple = page.getByRole("link", { name: /^AAPL,/ });
  await expect(apple).toContainText("$297.00");
  await expect.poll(() => rowOrder(page)).toEqual(["AAPL", "NVDA", "MSFT"]);
});

test("a stock's page: price, stats, ranges, and a chart you can scrub", async ({ phones }) => {
  await seed();
  const page = await intoStonks(phones, await createPlayer("Shlok"));
  await page.getByRole("link", { name: /^MSFT,/ }).click();
  await expect(page).toHaveURL(/\/stonks\/MSFT$/);
  await expect(page.getByRole("heading", { name: "MSFT" })).toBeVisible();
  await expect(page.getByText("Microsoft Corporation").first()).toBeVisible();
  const stats = page.getByRole("region", { name: "Stats" });
  await expect(stats.getByText("Share of the S&P 500")).toBeVisible();
  await expect(stats.getByText("$521.00")).toBeVisible();
  const section = page.getByRole("region", { name: "Microsoft Corporation chart" });
  const hero = section.locator("[data-hero-price]");
  const live = await hero.textContent();
  const chart = section.getByRole("slider", { name: /^Microsoft Corporation, (today|\w+day),/ });
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect(chart).toHaveAttribute("data-scrubbing", "");
  await expect(section.getByText(/ ET$/).first()).toBeVisible();
  await expect(hero).not.toHaveText(live!);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 120);
  await expect(hero).toHaveText(live!);
  await section.getByRole("radio", { name: "1W" }).click();
  await expect(section.getByText("Past week")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "1W" })).toBeChecked();
});

test("everything you can tap is already loaded: no skeleton from the Games card, the board or a stock", async ({ phones }) => {
  await seed();
  const page = await phones.open({ player: await createPlayer("Shlok"), push: "on" });
  await page.goto("/games");
  await page.getByRole("heading", { name: "Stonks" }).scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByType("resource").some((e) => /\/Stonks-[\w-]+\.js$/.test(e.name))))
    .toBe(true);
  await warmed(page, "stonks:board:", "stonks:chart:");
  await watchForSkeletons(page);
  await page.getByRole("link", { name: "Play Stonks" }).click();
  await expect(page.getByRole("heading", { name: "Top 3" })).toBeVisible();
  await page.getByRole("link", { name: /^MSFT,/ }).scrollIntoViewIfNeeded();
  await warmed(page, 'stonks:quote:{"symbol":"MSFT"}', 'stonks:profile:{"symbol":"MSFT"}', 'stonks:chart:{"symbol":"MSFT"');
  await page.getByRole("link", { name: /^MSFT,/ }).click();
  await expect(page.getByRole("region", { name: "Stats" })).toBeVisible();
  await expect(page.getByText("Microsoft Corporation does a thing")).toBeVisible();
  expect(await sawSkeleton(page)).toBe(false);
});

test("pro mode: key stats, analysts and about, one tap away and remembered", async ({ phones }) => {
  await seed();
  const page = await intoStonks(phones, await createPlayer("Shlok"));
  await expect(page.getByRole("heading", { name: "Market news" })).toBeVisible();
  await page.getByRole("link", { name: /^NVDA,/ }).click();
  await expect(page.getByRole("heading", { name: "NVDA", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Key stats" })).toHaveCount(0);
  const pro = page.getByRole("button", { name: "Pro mode" });
  await expect(pro).toHaveAttribute("aria-pressed", "false");
  await pro.click();
  await expect(pro).toHaveAttribute("aria-pressed", "true");
  const stats = page.getByRole("region", { name: "Key stats" });
  await expect(stats.getByText("Market cap")).toBeVisible();
  await expect(stats.getByText("$2T")).toBeVisible();
  await expect(page.getByRole("region", { name: "Analysts" }).getByText("Buy · 38 analysts")).toBeVisible();
  await expect(page.getByRole("region", { name: "About" }).getByText("NVIDIA Corporation makes things.")).toBeVisible();
  await page.getByRole("radio", { name: "1W" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Pro mode" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Key stats" })).toBeVisible();
});

const trade = (symbol: string, price: number) => {
  const now = Date.now() + 1000;
  return admin().mutation(anyApi.stonks.ingest, { ticks: [{ symbol, price, time: now, recv: now, source: "yahoo", session: "regular" }] });
};

test("everyone starts with $10,000: buy on one phone, it fills on the next trade, the crew sees it live", async ({ phones }) => {
  await seed();
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const [page, other] = await Promise.all([intoStonks(phones, a), intoStonks(phones, b)]);
  await expect.poll(() => admin().query(anyApi.stonks.hot, {})).toEqual(["*"]);
  const money = page.getByRole("region", { name: "Your money" });
  await expect(money).toContainText("$10,000.00");
  await expect(money).toContainText("#");
  const crew = other.getByRole("region", { name: "Crew", exact: true });
  await expect(crew.getByText("Shlok")).toBeVisible();
  await expect(crew.getByText("All cash").first()).toBeVisible();

  await page.getByRole("link", { name: /^NVDA,/ }).click();
  await expect(page.getByRole("heading", { name: "NVDA", level: 1 })).toBeVisible();
  const buy = page.getByRole("button", { name: "Buy", exact: true });
  const box = (await buy.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(852);
  expect(box.height).toBeGreaterThanOrEqual(56);
  await buy.click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "10%" }).click();
  await expect(sheet.getByText("$1,000.00").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Buy $1,000.00" }).click();
  await expect(sheet).toHaveCount(0);

  await expect(page.getByRole("region", { name: "Waiting to fill" })).toContainText("Buy $1,000.00 of NVDA");
  await trade("NVDA", 250);
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toHaveCount(0);
  const position = page.getByRole("region", { name: "Your position" });
  await expect(position).toContainText("4 shares");
  await expect(position).toContainText("at $250.00");
  await expect(page.getByText("Bought $1,000.00 of NVDA at $250.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sell", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy more" })).toBeVisible();

  await expect(other.getByRole("region", { name: "Crew trades" })).toContainText("Shlok bought NVDA");
  await expect(crew.getByText("1 position")).toBeVisible();
  await trade("NVDA", 300);
  await expect(crew.getByRole("link", { name: "Shlok's profile" })).toContainText("$10,200.00");
  await expect(crew.getByRole("link", { name: /'s profile$/ }).first()).toHaveAccessibleName("Shlok's profile");
});

test("a friend's profile: everyone on one chart, then what they hold, what's waiting and what they've done, and Buy one tap away", async ({
  phones,
}) => {
  await seed();
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const [page, other] = await Promise.all([intoStonks(phones, a), intoStonks(phones, b)]);

  const order = async (symbol: string) => {
    await other.goto(`/stonks/${symbol}`);
    await other.getByRole("button", { name: "Buy", exact: true }).click();
    const sheet = other.getByRole("dialog");
    await sheet.getByRole("button", { name: "10%" }).click();
    await sheet.getByRole("button", { name: /^Buy \$/ }).click();
    await expect(sheet).toHaveCount(0);
  };
  await order("NVDA");
  await expect(other.getByRole("region", { name: "Waiting to fill" })).toBeVisible();
  await trade("NVDA", 200);
  await expect(other.getByRole("region", { name: "Your position" })).toBeVisible();
  await order("AAPL");
  await expect(other.getByRole("region", { name: "Waiting to fill" })).toBeVisible();
  await trade("NVDA", 250);

  const crew = page.getByRole("region", { name: "Crew", exact: true });
  await expect(crew.getByRole("img", { name: /^Everyone's net worth over the game\./ })).toBeVisible();
  await expect(crew.getByRole("link", { name: "Chris's profile" })).toContainText("$10,250.00");

  const chrisRow = crew.getByRole("link", { name: "Chris's profile" });
  await chrisRow.dispatchEvent("pointerdown");
  await warmed(page, "stonks:player:");
  await watchForSkeletons(page);
  await chrisRow.click();
  await expect(page.getByRole("heading", { name: "Chris", level: 1 })).toBeVisible();
  expect(await sawSkeleton(page)).toBe(false);
  await expect(page.getByRole("region", { name: "Chris's money" })).toContainText("$10,250.00");
  await expect(page.getByRole("slider", { name: /^Chris's net worth over the game/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /^1 up, 0 down\. NVDA/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toContainText("Buy $900.00 of AAPL");
  await expect(page.getByRole("button", { name: /^Cancel/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "History" })).toContainText("Bought NVDA");
  await expect(page.getByRole("region", { name: "Record" })).toContainText("Trades");

  await page.getByRole("link", { name: "Chris's position in NVDA" }).click();
  await expect(page.getByRole("heading", { name: "NVDA", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Crew in this stock" }).getByRole("link", { name: "Chris's profile" })).toBeVisible();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "10%" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Buy \$/ })
    .click();
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toContainText("of NVDA");

  await page.goto("/stonks");
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "You", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel Buy NVDA" })).toHaveCount(1);

  await page.goto("/crew");
  await page.getByRole("button", { name: /Chris/ }).first().click();
  await page.getByRole("link", { name: "Stonks profile" }).click();
  await expect(page.getByRole("heading", { name: "Chris", level: 1 })).toBeVisible();
});

test("short, cover at a profit; and a waiting order can be cancelled", async ({ phones }) => {
  await seed();
  const page = await intoStonks(phones, await createPlayer("Shlok"));
  await page.goto("/stonks/MSFT");
  await page.getByRole("button", { name: "Short", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "25%" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Short $2,500.00" }).click();
  const waiting = page.getByRole("region", { name: "Waiting to fill" });
  await expect(waiting).toContainText("Short $2,500.00 of MSFT");
  await waiting.getByRole("button", { name: "Cancel Short MSFT" }).click();
  await expect(waiting).toHaveCount(0);

  await page.getByRole("button", { name: "Short", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "25%" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Short $2,500.00" }).click();
  await expect(waiting).toContainText("Short");
  await trade("MSFT", 500);
  await expect(page.getByRole("region", { name: "Your position" })).toContainText("Short 5 shares");
  await trade("MSFT", 400);
  await expect(page.getByRole("region", { name: "Your position" })).toContainText("+20.00%");

  await page.getByRole("button", { name: "Cover", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cover $2,000.00" }).click();
  await expect(waiting).toContainText("Cover all of MSFT");
  await trade("MSFT", 400);
  await expect(page.getByRole("region", { name: "Your position" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Trades in this stock" })).toContainText("made $500.00");
  await page.goto("/stonks");
  await expect(page.getByRole("region", { name: "Your money" })).toContainText("$10,500.00");
});

test("search finds anything, even what Yahoo has to be asked about, and it trades in its own currency", async ({ phones }) => {
  const a = await seed();
  const page = await intoStonks(phones, await createPlayer("Shlok"));
  await a.mutation(anyApi.stonks.addSymbols, {
    rows: [{ symbol: "TM", name: "Toyota Motor Corporation", type: "EQUITY", exchange: "NYSE" }],
  });
  const box = page.getByRole("searchbox", { name: "Search anything" });
  await box.click();
  await expect(page.getByRole("region", { name: "Not just stocks" })).toContainText("Bitcoin");
  await expect(page.getByRole("region", { name: "Your money" })).toHaveCount(0);
  await box.fill("toyota");
  await expect(page.getByRole("link", { name: /^TM,/ })).toBeVisible();
  await expect.poll(() => a.query(anyApi.stonks.pendingLookups, {})).toEqual(["toyota"]);
  await a.mutation(anyApi.stonks.lookedUp, {
    q: "toyota",
    rows: [
      { symbol: "TM", name: "Toyota Motor Corporation", type: "EQUITY", exchange: "NYSE" },
      { symbol: "7203.T", name: "Toyota Motor Corporation", type: "EQUITY", exchange: "Tokyo Stock Exchange" },
    ],
  });
  const tokyo = page.getByRole("link", { name: /^7203\.T,/ });
  await expect(tokyo).toContainText("Tokyo Stock Exchange");
  await expect.poll(() => a.query(anyApi.stonks.watchlist, {})).toContain("7203.T");
  const now = Date.now();
  await a.mutation(anyApi.stonks.snapshot, {
    rows: [
      { symbol: "JPYUSD=X", price: 0.005, time: now - 1000, type: "CURRENCY", currency: "USD" },
      {
        symbol: "7203.T",
        price: 3000,
        time: now - 900_000,
        prevClose: 2900,
        currency: "JPY",
        type: "EQUITY",
        exchange: "JPX",
        state: "REGULAR",
        name: "TOYOTA MOTOR CORP",
      },
    ],
  });
  await expect(tokyo).toContainText("¥3,000.00");
  await tokyo.click();
  await expect(page.getByRole("heading", { name: "7203.T", level: 1 })).toBeVisible();
  await expect.poll(() => a.query(anyApi.stonks.deepWatch, {})).toContain("7203.T");
  const hero = page.getByRole("region", { name: "TOYOTA MOTOR CORP chart" });
  await expect(hero).toContainText("¥3,000.00");
  await expect(hero).toContainText("Market open");
  await expect(page.getByText("Share of the S&P 500")).toHaveCount(0);

  await page.getByRole("button", { name: "Buy", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "10%" }).click();
  await expect(sheet).toContainText("66.667 shares at ¥3,000.00");
  await sheet.getByRole("button", { name: "Buy $1,000.00" }).click();
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toContainText("Buy $1,000.00 of 7203.T");
  await trade("7203.T", 3200);
  const position = page.getByRole("region", { name: "Your position" });
  await expect(position).toContainText("62.5 shares");
  await expect(position).toContainText("at $16.00");
  await expect(page.getByText("Bought $1,000.00 of 7203.T at ¥3,200.00")).toBeVisible();
});

test("crypto never shuts, and a feed that runs late says so", async ({ phones }) => {
  const a = await seed();
  const page = await intoStonks(phones, await createPlayer("Shlok"));
  const now = Date.now();
  await a.mutation(anyApi.stonks.snapshot, {
    rows: [
      {
        symbol: "BTC-USD",
        price: 78000,
        time: now - 2000,
        prevClose: 77000,
        currency: "USD",
        type: "CRYPTOCURRENCY",
        exchange: "CCC",
        state: "REGULAR",
        name: "Bitcoin USD",
      },
    ],
  });
  await page.goto("/stonks/BTC-USD");
  await expect(page.getByRole("region", { name: "Bitcoin USD chart" })).toContainText("Open 24/7");
  await expect(page.getByRole("region", { name: "Bitcoin USD chart" })).toContainText("$78,000.00");
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Next trade");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await a.mutation(anyApi.stonks.ingest, {
    ticks: [{ symbol: "7203.T", price: 3000, time: now - 900_000, recv: now, source: "yahoo", session: "regular" }],
  });
  await a.mutation(anyApi.stonks.snapshot, {
    rows: [
      {
        symbol: "7203.T",
        price: 3000,
        time: now - 900_000,
        currency: "USD",
        type: "EQUITY",
        exchange: "JPX",
        state: "REGULAR",
        name: "Toyota",
      },
    ],
  });
  await page.goto("/stonks/7203.T");
  await expect(page.getByRole("region", { name: "Toyota chart" })).toContainText("15 min late");
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Next trade, about 15 min");
});

test("landscape: the board, a stock with its chart beside its stats and Buy at the bottom, and a profile all fit", async ({ phones }) => {
  await seed();
  const page = await intoStonks(phones, await createPlayer("Shlok"));
  await simulateSafeAreas(page, SAFE_LANDSCAPE);
  await rotate(page, "landscape");
  await ready(page);
  await expectFitsScreen(page);
  if (process.env.SCREENS) await page.screenshot({ path: "e2e/.state/screens/light-stonks-landscape-board.png" });

  await page.getByRole("link", { name: /^MSFT,/ }).click();
  await expect(page.getByRole("heading", { name: "MSFT", level: 1 })).toBeVisible();
  await ready(page);
  await expectFitsScreen(page);
  const chart = (await page.getByRole("region", { name: "Microsoft Corporation chart" }).boundingBox())!;
  const stats = (await page.getByRole("region", { name: "Stats" }).boundingBox())!;
  expect(stats.x, "the stats sit beside the chart").toBeGreaterThanOrEqual(chart.x + chart.width);
  expect(stats.y, "the stats start level with the chart").toBeLessThan(chart.y + chart.height / 2);
  const buy = (await page.getByRole("button", { name: "Buy", exact: true }).boundingBox())!;
  const bottom = LANDSCAPE.height - SAFE_LANDSCAPE.bottom;
  expect(buy.y + buy.height, "Buy clears the home indicator").toBeLessThanOrEqual(bottom);
  expect(buy.y + buy.height, "Buy sits at the bottom of the screen").toBeGreaterThan(bottom - 24);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => page.evaluate(() => scrollY), "the page scrolls").toBeGreaterThan(0);
  expect((await page.getByRole("button", { name: "Buy", exact: true }).boundingBox())!.y, "Buy stays pinned as it scrolls").toBe(buy.y);
  if (process.env.SCREENS) await page.screenshot({ path: "e2e/.state/screens/light-stonks-landscape-stock.png" });

  await page.goto("/stonks");
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "You", level: 1 })).toBeVisible();
  await ready(page);
  await expectFitsScreen(page);
  if (process.env.SCREENS) await page.screenshot({ path: "e2e/.state/screens/light-stonks-landscape-profile.png" });
});
