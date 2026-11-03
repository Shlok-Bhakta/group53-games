// Visual review of Poker: SCREENS=1 npm run test:e2e -- poker-screens. Writes PNGs to e2e/.state/screens.
import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

for (const scheme of ["dark", "light"] as const) {
  test(`poker screens ${scheme}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const names = ["WashableBowl700", "chrisis14", "Boiler", "Wes", "Kai", "Sam", "Lee", "Dev"].slice(0, Number(process.env.PLAYERS ?? 6));
    const looks = [{ frame: "gold", badge: "🦀" }, { frame: "comet", frameColor: "#f38ba8", glow: true }, { frame: "fire", badge: "🃏" }, { frame: "neon", frameColor: "#f9e2af", glow: true }, {}, { frame: "holo" }, { frame: "rgb" }, { frame: "ice", badge: "🐧" }];
    const players = await Promise.all(names.map((n, i) => createPlayer(n, looks[i])));
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
    await a.getByRole("button", { name: "Settings" }).click();
    await shot("mode", a, true);
    await a.getByRole("button", { name: "Open a game" }).click();
    await expect(a.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
    const id = a.url().split("/poker/")[1];
    for (const p of pages.slice(1)) await p.goto(`/poker/${id}?accept=1`);
    // A full table starts by itself.
    if (names.length < 8) {
      await expect(a.getByRole("heading", { name: `${names.length} in` })).toBeVisible();
      await a.getByRole("button", { name: `Start with ${names.length}` }).click();
    }
    await expect(a.getByRole("group", { name: "Poker table" })).toBeVisible();
    await expect(a.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2, { timeout: 15_000 });

    const snap = () => admin().query(anyApi.testing.getMatch, { id });
    const pageOf = (m: { players: { userId: string }[] }, seat: number) => pages[players.findIndex((p) => p.userId === m.players[seat].userId)];
    // Taps a button on the phone whose turn it is, and waits for the move to land.
    const play = async (name: string | RegExp, before?: (p: Page) => Promise<void>) => {
      const m = await snap();
      const p = pageOf(m, m.state.turn);
      await p.getByRole("button", { name, exact: typeof name === "string" }).or(p.getByRole("button", { name: "Raise", exact: true })).first().waitFor({ timeout: 20_000 });
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
    const owing = names.slice(1).map((_, k) => (now.turn + k + 1) % names.length).find((seat) => !now.folded[seat] && now.current > now.bets[seat])!;
    const waiting = pageOf(await snap(), owing);
    await waiting.getByRole("button", { name: /^Call/ }).click();
    await expect(waiting.getByRole("button", { name: /^Call/ })).toHaveAttribute("aria-pressed", "true");
    await shot("waiting", waiting);
    for (let i = 0; i < names.length && (await snap()).state.street === 0; i++) await play(/^Call/);
    const m = await snap();
    await shot("game", pageOf(m, m.state.turn));
    await shot("watching-turn", pageOf(m, (m.state.turn + 1) % names.length));
    // Everyone checks it down to see a showdown.
    for (let i = 0; i < 40 && (await snap()).state.hand === 1; i++) await play("Check");
    await expect(a.getByText(/(took|won|split) the pot/).first()).toBeVisible({ timeout: 15_000 });
    await a.screenshot({ path: `e2e/.state/screens/${scheme}-poker-showdown.png`, animations: "allow" });
    await a.getByRole("button", { name: "Last hand" }).click({ timeout: 20_000 });
    await shot("last-hand");
  });
}

// A whole hand on film, from the deal to the next deal: e2e/.state/screens/poker-hand.webm. Also fails on a long stall.
test("poker hand on video", async ({ browser }) => {
  test.setTimeout(240_000);
  const looks = [{ frame: "gold", badge: "🦀" }, { frame: "comet", frameColor: "#f38ba8", glow: true }, { frame: "fire", badge: "🃏" }, { frame: "neon", frameColor: "#f9e2af", glow: true }, { frame: "holo" }];
  const names = ["WashableBowl700", "chrisis14", "Boiler", "Wes", "Kai"];
  const players = await Promise.all(names.map((n, i) => createPlayer(n, looks[i])));
  const opts = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" as const };
  const filming = await browser.newContext({ ...opts, recordVideo: { dir: "e2e/.state/screens/video", size: { width: 393, height: 852 } } });
  const ctxs = [filming, ...(await Promise.all(players.slice(1).map(() => browser.newContext(opts))))];
  const pages = await Promise.all(players.map((p, i) => phone(ctxs[i], { player: p, notifications: "granted" })));
  for (const p of pages) {
    await p.goto("/");
    await p.getByRole("button", { name: "Turn on notifications" }).click();
  }
  const [a] = pages;
  await a.goto("/poker/mode/holdem");
  await a.getByRole("button", { name: "Open a game" }).click();
  await expect(a.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  const id = a.url().split("/poker/")[1];
  for (const p of pages.slice(1)) await p.goto(`/poker/${id}?accept=1`);
  await expect(a.getByRole("heading", { name: "5 in" })).toBeVisible();
  await a.evaluate(() => {
    const w = window as unknown as { __gap: number };
    w.__gap = 0;
    let last = performance.now();
    const tick = (t: number) => {
      w.__gap = Math.max(w.__gap, t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await a.getByRole("button", { name: "Start with 5" }).click();
  const snap = () => admin().query(anyApi.testing.getMatch, { id });
  await expect.poll(async () => (await snap()).state?.hand).toBe(1);
  const pageOf = (m: { players: { userId: string }[] }, seat: number) => pages[players.findIndex((p) => p.userId === m.players[seat].userId)];
  let acts = 0;
  for (; acts < 40; acts++) {
    const m = await snap();
    if (m.state.hand > 1) break;
    const p = pageOf(m, m.state.turn);
    // A raise, a fold, then everyone calls and checks it down.
    const name = acts === 0 ? /^Raise$/ : acts === 1 ? /^Fold$/ : /^(Call|Check)/;
    await p.getByRole("button", { name }).first().click({ timeout: 30_000 });
    if (acts === 0) {
      await p.getByRole("button", { name: "Min" }).click();
      await p.getByRole("button", { name: /^Raise to/ }).click();
    }
    await expect.poll(async () => (await snap()).moveCount, { timeout: 15_000 }).not.toBe(m.moveCount);
    await p.waitForTimeout(500);
  }
  await expect(a.getByRole("button", { name: "Last hand" })).toBeVisible({ timeout: 30_000 });
  await a.waitForTimeout(3000);
  const gap = await a.evaluate(() => (window as unknown as { __gap: number }).__gap);
  console.log(`longest frame ${Math.round(gap)}ms`);
  expect(gap).toBeLessThan(2000);
  const video = a.video();
  await filming.close();
  await video?.saveAs("e2e/.state/screens/poker-hand.webm");
  for (const c of ctxs.slice(1)) await c.close();
});
