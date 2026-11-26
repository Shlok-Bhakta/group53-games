import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import {
  admin,
  createPlayer,
  expect,
  fillLobby,
  getMatch,
  holdsStill,
  openLobby,
  ready,
  readyForShot,
  test,
  type Phones,
} from "./fixtures";
import { SAFE_LANDSCAPE, SAFE_PORTRAIT, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

type Uno = { seq: number; turn: number; top: string; color: string; counts: number[]; forgot: number | null; hand: number };
const stateOf = async (id: string) => (await getMatch(id)).state as Uno;
const SHOTS = !!process.env.SCREENS;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await readyForShot(page);
  await page.screenshot({ path: `e2e/.state/screens/uno-${name}.png` });
};

async function startGame(phones: Phones, settings: Record<string, string> = {}, names = ["Shlok", "Chris"], mode = "classic") {
  const players = await Promise.all(names.map((n) => createPlayer(n)));
  const pages = await Promise.all(players.map((p) => phones.open({ player: p, push: "on" })));
  const id = await openLobby(pages[0], "uno", mode, settings);
  await fillLobby(pages[0], pages.slice(1));
  for (const p of pages) await expect(p.getByRole("group", { name: "Your hand" })).toBeVisible({ timeout: 20_000 });
  const m = await getMatch(id);
  const seatOf = (i: number) => m.players.findIndex((x: { userId: string }) => x.userId === players[i].userId);
  return { id, pages, players, seatOf };
}

async function deal(id: string, bySeat: Record<number, string[]>, top: string, turn: number, deck?: string[], patch?: object) {
  const n = (await getMatch(id)).players.length;
  const hands = Array.from({ length: n }, (_, i) => bySeat[i] ?? ["g9", "g8", "g7"]);
  await admin().mutation(anyApi.testing.unoDeal, { id, hands, top, turn, deck, patch });
}

const hand = (page: Page) => page.getByRole("group", { name: "Your hand" });
const card = (page: Page, c: string) => hand(page).locator(`[data-card="${c}"]`).first();
const table = (page: Page) => page.locator("[data-top]");
async function play(page: Page, c: string, at?: { x: number; y: number }) {
  await card(page, c).click(at && { position: at });
  await expect(card(page, c)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Play", exact: true }).click();
}

async function drag(page: Page, c: string, to: "table" | "hand", aim?: "ok" | "no", held?: () => Promise<void>) {
  const from = (await card(page, c).boundingBox())!;
  const box = (await (to === "table" ? table(page) : hand(page)).boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = to === "table" ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: start.x + 30, y: start.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(start.x + ((end.x - start.x) * i) / 8, start.y + ((end.y - start.y) * i) / 8);
  if (aim) await expect(page.locator("[data-pile]")).toHaveAttribute("data-aim", aim);
  await held?.();
  await page.mouse.up();
}

test("the colour sheet closes when the game moves on under it", async ({ phones }) => {
  const { id, pages, seatOf } = await startGame(phones);
  const [pa] = pages;
  const [sa, sb] = [seatOf(0), seatOf(1)];
  await deal(id, { [sa]: ["wW", "r6"], [sb]: ["b9", "g1", "g2"] }, "r9", sa, Array(40).fill("y3"));
  await card(pa, "wW").click();
  await pa.getByRole("button", { name: "Play", exact: true }).click();
  const sheet = pa.getByRole("dialog", { name: "Pick a color" });
  await expect(sheet).toBeVisible();
  await deal(id, { [sa]: ["wW", "r6"], [sb]: ["b9", "g1", "g2"] }, "r9", sb, Array(40).fill("y3"), { seq: (await stateOf(id)).seq + 1 });
  await expect(sheet).toHaveCount(0);
});

test("Uno has a card on Games and both modes have their house rules", async ({ phones }) => {
  const page = await phones.open({ player: await createPlayer("Shlok"), push: "on" });
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Uno" })).toBeVisible();
  await page.goto("/uno/mode/classic");
  await page.getByRole("button", { name: "Settings" }).click();
  for (const group of [
    "Starting hand",
    "Decks",
    "Stacking draws",
    "Can't play?",
    "7 swaps, 0 passes",
    "Jump-in",
    "Challenge a Wild Draw 4",
    "Play to",
  ])
    await expect(page.getByRole("radiogroup", { name: group })).toBeVisible();
  await ready(page);
  await shot(page, "mode");
  await page.goto("/uno/mode/nomercy");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("radiogroup", { name: "Mercy rule" })).toBeVisible();
  await ready(page);
});

test("two phones: plays land live, a wild picks its color, a forgotten UNO gets caught, going out ends it", async ({ phones }) => {
  test.setTimeout(180_000);
  const { id, pages, seatOf } = await startGame(phones);
  const [pa, pb] = pages;
  const [sa, sb] = [seatOf(0), seatOf(1)];
  await deal(id, { [sa]: ["r5", "wW", "b2", "y7"], [sb]: ["b9", "g1", "g2"] }, "r9", sa, Array(40).fill("y3"));
  await expect(card(pa, "r5")).toHaveAttribute("data-playable", "true");
  await expect(card(pa, "b2")).not.toHaveAttribute("data-playable");
  await card(pa, "r5").click();
  await expect(card(pa, "r5")).toHaveAttribute("aria-pressed", "true");
  await card(pa, "b2").click();
  await expect(pa.getByText("That doesn't match.")).toBeVisible();
  await expect(card(pa, "r5")).toHaveAttribute("aria-pressed", "false");
  await expect(pa.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
  await card(pa, "r5").click();
  await expect(card(pa, "r5")).toHaveAttribute("aria-pressed", "true");
  await shot(pa, "picked");
  await card(pa, "r5").click();
  await expect(card(pa, "r5")).toHaveAttribute("aria-pressed", "false");
  await expect(table(pa)).toHaveAttribute("data-top", "r9");

  await play(pa, "r5");
  await expect(table(pb)).toHaveAttribute("data-top", "r5");
  await expect(pb.locator(`[data-seat="${sa}"]`)).toHaveAttribute("data-count", "3");
  await expect(pb.getByRole("button", { name: "Draw", exact: true })).toBeEnabled();
  await expect(pb.locator("[data-last=play]")).toHaveText(/Shlok played/);
  await shot(pb, "playing");

  await pb.getByRole("button", { name: "Draw", exact: true }).click();
  await expect.poll(async () => (await stateOf(id)).turn).toBe(sa);
  await expect(pa.locator(`[data-seat="${sb}"]`)).toHaveAttribute("data-count", "4");

  await play(pa, "wW");
  await expect(pa.getByRole("dialog", { name: "Pick a color" })).toBeVisible();
  await shot(pa, "color");
  await pa.getByRole("dialog").getByRole("button", { name: "Blue" }).click();
  await expect(table(pb)).toHaveAttribute("data-color", "b");

  await deal(id, { [sa]: ["b4", "b5"], [sb]: ["g1", "g2", "b9"] }, "b3", sa, Array(40).fill("y3"));
  await play(pa, "b4");
  await expect.poll(async () => (await stateOf(id)).forgot).toBe(sa);
  await expect(pa.getByRole("button", { name: /Call UNO/ })).toBeVisible();
  await pb.getByRole("button", { name: /^Catch/ }).click();
  await expect.poll(async () => (await stateOf(id)).counts[sa]).toBe(3);
  await expect(pa.locator("[data-last=catch]")).toHaveText(/caught you without UNO/);

  await deal(id, { [sa]: ["b4", "b5"], [sb]: ["g1", "g2", "b9"] }, "b3", sa);
  await pa.getByRole("button", { name: "UNO!" }).click();
  await expect(pa.getByRole("button", { name: "UNO!" })).toHaveAttribute("aria-pressed", "true");
  await play(pa, "b4");
  await expect(pb.locator(`[data-seat="${sa}"]`)).toHaveAttribute("data-count", "1");
  expect((await stateOf(id)).forgot).toBeNull();
  await play(pb, "b9");
  await expect(table(pa)).toHaveAttribute("data-top", "b9");
  await play(pa, "b5");
  await expect.poll(async () => (await getMatch(id)).status).toBe("finished");
  for (const p of pages) await expect(p.getByRole("region", { name: "Result" })).toBeVisible();
  await shot(pa, "result");
});

test("a card dragged onto the table plays it, without tapping Play", async ({ phones }) => {
  test.setTimeout(150_000);
  const { id, pages, seatOf } = await startGame(phones);
  const [pa, pb] = pages;
  const [sa, sb] = [seatOf(0), seatOf(1)];
  await deal(id, { [sa]: ["r5", "wW", "b2", "y7"], [sb]: ["b9", "g1", "g2"] }, "r9", sa, Array(40).fill("y3"));
  await expect(card(pa, "r5")).toHaveAttribute("data-playable", "true");

  await drag(pa, "b2", "table", "no", () => shot(pa, "dragging-wrong"));
  await expect(pa.getByText("That doesn't match.")).toBeVisible();
  await expect(card(pa, "b2")).toBeVisible();
  await expect(table(pa)).toHaveAttribute("data-top", "r9");

  await drag(pa, "r5", "hand");
  await expect(card(pa, "r5")).toHaveAttribute("aria-pressed", "false");
  await expect(table(pa)).toHaveAttribute("data-top", "r9");
  await expect(pa.locator("[data-pile]")).not.toHaveAttribute("data-aim");

  await drag(pa, "r5", "table", "ok", () => shot(pa, "dragging"));
  await expect(table(pb)).toHaveAttribute("data-top", "r5");
  await expect(card(pa, "r5")).toHaveCount(0);
  await pb.getByRole("button", { name: "Draw", exact: true }).click();
  await expect.poll(async () => (await stateOf(id)).turn).toBe(sa);

  await expect(card(pa, "wW")).toHaveAttribute("data-playable", "true");
  await drag(pa, "wW", "table", "ok");
  await expect(pa.getByRole("dialog", { name: "Pick a color" })).toBeVisible();
  await pa.getByRole("dialog").getByRole("button", { name: "Green" }).click();
  await expect(table(pb)).toHaveAttribute("data-color", "g");
  await expect(table(pb)).toHaveAttribute("data-top", "wW");
});

test("stacking and a Wild Draw 4 challenge on two phones", async ({ phones }) => {
  test.setTimeout(150_000);
  const { id, pages, seatOf } = await startGame(phones, { "Stacking draws": "Same or bigger" });
  const [pa, pb] = pages;
  const [sa, sb] = [seatOf(0), seatOf(1)];
  await deal(id, { [sa]: ["rD2", "r1", "wW4"], [sb]: ["bD2", "g1", "g2"] }, "r9", sa, Array(40).fill("y3"));
  await expect(card(pa, "rD2")).toHaveAttribute("data-playable", "true");
  await play(pa, "rD2");
  await expect(pb.locator("[data-pending]")).toHaveAttribute("data-pending", "2");
  await expect(card(pb, "bD2")).toHaveAttribute("data-playable", "true");
  await play(pb, "bD2");
  await expect(pa.locator("[data-pending]")).toHaveAttribute("data-pending", "4");
  await shot(pa, "stacked");
  await play(pa, "wW4");
  await pa.getByRole("dialog").getByRole("button", { name: "Green" }).click();
  await expect(pb.locator("[data-pending]")).toHaveAttribute("data-pending", "8");
  await pb.getByRole("button", { name: "Take 8" }).click();
  await expect(pa.locator(`[data-seat="${sb}"]`)).toHaveAttribute("data-count", "10");

  await deal(id, { [sa]: ["wW4", "r1", "g5"], [sb]: ["g1", "g2"] }, "r9", sa, Array(40).fill("y3"));
  await play(pa, "wW4");
  await pa.getByRole("dialog").getByRole("button", { name: "Blue" }).click();
  await pb.getByRole("button", { name: "Challenge" }).click();
  await expect(hand(pa)).toHaveAttribute("data-cards", "6");
  await expect(pa.locator("[data-last=challenge]")).toHaveText(/bluffing/);
});

test("coming back replays what the others did since you looked, and Skip jumps to now", async ({ phones }) => {
  test.setTimeout(150_000);
  const { id, pages, players, seatOf } = await startGame(phones, {}, ["Shlok", "Chris", "Sam"]);
  const [pa] = pages;
  const [sa, sb, sc] = [seatOf(0), seatOf(1), seatOf(2)];
  const as = (i: number, action: object) => admin().mutation(anyApi.testing.unoMoveAs, { id, userId: players[i].userId, action });
  await pa.addInitScript(() => {
    const tops: string[] = [];
    (window as unknown as { __tops: string[] }).__tops = tops;
    new MutationObserver(() => {
      const top = document.querySelector("[data-top]")?.getAttribute("data-top");
      if (top && tops.at(-1) !== top) tops.push(top);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-top"] });
  });
  const tops = () => pa.evaluate(() => (window as unknown as { __tops: string[] }).__tops);
  const hands = { [sa]: ["r1", "b2", "y3", "y4"], [sb]: ["r5", "r6", "g1", "g3"], [sc]: ["r7", "r8", "g2", "g4"] };
  const order = (from: number) => [from, (from + 1) % 3, (from + 2) % 3];
  const [first, second] = order(sa).slice(1);
  await deal(id, hands, "r9", first);
  await expect(table(pa)).toHaveAttribute("data-top", "r9");

  await pa.goto("/games");
  await as(
    players.findIndex((_, i) => seatOf(i) === first),
    { kind: "play", card: first === sb ? "r5" : "r7", uno: true },
  );
  await as(
    players.findIndex((_, i) => seatOf(i) === second),
    { kind: "play", card: second === sb ? "r5" : "r7", uno: true },
  );
  const final = (await stateOf(id)).top;
  await pa.goto(`/uno/${id}`);
  await expect(pa.getByRole("button", { name: "Skip to now" })).toBeVisible();
  await expect(table(pa)).toHaveAttribute("data-top", final, { timeout: 15_000 });
  await expect(pa.getByRole("button", { name: "Skip to now" })).toHaveCount(0);
  expect((await tops()).slice(-2)).toEqual([first === sb ? "r5" : "r7", final]);
  await expect(hand(pa)).toBeVisible();

  await deal(id, hands, "r9", first);
  await pa.goto("/games");
  await as(
    players.findIndex((_, i) => seatOf(i) === first),
    { kind: "play", card: first === sb ? "r6" : "r8", uno: true },
  );
  await as(
    players.findIndex((_, i) => seatOf(i) === second),
    { kind: "play", card: second === sb ? "r6" : "r8", uno: true },
  );
  const later = (await stateOf(id)).top;
  await pa.goto(`/uno/${id}`);
  await pa.getByRole("button", { name: "Skip to now" }).click();
  await expect(table(pa)).toHaveAttribute("data-top", later);
  await expect(card(pa, "r1")).toHaveAttribute("data-playable", "true");
  await holdsStill(pa);
});

test("on its side: the table on the left, the hand and players on the right, all on screen", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pages, seatOf } = await startGame(phones);
  const [pa] = pages;
  await deal(id, { [seatOf(0)]: ["r5", "r6", "b2", "y7", "g1", "g2", "g3", "y4", "y5"] }, "r9", seatOf(0));
  await simulateSafeAreas(pa, SAFE_LANDSCAPE);
  await rotate(pa, "landscape");
  await expect(hand(pa)).toBeVisible();
  await holdsStill(pa);
  await expectFitsScreen(pa);
  await shot(pa, "landscape");
  const hand9 = ["r5", "r6", "b2", "y7", "g1", "g2", "g3", "y4", "y5"];
  await deal(id, { [seatOf(0)]: hand9 }, "wWC", seatOf(0), undefined, { color: "r", pending: { kind: "roulette", by: seatOf(1) } });
  await expect(pa.getByRole("group", { name: "Spin for" })).toBeVisible();
  await holdsStill(pa);
  await expectFitsScreen(pa);
  await rotate(pa, "portrait");
  await holdsStill(pa);
  await expectFitsScreen(pa, SAFE_PORTRAIT);
});

test("a big hand folds into two rows that stay on screen, and the log lives in the menu", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pages, seatOf } = await startGame(phones);
  const [pa] = pages;
  const seven = ["r1", "r2", "r3", "b4", "b5", "g6", "y7"];
  await deal(id, { [seatOf(0)]: seven }, "r9", seatOf(0));
  await expect(hand(pa)).toHaveAttribute("data-cards", "7");
  await expect(hand(pa)).toHaveAttribute("data-rows", "1");
  const big = [...seven, "r4", "r5", "b6", "b7", "g8", "g9", "y1", "y2", "wW"];
  await deal(id, { [seatOf(0)]: big }, "r9", seatOf(0));
  await expect(hand(pa)).toHaveAttribute("data-cards", String(big.length));
  await expect(hand(pa)).toHaveAttribute("data-rows", "2");
  await holdsStill(pa);
  const width = pa.viewportSize()!.width;
  for (const c of big) {
    const box = (await card(pa, c).boundingBox())!;
    expect(box.x, c).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, c).toBeLessThanOrEqual(width);
  }
  const tops = await hand(pa)
    .locator("[data-card]")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(2);
  expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThanOrEqual(44);
  await shot(pa, "two-rows");
  await play(pa, "r1", { x: 12, y: 12 });
  await expect(table(pa)).toHaveAttribute("data-top", "r1");
  await pa.getByRole("button", { name: "Menu" }).click();
  await expect(pa.getByRole("region", { name: "What happened" })).toContainText("You played");
});

test("uno-screens", async ({ phones }) => {
  test.skip(!SHOTS, "Screenshots only");
  test.setTimeout(180_000);
  const { id, pages, seatOf } = await startGame(phones, {}, ["Shlok", "Chris", "Sam", "Alex"], "nomercy");
  const [pa] = pages;
  await deal(id, { [seatOf(0)]: ["rD4", "wW10", "wWC", "bSA", "gDA", "y7", "r0", "wWR4", "wW6", "b5", "bR"] }, "r9", seatOf(0));
  await expect(card(pa, "wW10")).toBeVisible();
  await shot(pa, "nomercy");
  await pa.emulateMedia({ colorScheme: "light" });
  await shot(pa, "nomercy-light");
});
