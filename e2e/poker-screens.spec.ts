// Visual review of Poker: SCREENS=1 npm run test:e2e -- poker-screens. Writes PNGs to e2e/.state/screens.
import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

for (const scheme of ["dark", "light"] as const) {
  test(`poker screens ${scheme}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const names = ["WashableBowl700", "chrisis14", "Boiler", "Wes", "Kai", "Sam"];
    const players = await Promise.all(names.map((n) => createPlayer(n)));
    const ctxs = await Promise.all(players.map(() => browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme })));
    const pages = await Promise.all(players.map((p, i) => phone(ctxs[i], { player: p, notifications: "granted" })));
    for (const p of pages) {
      await p.goto("/");
      await p.getByRole("button", { name: "Turn on notifications" }).click();
    }
    const [a] = pages;
    const shot = async (name: string, page: Page = a, full = false) => {
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-poker-${name}.png`, fullPage: full, animations: "allow" });
    };
    await a.goto("/games");
    await shot("games", a, true);
    await a.goto("/poker");
    await shot("hub");
    await a.goto("/poker/mode/holdem");
    await shot("mode", a, true);
    await a.getByRole("button", { name: "Open a game" }).click();
    await expect(a.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
    const id = a.url().split("/poker/")[1];
    for (const p of pages.slice(1)) await p.goto(`/poker/${id}?accept=1`);
    await expect(a.getByRole("heading", { name: "6 in" })).toBeVisible();
    await a.getByRole("button", { name: "Start with 6" }).click();
    await expect(a.getByRole("group", { name: "Poker table" })).toBeVisible();

    const snap = () => admin().query(anyApi.testing.getMatch, { id });
    const pageOf = (m: { players: { userId: string }[] }, seat: number) => pages[players.findIndex((p) => p.userId === m.players[seat].userId)];
    // Taps a button on the phone whose turn it is, and waits for the move to land.
    const play = async (name: string | RegExp, before?: (p: Page) => Promise<void>) => {
      const m = await snap();
      const p = pageOf(m, m.state.turn);
      await before?.(p);
      await p.getByRole("button", { name, exact: typeof name === "string" }).click();
      await expect.poll(async () => (await snap()).moveCount, { timeout: 15_000 }).not.toBe(m.moveCount);
      return p;
    };
    // A round: a raise, a call, a fold, someone lining up a call, then everyone calls to the flop.
    await play(/^Raise to/, async (p) => {
      await p.getByRole("button", { name: "Raise", exact: true }).click();
      await shot("raise", p);
      await p.getByRole("button", { name: "Pot", exact: true }).click();
    });
    await play(/^Call/);
    await play("Fold");
    const now = (await snap()).state;
    const owing = [1, 2, 3, 4, 5].map((k) => (now.turn + k) % 6).find((seat) => !now.folded[seat] && now.current > now.bets[seat])!;
    const waiting = pageOf(await snap(), owing);
    await waiting.getByRole("button", { name: /^Call/ }).click();
    await expect(waiting.getByRole("button", { name: /^Call/ })).toHaveAttribute("aria-pressed", "true");
    await shot("waiting", waiting);
    for (let i = 0; i < 6 && (await snap()).state.street === 0; i++) await play(/^Call/);
    const m = await snap();
    await shot("game", pageOf(m, m.state.turn));
    await shot("watching-turn", pageOf(m, (m.state.turn + 1) % 6));
    // Everyone checks it down to see a showdown.
    for (let i = 0; i < 30 && (await snap()).state.hand === 1; i++) await play("Check");
    await a.waitForTimeout(200);
    await a.screenshot({ path: `e2e/.state/screens/${scheme}-poker-showdown.png`, animations: "allow" });
    await a.getByRole("button", { name: "Last hand" }).click();
    await shot("last-hand");
  });
}
