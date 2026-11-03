import type { Browser, Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { marketClock } from "../convex/stonks/market";
import { admin, createPlayer, expect, phone, test, type Player } from "./fixtures";

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
  // Only what's happened by now, so a trade stamped now is the latest whenever the suite runs.
  const walk = (base: number, k: number) => Array.from({ length: 16 * 60 }, (_, i) => [start + i * 60_000, +(base * (1 + 0.01 * Math.sin(i / (40 + k)) + i * 0.00001 * (k - 1))).toFixed(2)]).filter((p) => p[0] < Date.now());
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

// A trade in the regular session, stamped after anything already placed: what the sidecar would send.
const trade = (symbol: string, price: number) => {
  const now = Date.now() + 1000;
  return admin().mutation(anyApi.stonks.ingest, { ticks: [{ symbol, price, time: now, recv: now, source: "yahoo", session: "regular" }] });
};

async function secondPhone(browser: Browser, player: Player) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  return phone(context, { player, notifications: "granted" });
}

test("everyone starts with $10,000: buy on one phone, it fills on the next trade, the crew sees it live", async ({ context, browser }) => {
  await seed();
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const page = await phone(context, { player: a, notifications: "granted" });
  const other = await secondPhone(browser, b);
  await intoStonks(page);
  await intoStonks(other);
  // Being here is what makes the sidecar write every trade instead of one a minute.
  await expect.poll(() => admin().query(anyApi.stonks.hot, {})).toEqual(["*"]);
  const money = page.getByRole("region", { name: "Your money" });
  await expect(money).toContainText("$10,000.00");
  await expect(money).toContainText("#");
  const crew = other.getByRole("region", { name: "Crew" });
  await expect(crew.getByText("Shlok")).toBeVisible();
  await expect(crew.getByText("All cash").first()).toBeVisible();

  await page.getByRole("link", { name: /^NVDA,/ }).click();
  await expect(page.getByRole("heading", { name: "NVDA", level: 1 })).toBeVisible();
  // The actions are pinned where thumbs are, however long the page.
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

  // It waits: a trade hasn't happened since the tap. Nothing's spent, but it's set aside.
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toContainText("Buy $1,000.00 of NVDA");
  await trade("NVDA", 250);
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toHaveCount(0);
  const position = page.getByRole("region", { name: "Your position" });
  await expect(position).toContainText("4 shares");
  await expect(position).toContainText("at $250.00");
  await expect(page.getByText("Bought $1,000.00 of NVDA at $250.00")).toBeVisible();
  // The dock now closes it, or adds to it.
  await expect(page.getByRole("button", { name: "Sell", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy more" })).toBeVisible();

  // The other phone saw all of it: the trade, the position, and the price taking Shlok up the board.
  await expect(other.getByRole("region", { name: "Crew trades" })).toContainText("Shlok bought NVDA");
  await expect(crew.getByText("1 position")).toBeVisible();
  await trade("NVDA", 300);
  await expect(crew.locator("div", { hasText: "Shlok" }).first()).toContainText("$10,200.00");
  await expect(crew.locator("[class*=h-14]").first()).toContainText("Shlok");
  await other.context().close();
});

test("a friend's profile: everyone on one chart, then what they hold, what's waiting and what they've done, and Buy one tap away", async ({ context, browser }) => {
  await seed();
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const page = await phone(context, { player: a, notifications: "granted" });
  const other = await secondPhone(browser, b);
  await intoStonks(page);
  await intoStonks(other);

  // Chris buys NVDA, and lines up Apple with nothing trading it yet.
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

  // One chart with everyone on it, live, and each row is the key to its line.
  const crew = page.getByRole("region", { name: "Crew", exact: true });
  await expect(crew.getByRole("img", { name: /^Everyone's net worth over the game\./ })).toBeVisible();
  await expect(crew.getByRole("link", { name: "Chris's profile" })).toContainText("$10,250.00");

  // Their profile is already there when you tap it.
  await page.waitForTimeout(500);
  await watchForSkeletons(page);
  await crew.getByRole("link", { name: "Chris's profile" }).click();
  await expect(page.getByRole("heading", { name: "Chris", level: 1 })).toBeVisible();
  expect(await sawSkeleton(page)).toBe(false);
  await expect(page.getByRole("region", { name: "Chris's money" })).toContainText("$10,250.00");
  await expect(page.getByRole("img", { name: /^Chris's net worth over the game/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /^1 up, 0 down\. NVDA/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toContainText("Buy $900.00 of AAPL");
  // Somebody else's order is only there to read.
  await expect(page.getByRole("button", { name: /^Cancel/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "History" })).toContainText("Bought NVDA");
  await expect(page.getByRole("region", { name: "Record" })).toContainText("Trades");

  // What they hold is one tap from the same stock page, and Buy is where it always is.
  await page.getByRole("link", { name: "Chris's position in NVDA" }).click();
  await expect(page.getByRole("heading", { name: "NVDA", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Crew in this stock" }).getByRole("link", { name: "Chris's profile" })).toBeVisible();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "10%" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Buy \$/ }).click();
  await expect(page.getByRole("region", { name: "Waiting to fill" })).toContainText("of NVDA");

  // And my own profile is one tap from my money, where I can cancel what's waiting.
  await page.goto("/stonks");
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "You", level: 1 })).toBeVisible();
  // One, once the board has finished sliding away: it lists the same order.
  await expect(page.getByRole("button", { name: "Cancel Buy NVDA" })).toHaveCount(1);

  // It's a tap away from the Crew tab too.
  await page.goto("/crew");
  await page.getByRole("button", { name: /Chris/ }).first().click();
  await page.getByRole("link", { name: "Stonks profile" }).click();
  await expect(page.getByRole("heading", { name: "Chris", level: 1 })).toBeVisible();
  await other.context().close();
});

test("short, cover at a profit; and a waiting order can be cancelled", async ({ context }) => {
  await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await intoStonks(page);
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

test("search finds anything, even what Yahoo has to be asked about, and it trades in its own currency", async ({ context }) => {
  const a = await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await intoStonks(page);
  await a.mutation(anyApi.stonks.addSymbols, { rows: [{ symbol: "TM", name: "Toyota Motor Corporation", type: "EQUITY", exchange: "NYSE" }] });
  const box = page.getByRole("searchbox", { name: "Search anything" });
  // Tapping in shows there's more than stocks, and the board steps aside.
  await box.click();
  await expect(page.getByRole("region", { name: "Not just stocks" })).toContainText("Bitcoin");
  await expect(page.getByRole("region", { name: "Your money" })).toHaveCount(0);
  // What's known answers at once, and the sidecar's told to ask Yahoo, once.
  await box.fill("toyota");
  await expect(page.getByRole("link", { name: /^TM,/ })).toBeVisible();
  await expect.poll(() => a.query(anyApi.stonks.pendingLookups, {})).toEqual(["toyota"]);
  // Yahoo answers, and Tokyo joins the list live.
  await a.mutation(anyApi.stonks.lookedUp, {
    q: "toyota",
    rows: [{ symbol: "TM", name: "Toyota Motor Corporation", type: "EQUITY", exchange: "NYSE" }, { symbol: "7203.T", name: "Toyota Motor Corporation", type: "EQUITY", exchange: "Tokyo Stock Exchange" }],
  });
  const tokyo = page.getByRole("link", { name: /^7203\.T,/ });
  await expect(tokyo).toContainText("Tokyo Stock Exchange");
  // On screen, it's reported, so it streams; the sidecar's first batch quote gives it a price.
  await expect.poll(() => a.query(anyApi.stonks.watchlist, {})).toContain("7203.T");
  const now = Date.now();
  await a.mutation(anyApi.stonks.snapshot, {
    rows: [
      { symbol: "JPYUSD=X", price: 0.005, time: now - 1000, type: "CURRENCY", currency: "USD" },
      { symbol: "7203.T", price: 3000, time: now - 900_000, prevClose: 2900, currency: "JPY", type: "EQUITY", exchange: "JPX", state: "REGULAR", name: "TOYOTA MOTOR CORP" },
    ],
  });
  await expect(tokyo).toContainText("¥3,000.00");
  await tokyo.click();
  await expect(page.getByRole("heading", { name: "7203.T", level: 1 })).toBeVisible();
  await expect.poll(() => a.query(anyApi.stonks.deepWatch, {})).toContain("7203.T");
  const hero = page.getByRole("region", { name: "TOYOTA MOTOR CORP chart" });
  await expect(hero).toContainText("¥3,000.00");
  await expect(hero).toContainText("Market open");
  // Not in the S&P, so none of that.
  await expect(page.getByText("Share of the S&P 500")).toHaveCount(0);

  // $1,000 of it, bought in dollars, valued in dollars, filled by a trade stamped after the tap.
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

test("crypto never shuts, and a feed that runs late says so", async ({ context }) => {
  const a = await seed();
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await intoStonks(page);
  const now = Date.now();
  await a.mutation(anyApi.stonks.snapshot, { rows: [{ symbol: "BTC-USD", price: 78000, time: now - 2000, prevClose: 77000, currency: "USD", type: "CRYPTOCURRENCY", exchange: "CCC", state: "REGULAR", name: "Bitcoin USD" }] });
  await page.goto("/stonks/BTC-USD");
  await expect(page.getByRole("region", { name: "Bitcoin USD chart" })).toContainText("Open 24/7");
  await expect(page.getByRole("region", { name: "Bitcoin USD chart" })).toContainText("$78,000.00");
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Next trade");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await a.mutation(anyApi.stonks.ingest, { ticks: [{ symbol: "7203.T", price: 3000, time: now - 900_000, recv: now, source: "yahoo", session: "regular" }] });
  await a.mutation(anyApi.stonks.snapshot, { rows: [{ symbol: "7203.T", price: 3000, time: now - 900_000, currency: "USD", type: "EQUITY", exchange: "JPX", state: "REGULAR", name: "Toyota" }] });
  await page.goto("/stonks/7203.T");
  await expect(page.getByRole("region", { name: "Toyota chart" })).toContainText("15 min late");
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Next trade, about 15 min");
});
