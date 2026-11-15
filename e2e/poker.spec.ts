import type { Page } from "@playwright/test";
import { FRAME_COLOR } from "../convex/palette";
import {
  createPlayer,
  expect as plain,
  fillLobby,
  getMatch,
  holdsStill,
  openLobby,
  ready,
  readyForShot,
  test,
  type Phones,
} from "./fixtures";
import { LANDSCAPE, SAFE_LANDSCAPE, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

const expect = plain.configure({ timeout: 25_000 });
test.describe.configure({ timeout: 180_000 });

async function table(phones: Phones, names: string[], opts: { reducedMotion?: boolean; profiles?: Record<string, unknown>[] } = {}) {
  const players = await Promise.all(names.map((n, i) => createPlayer(n, opts.profiles?.[i])));
  const pages = await Promise.all(players.map((player) => phones.open({ player, push: "on", reducedMotion: opts.reducedMotion })));
  return { players, pages, pageOf: (userId: string) => pages[players.findIndex((p) => p.userId === userId)] };
}
function watchErrors(pages: Page[]) {
  const errors: string[] = [];
  for (const p of pages) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (msg) => void (msg.type() === "error" && errors.push(msg.text().slice(0, 300))));
  }
  return errors;
}
const boardCards = (page: Page) =>
  page.getByRole("group", { name: "Poker table" }).getByRole("group", { name: "Board" }).locator("[data-card]");

async function twoPlayerGame(phones: Phones, mode = "holdem", opts: { reducedMotion?: boolean } = {}) {
  const t = await table(phones, ["Shlok", "Chris"], opts);
  const [pa, pb] = t.pages;
  const id = await openLobby(pa, "poker", mode);
  await fillLobby(pa, [pb]);
  await expect(pa.getByRole("group", { name: "Poker table" })).toBeVisible();
  await expect(pb.getByRole("group", { name: "Poker table" })).toBeVisible();
  const m = await getMatch(id);
  const [a, b] = t.players;
  const firstIsA = m.players[m.state.turn].userId === a.userId;
  const first = firstIsA ? { player: a, page: pa } : { player: b, page: pb };
  const second = firstIsA ? { player: b, page: pb } : { player: a, page: pa };
  return { id, first, second };
}

test.describe("Poker", () => {
  test("the game card opens the Poker page with its four games", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.goto("/games");
    await page.getByRole("link", { name: "Play Poker" }).click();
    await expect(page).toHaveURL(/\/poker$/);
    await expect(page.getByRole("region", { name: "Async" }).getByRole("link")).toHaveText([
      /Hold'em/,
      /Omaha/,
      /Short Deck/,
      /5-Card Draw/,
    ]);
    await page.getByRole("link", { name: "Omaha" }).click();
    await expect(page.getByRole("heading", { name: "Omaha", level: 1 })).toBeVisible();
    await expect(page.getByText(/exactly two of your four cards/)).toBeVisible();
    await expect(page.getByText(/Pot limit/).first()).toBeVisible();
  });

  test("the table shows everyone's card, who's online, and plays its sounds", async ({ phones }) => {
    const t = await table(phones, ["Shlok", "Chris"], {
      profiles: [
        { frame: "gold", badge: "🦀" },
        { frame: "comet", frameColor: FRAME_COLOR.pink, glow: true, badge: "🃏" },
      ],
    });
    const [pa, pb] = t.pages;
    const a = t.players[0];
    const id = await openLobby(pa, "poker", "holdem");
    await fillLobby(pa, [pb]);
    const seat = (p: Page, name: RegExp) => p.getByRole("group", { name: "Poker table" }).getByRole("group", { name });
    const chris = seat(pa, /^Chris, /);
    await expect(chris.locator('[data-frame="comet"][data-glow="true"]')).toBeVisible();
    await expect(chris.getByText("🃏")).toBeVisible();
    await expect(seat(pa, /^You, /).locator('[data-frame="gold"]')).toBeVisible();
    await expect(seat(pb, /^Shlok, /).locator('[data-frame="gold"]')).toBeVisible();
    await expect(chris.getByRole("img", { name: "Online" })).toBeVisible();
    await expect(seat(pa, /^You, /).getByRole("img", { name: "Online" })).toBeVisible();
    await expect(pa.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2);
    await expect(pb.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2);
    const m = await getMatch(id);
    const [first, second] = m.players[m.state.turn].userId === a.userId ? [pa, pb] : [pb, pa];
    await first.getByRole("button", { name: "Call 10" }).click();
    await second.getByRole("button", { name: "Check", exact: true }).click();
    await expect(boardCards(first)).toHaveCount(3);
    const sounds = await first.evaluate(() => (window as unknown as { __sfx: string[] }).__sfx);
    for (const name of ["deal", "flip", "chips", "knock"]) expect(sounds).toContain(name);
  });

  test("poker's sounds sit at the level of every other sound in their pack", async ({ phones }) => {
    const page = await phones.open({ player: await createPlayer("Shlok"), notifications: "granted" });
    await page.goto("/you");
    const levels = await page.evaluate(async () => {
      type Lab = { packs: string[]; sfx: (p: string, n: string) => Promise<{ peak: number; rms: number }> };
      const lab = (window as unknown as { __soundLab: Lab }).__soundLab;
      const level = async (pack: string, name: string) => {
        const runs = await Promise.all([0, 1, 2, 3].map(() => lab.sfx(pack, name)));
        return { peak: runs.reduce((a, r) => a + r.peak, 0) / runs.length, rms: runs.reduce((a, r) => a + r.rms, 0) / runs.length };
      };
      const out: { pack: string; name: string; peak: number; rms: number; loudest: number; loudestRms: number }[] = [];
      const poker = ["deal", "flip", "chips", "knock", "sweep", "slam", "payout"];
      for (const pack of lab.packs) {
        const [rest, ours] = await Promise.all([
          Promise.all(["pick", "place", "recall", "shuffle", "play", "land", "turn", "win"].map((n) => level(pack, n))),
          Promise.all(poker.map((n) => level(pack, n))),
        ]);
        const loudest = Math.max(...rest.map((r) => r.peak));
        const loudestRms = Math.max(...rest.map((r) => r.rms));
        poker.forEach((name, i) => out.push({ pack, name, ...ours[i], loudest, loudestRms }));
      }
      return out;
    });
    const tooLoud = levels
      .filter((l) => l.peak > l.loudest * 1.1 || l.rms > l.loudestRms)
      .map(
        (l) =>
          `${l.pack} ${l.name}: peak ${l.peak.toFixed(3)} of ${l.loudest.toFixed(3)}, rms ${l.rms.toFixed(3)} of ${l.loudestRms.toFixed(3)}`,
      );
    expect(tooLoud).toEqual([]);
  });

  test("a hand on two phones: calls, a raise, a lined-up check, a shove and a fold", async ({ phones }) => {
    const { id, first, second } = await twoPlayerGame(phones, "holdem", { reducedMotion: true });
    await expect(first.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2);
    await expect(second.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2);
    await expect(first.page.getByText("Hand 1", { exact: true })).toBeVisible();
    await expect(first.page.getByText("Your move")).toBeVisible();

    await first.page.getByRole("button", { name: "Call 10" }).click();
    await expect(second.page.getByText("Your move")).toBeVisible();
    await second.page.getByRole("button", { name: "Raise", exact: true }).click();
    await expect(second.page.getByRole("heading", { name: "Raise to" })).toBeVisible();
    await second.page.getByRole("button", { name: "Min" }).click();
    await second.page.getByRole("button", { name: "Raise to 40" }).click();
    await expect(first.page.getByRole("button", { name: "Call 20" })).toBeVisible();
    await first.page.getByRole("button", { name: "Call 20" }).click();
    await expect(boardCards(first.page)).toHaveCount(3);
    await expect(boardCards(second.page)).toHaveCount(3);

    const checkFold = first.page.getByRole("button", { name: "Check/Fold" });
    await checkFold.click();
    await expect(checkFold).toHaveAttribute("aria-pressed", "true");
    await second.page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(boardCards(second.page)).toHaveCount(4);
    await expect(second.page.getByText("Your move")).toBeVisible();

    await second.page.getByRole("button", { name: "Bet", exact: true }).click();
    await second.page.getByRole("button", { name: "All in", exact: true }).click();
    await second.page.getByRole("button", { name: "All in 960" }).click();
    await expect(first.page.getByRole("button", { name: "All in 960" })).toBeVisible();
    await first.page.getByRole("button", { name: "Fold" }).click();

    await expect(first.page.getByText("Hand 2", { exact: true })).toBeVisible();
    await expect(second.page.getByText("Hand 2", { exact: true })).toBeVisible();
    const m = await getMatch(id);
    expect(m.state.last.hand).toBe(1);
    expect(m.state.stacks.reduce((x: number, y: number) => x + y, 0) + m.state.bets.reduce((x: number, y: number) => x + y, 0)).toBe(2000);
    await second.page.getByRole("button", { name: "Last hand" }).click();
    await expect(second.page.getByRole("heading", { name: "Hand 1" })).toBeVisible();
    await expect(second.page.getByRole("dialog").getByText(/took the pot of 80/)).toBeVisible();
  });

  test("the last hand ends the game with the result on both phones", async ({ phones }) => {
    const { pages, pageOf } = await table(phones, ["Shlok", "Chris"], { reducedMotion: true });
    const [pa, pb] = pages;
    const errors = watchErrors(pages);
    const id = await openLobby(pa, "poker", "holdem", { Hands: "5" });
    await fillLobby(pa, [pb]);
    await expect(pa.getByRole("group", { name: "Poker table" })).toBeVisible();
    for (let hand = 1; hand <= 5; hand++) {
      await expect.poll(async () => (await getMatch(id)).state.hand).toBe(hand);
      const m = await getMatch(id);
      const p = pageOf(m.players[m.state.turn].userId);
      await expect(p.getByText(`Hand ${hand} of 5`)).toBeVisible();
      await p.getByRole("button", { name: "Fold" }).click();
    }
    await expect.poll(async () => (await getMatch(id)).status).toBe("finished");
    for (const p of [pa, pb]) {
      await expect(p.getByRole("region", { name: "Result" })).toBeVisible();
      await expect(p.getByRole("list", { name: "Final standings" })).toBeVisible();
      await expect(p.getByRole("group", { name: "Poker table" })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("an all-in that knocks someone out ends the game with the result on both phones", async ({ phones }) => {
    const { id, first, second } = await twoPlayerGame(phones);
    const errors = watchErrors([first.page, second.page]);
    const pageOf = (userId: string) => (userId === first.player.userId ? first.page : second.page);
    for (let i = 0; i < 10; i++) {
      const m = await getMatch(id);
      if (m.status === "finished") break;
      const p = pageOf(m.players[m.state.turn].userId);
      const owe = m.state.current - m.state.bets[m.state.turn];
      if (owe >= m.state.stacks[m.state.turn]) await p.getByRole("button", { name: /^All in/ }).click();
      else {
        await p.getByRole("button", { name: /^(Raise|Bet)$/ }).click();
        await p.getByRole("button", { name: "All in", exact: true }).click();
        await p.getByRole("button", { name: /^All in \d/ }).click();
      }
      await expect.poll(async () => (await getMatch(id)).moveCount).not.toBe(m.moveCount);
    }
    expect((await getMatch(id)).status).toBe("finished");
    for (const p of [first.page, second.page]) {
      await expect(p.getByRole("region", { name: "Result" })).toBeVisible();
      await expect(p.getByRole("group", { name: "Poker table" })).toBeVisible();
    }
    for (const p of [first.page, second.page]) {
      await expect
        .poll(() => p.evaluate(() => (window as unknown as { __sfx: string[] }).__sfx.filter((n) => n === "win" || n === "lose").length))
        .toBe(1);
      const sounds = await p.evaluate(() => (window as unknown as { __sfx: string[] }).__sfx);
      expect(Math.max(sounds.lastIndexOf("win"), sounds.lastIndexOf("lose"))).toBeGreaterThan(sounds.lastIndexOf("payout"));
    }
    expect(errors).toEqual([]);
  });

  const visibleBacks = (page: Page) =>
    page.locator("[data-seat] [data-back]").evaluateAll(
      (els) =>
        els.filter((el) => {
          for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).opacity === "0") return false;
          return true;
        }).length,
    );

  test("cards leave the table: a fold mid-hand, and everyone's when the game ends", async ({ phones }) => {
    const { pages, pageOf } = await table(phones, ["Shlok", "Chris", "Wes"]);
    const [pa] = pages;
    const id = await openLobby(pa, "poker", "holdem", { Hands: "5" });
    await fillLobby(pa, pages.slice(1));
    for (let hand = 1; hand <= 5; hand++) {
      await expect.poll(async () => (await getMatch(id)).state?.hand).toBe(hand);
      const m = await getMatch(id);
      await pageOf(m.players[m.state.turn].userId).getByRole("button", { name: "Fold" }).click();
      const watcher = pageOf(m.players[(m.state.turn + 2) % 3].userId);
      await expect.poll(() => visibleBacks(watcher)).toBe(2);
      const after = await getMatch(id);
      await pageOf(after.players[after.state.turn].userId).getByRole("button", { name: "Fold" }).click();
    }
    await expect.poll(async () => (await getMatch(id)).status).toBe("finished");
    for (const p of pages) {
      await expect(p.getByRole("region", { name: "Result" })).toBeVisible();
      await expect.poll(() => visibleBacks(p)).toBe(0);
    }
    if (process.env.SCREENS) await pa.screenshot({ path: "e2e/.state/screens/dark-poker-finished.png", fullPage: true });
  });

  test("the dealer holds only this hand's cards in the next hand", async ({ phones }) => {
    const { id, first, second } = await twoPlayerGame(phones);
    await first.page.getByRole("button", { name: /^Raise$/ }).click();
    await first.page.getByRole("button", { name: "Min" }).click();
    await first.page.getByRole("button", { name: /^Raise to/ }).click();
    await second.page.getByRole("button", { name: "Fold" }).click();
    await expect(second.page.getByText("Hand 2", { exact: true })).toBeVisible();
    await expect(second.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(2);
    const name = first.player.name;
    const seat = second.page.getByRole("group", { name: "Poker table" }).getByRole("group", { name: new RegExp(`^${name}, `) });
    await expect(seat.locator("[data-back]")).toHaveCount(2);
    expect((await getMatch(id)).state.hand).toBe(2);
  });

  test("someone knocked out sits at the table with no cards", async ({ phones }) => {
    const { players, pages, pageOf } = await table(phones, ["Shlok", "Chris", "Wes"]);
    const [pa] = pages;
    const id = await openLobby(pa, "poker", "holdem");
    await fillLobby(pa, pages.slice(1));
    await expect.poll(async () => (await getMatch(id)).state?.hand).toBe(1);
    const third = players[2].userId;
    for (let i = 0; i < 40; i++) {
      const m = await getMatch(id);
      if (m.state.out.length) break;
      const userId = m.players[m.state.turn].userId;
      const p = pageOf(userId);
      const owe = m.state.current - m.state.bets[m.state.turn];
      if (userId === third) await p.getByRole("button", { name: owe > 0 ? "Fold" : "Check", exact: true }).click();
      else if (owe >= m.state.stacks[m.state.turn]) await p.getByRole("button", { name: /^All in/ }).click();
      else {
        await p.getByRole("button", { name: /^(Raise|Bet)$/ }).click();
        await p.getByRole("button", { name: "All in", exact: true }).click();
        await p.getByRole("button", { name: /^All in \d/ }).click();
      }
      await expect.poll(async () => (await getMatch(id)).moveCount).not.toBe(m.moveCount);
    }
    const m = await getMatch(id);
    expect(m.state.out.length).toBe(1);
    const bust = m.state.out[0].seat;
    expect(m.state.dealt[bust]).toBe(false);
    const name = players.find((p) => p.userId === m.players[bust].userId)!.name;
    const seat = pageOf(third)
      .getByRole("group", { name: "Poker table" })
      .getByRole("group", { name: new RegExp(`^${name}, `) });
    await expect(seat).toHaveAttribute("data-out", "true");
    await expect(pageOf(third).getByText(`Hand ${m.state.hand}`, { exact: true })).toBeVisible();
    const most = await seat.evaluate(
      (el) =>
        new Promise<number>((done) => {
          let most = 0;
          const t0 = performance.now();
          const frame = () => {
            most = Math.max(most, el.querySelectorAll("[data-back]").length);
            if (performance.now() - t0 > 6000) done(most);
            else requestAnimationFrame(frame);
          };
          frame();
        }),
    );
    expect(most).toBe(0);
  });

  test("Omaha deals four cards and they all fit", async ({ phones }) => {
    const { first } = await twoPlayerGame(phones, "omaha", { reducedMotion: !process.env.SCREENS });
    const cards = first.page.getByRole("group", { name: "Your cards" }).locator("[data-card]");
    await expect(cards).toHaveCount(4);
    for (const box of await Promise.all((await cards.all()).map((c) => c.boundingBox()))) {
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(393);
    }
    if (process.env.SCREENS) await first.page.screenshot({ path: "e2e/.state/screens/dark-poker-omaha.png" });
    await first.page.getByRole("button", { name: "Menu" }).click();
    const settings = first.page.getByRole("dialog").getByRole("region", { name: "Game settings" });
    await expect(settings).toContainText("Chips");
    await expect(settings).toContainText("Pot limit");
    if (process.env.SCREENS) {
      await readyForShot(first.page);
      await first.page.screenshot({ path: "e2e/.state/screens/dark-poker-menu.png" });
    }
  });

  test("five-card draw: pick cards and swap them", async ({ phones }) => {
    const { id, first, second } = await twoPlayerGame(phones, "draw", { reducedMotion: !process.env.SCREENS });
    await expect(first.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(5);
    await first.page.getByRole("button", { name: "Call 10" }).click();
    await second.page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(second.page.getByText("Pick cards to swap")).toBeVisible();
    const before = await second.page
      .getByRole("group", { name: "Your cards" })
      .locator("[data-card]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
    await second.page.getByRole("button", { name: "Swap card 1" }).click();
    await second.page.getByRole("button", { name: "Swap card 2" }).click();
    if (process.env.SCREENS) await second.page.screenshot({ path: "e2e/.state/screens/dark-poker-draw.png" });
    await second.page.getByRole("button", { name: "Swap 2" }).click();
    await expect(first.page.getByText("Pick cards to swap")).toBeVisible();
    await first.page.getByRole("button", { name: "Keep all five" }).click();
    await expect(second.page.getByText("Your move")).toBeVisible();
    const after = await second.page
      .getByRole("group", { name: "Your cards" })
      .locator("[data-card]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(after.slice(0, 2)).not.toEqual(before.slice(0, 2));
    const m = await getMatch(id);
    expect(m.state.drew.filter((d: number | null) => d !== null).sort()).toEqual([0, 2]);
  });

  test("landscape: the table fills the height, my cards beside it, the dock on the side", async ({ phones }) => {
    const sideways = async (page: Page) => {
      await simulateSafeAreas(page, SAFE_LANDSCAPE);
      await rotate(page, "landscape");
      await ready(page);
      await expectFitsScreen(page);
      const felt = (await page.locator("[data-table] .poker-felt").boundingBox())!;
      const table = (await page.getByRole("group", { name: "Poker table" }).boundingBox())!;
      const cards = (await page.getByRole("group", { name: "Your cards" }).boundingBox())!;
      const menu = (await page.getByRole("button", { name: "Menu" }).boundingBox())!;
      expect(table.y + table.height, "the table fits the height").toBeLessThanOrEqual(LANDSCAPE.height - SAFE_LANDSCAPE.bottom);
      expect(cards.x, "my cards sit beside the felt").toBeGreaterThanOrEqual(felt.x + felt.width);
      expect(menu.x, "the menu sits beside the table").toBeGreaterThan(table.x + table.width);
      return { table, menu };
    };
    const { first, second } = await twoPlayerGame(phones, "holdem", { reducedMotion: true });
    const { table } = await sideways(first.page);
    if (process.env.SCREENS) await first.page.screenshot({ path: "e2e/.state/screens/dark-poker-landscape.png" });
    const actions = first.page.getByRole("group", { name: "Actions" });
    for (const name of ["Fold", "Call 10", "Raise"]) {
      const box = (await actions.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.x, `${name} sits beside the table`).toBeGreaterThan(table.x + table.width);
    }
    await expect(first.page.getByText("Hand 1", { exact: true })).toBeVisible();
    await first.page.getByRole("button", { name: "Raise", exact: true }).click();
    await expect(first.page.getByRole("heading", { name: "Raise to" })).toBeVisible();
    await holdsStill(first.page);
    await expectFitsScreen(first.page);
    await first.page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(first.page.getByRole("heading", { name: "Raise to" })).toBeHidden();

    await sideways(second.page);
    await expect(second.page.getByRole("button", { name: "Check/Fold" })).toBeVisible();
    await second.page.getByRole("button", { name: "Check/Fold" }).click();
    await expect(second.page.getByRole("button", { name: "Check/Fold" })).toHaveAttribute("aria-pressed", "true");
    await expectFitsScreen(second.page);
    if (process.env.SCREENS) await second.page.screenshot({ path: "e2e/.state/screens/dark-poker-landscape-waiting.png" });
  });

  test("landscape: five-card draw fits all five cards and the swap", async ({ phones }) => {
    const { first, second } = await twoPlayerGame(phones, "draw", { reducedMotion: true });
    await first.page.getByRole("button", { name: "Call 10" }).click();
    await second.page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(second.page.getByText("Pick cards to swap")).toBeVisible();
    await simulateSafeAreas(second.page, SAFE_LANDSCAPE);
    await rotate(second.page, "landscape");
    await ready(second.page);
    await expect(second.page.getByRole("group", { name: "Your cards" }).locator("[data-card]")).toHaveCount(5);
    await second.page.getByRole("button", { name: "Swap card 1" }).click();
    await expect(second.page.getByRole("button", { name: "Swap 1" })).toBeVisible();
    await holdsStill(second.page);
    await expectFitsScreen(second.page);
    if (process.env.SCREENS) await second.page.screenshot({ path: "e2e/.state/screens/dark-poker-landscape-draw.png" });
  });
});
