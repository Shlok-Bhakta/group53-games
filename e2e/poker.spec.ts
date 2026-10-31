import type { Browser, Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test, type Player } from "./fixtures";

async function otherPhone(browser: Browser, player: Player) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  return { context, page: await phone(context, { player, notifications: "granted" }) };
}

async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}

const getMatch = (id: string) => admin().query(anyApi.testing.getMatch, { id });
const boardCards = (page: Page) => page.getByRole("group", { name: "Poker table" }).getByRole("group", { name: "Board" }).locator("[data-card]");

// Two phones at a started table. Returns them with whoever acts first (the button, heads-up) first.
async function twoPlayerGame(browser: Browser, context: Parameters<typeof phone>[0], mode = "holdem") {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const pa = await phone(context, { player: a, notifications: "granted" });
  const other = await otherPhone(browser, b);
  const pb = other.page;
  await enablePush(pa);
  await enablePush(pb);
  await pa.goto(`/poker/mode/${mode}`);
  await pa.getByRole("button", { name: "Open a game" }).click();
  await expect(pa.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  const id = pa.url().split("/poker/")[1].split("?")[0];
  await pb.goto(`/poker/${id}?accept=1`);
  await expect(pa.getByRole("heading", { name: "2 in" })).toBeVisible();
  await pa.getByRole("button", { name: "Start with 2" }).click();
  await expect(pa.getByRole("group", { name: "Poker table" })).toBeVisible();
  await expect(pb.getByRole("group", { name: "Poker table" })).toBeVisible();
  const m = await getMatch(id);
  const firstIsA = m.players[m.state.turn].userId === a.userId;
  const first = firstIsA ? { player: a, page: pa } : { player: b, page: pb };
  const second = firstIsA ? { player: b, page: pb } : { player: a, page: pa };
  return { id, first, second, close: () => other.context.close() };
}

test.describe("Poker", () => {
  test("the game card opens the Poker page with its four games", async ({ context }) => {
    const me = await createPlayer("Shlok");
    const page = await phone(context, { player: me, notifications: "granted" });
    await enablePush(page);
    await page.goto("/games");
    await page.getByRole("link", { name: "Play Poker" }).click();
    await expect(page).toHaveURL(/\/poker$/);
    await expect(page.getByRole("region", { name: "Async" }).getByRole("link")).toHaveText([/Hold'em/, /Omaha/, /Short Deck/, /5-Card Draw/]);
    await page.getByRole("link", { name: "Omaha" }).click();
    await expect(page.getByRole("heading", { name: "Omaha", level: 1 })).toBeVisible();
    await expect(page.getByText(/exactly two of your four cards/)).toBeVisible();
    await expect(page.getByText(/Pot limit/).first()).toBeVisible();
  });

  test("a hand on two phones: calls, a raise, a lined-up check, a shove and a fold", async ({ browser, context }) => {
    const { id, first, second, close } = await twoPlayerGame(browser, context);
    // Both see their own two cards and the blinds.
    await expect(first.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2);
    await expect(second.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2);
    await expect(first.page.getByText("Hand 1 of 10")).toBeVisible();
    await expect(first.page.getByText("Your move")).toBeVisible();

    await first.page.getByRole("button", { name: "Call 10" }).click();
    await expect(second.page.getByText("Your move")).toBeVisible();
    await second.page.getByRole("button", { name: "Raise", exact: true }).click();
    await expect(second.page.getByRole("heading", { name: "Raise to" })).toBeVisible();
    await second.page.getByRole("button", { name: "Min" }).click();
    await second.page.getByRole("button", { name: "Raise to 40" }).click();
    // The raise lands on the other phone: chips in front of the seat, and 20 to call.
    await expect(first.page.getByRole("button", { name: "Call 20" })).toBeVisible();
    await first.page.getByRole("button", { name: "Call 20" }).click();
    await expect(boardCards(first.page)).toHaveCount(3);
    await expect(boardCards(second.page)).toHaveCount(3);

    // After the flop the big blind acts first. The button lines up Check/Fold while it waits.
    const checkFold = first.page.getByRole("button", { name: "Check/Fold" });
    await checkFold.click();
    await expect(checkFold).toHaveAttribute("aria-pressed", "true");
    await second.page.getByRole("button", { name: "Check", exact: true }).click();
    // The lined-up check plays itself: the turn card comes out and it's the big blind again.
    await expect(boardCards(second.page)).toHaveCount(4);
    await expect(second.page.getByText("Your move")).toBeVisible();

    await second.page.getByRole("button", { name: "Bet", exact: true }).click();
    await second.page.getByRole("button", { name: "All in", exact: true }).click();
    await second.page.getByRole("button", { name: "All in 960" }).click();
    await expect(first.page.getByRole("button", { name: "All in 960" })).toBeVisible();
    await first.page.getByRole("button", { name: "Fold" }).click();

    // The next hand is dealt straight away, and the last one is a tap away.
    await expect(first.page.getByText("Hand 2 of 10")).toBeVisible();
    await expect(second.page.getByText("Hand 2 of 10")).toBeVisible();
    const m = await getMatch(id);
    expect(m.state.last.hand).toBe(1);
    expect(m.state.stacks.reduce((x: number, y: number) => x + y, 0) + m.state.bets.reduce((x: number, y: number) => x + y, 0)).toBe(2000);
    await second.page.getByRole("button", { name: "Last hand" }).click();
    await expect(second.page.getByRole("heading", { name: "Hand 1" })).toBeVisible();
    await expect(second.page.getByRole("dialog").getByText(/took 80/)).toBeVisible();
    await close();
  });

  test("five-card draw: pick cards and swap them", async ({ browser, context }) => {
    const { id, first, second, close } = await twoPlayerGame(browser, context, "draw");
    await expect(first.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(5);
    await first.page.getByRole("button", { name: "Call 10" }).click();
    await second.page.getByRole("button", { name: "Check", exact: true }).click();
    // The draw: the big blind (first to the button's left) swaps first.
    await expect(second.page.getByText("Pick cards to swap")).toBeVisible();
    const before = await second.page.getByRole("group", { name: "Your cards" }).locator("[data-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
    await second.page.getByRole("button", { name: "Swap card 1" }).click();
    await second.page.getByRole("button", { name: "Swap card 2" }).click();
    await second.page.getByRole("button", { name: "Swap 2" }).click();
    await expect(first.page.getByText("Pick cards to swap")).toBeVisible();
    await first.page.getByRole("button", { name: "Keep all five" }).click();
    await expect(second.page.getByText("Your move")).toBeVisible();
    const after = await second.page.getByRole("group", { name: "Your cards" }).locator("[data-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(after.slice(0, 2)).not.toEqual(before.slice(0, 2));
    const m = await getMatch(id);
    expect(m.state.drew.filter((d: number | null) => d !== null).sort()).toEqual([0, 2]);
    await close();
  });
});
