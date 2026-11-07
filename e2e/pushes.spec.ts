import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, getMatch, matchIdOf, onScreen, test, type Player } from "./fixtures";

// Test players never get real pushes; the test backend keeps what they would have got (testPushes).
type Sent = { title: string; body: string; url: string; tag?: string; badge: number };
const pushesOf = (p: Player): Promise<Sent[]> => admin().query(anyApi.testing.pushesOf, { userId: p.userId });

async function classicMove(page: Page, from: string, to: string) {
  await expect(onScreen(page).locator("span:not(a *)", { hasText: /^Your move$/ })).toBeVisible();
  await page.locator(`[data-square=${from}]`).click();
  await page.locator(`[data-square=${to}]`).click();
  await page.getByRole("button", { name: /^Confirm/ }).click();
}

test.describe("pushes", () => {
  test("a challenge pushes its link, a move pushes whoever's away, and nobody watching is pushed", async ({ phones }) => {
    const [shlok, chris] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
    const [a, b] = await Promise.all([phones.open({ player: shlok, push: "on" }), phones.open({ player: chris, push: "on" })]);

    await a.goto("/chess/mode/classic");
    await a.getByRole("button", { name: "Challenge Chris" }).click();
    await expect(a.getByRole("heading", { name: "Challenge sent" })).toBeVisible();
    const id = matchIdOf(a);

    // The challenge reaches Chris with the link that takes the seat, tagged to the game, and counts on the icon.
    await expect.poll(() => pushesOf(chris)).toEqual([expect.objectContaining({ url: `/chess/${id}?accept=1`, tag: `match:${id}`, badge: 1, title: expect.stringContaining("Shlok") })]);
    expect(await pushesOf(shlok)).toEqual([]);

    await b.goto(`/chess/${id}?accept=1`);
    await expect(b.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    await expect(a.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    const m = await getMatch(id);
    const shlokWhite = m.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId;
    const [white, black] = shlokWhite ? [a, b] : [b, a];
    const [whitePlayer, blackPlayer] = shlokWhite ? [shlok, chris] : [chris, shlok];

    // Black steps away: white's screen stops saying they're here.
    await expect(white.getByText("Black, here now")).toBeVisible();
    await black.goto("/");
    await expect(white.getByText("Black, here now")).toHaveCount(0);
    const blackBefore = (await pushesOf(blackPlayer)).length;
    await classicMove(white, "e2", "e4");
    await expect.poll(async () => (await pushesOf(blackPlayer)).slice(blackBefore)).toEqual([expect.objectContaining({ url: `/chess/${id}`, tag: `match:${id}`, badge: 1 })]);

    // Black answers while white is still looking at the game: white sees it land live, and gets no push.
    const whiteBefore = (await pushesOf(whitePlayer)).length;
    await black.goto(`/chess/${id}`);
    await expect(black.getByText("White, here now")).toBeVisible();
    await classicMove(black, "e7", "e5");
    await expect(onScreen(white).locator("span:not(a *)", { hasText: /^Your move$/ })).toBeVisible();
    expect((await pushesOf(whitePlayer)).slice(whiteBefore)).toEqual([]);
  });
});
