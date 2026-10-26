// Visual review of Scrabble: SCREENS=1 npm run test:e2e -- scrabble-screens. Writes PNGs to e2e/.state/screens.
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, phone, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

for (const scheme of ["dark", "light"] as const) {
  test(`scrabble screens ${scheme}`, async ({ browser }) => {
    const names = ["WashableBowl700", "chrisis14", "Boiler", "Wes"];
    const players = await Promise.all(names.map((n) => createPlayer(n)));
    const ctxs = await Promise.all(players.map(() => browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme })));
    const pages = await Promise.all(players.map((p, i) => phone(ctxs[i], { player: p, notifications: "granted" })));
    for (const p of pages) {
      await p.goto("/");
      await p.getByRole("button", { name: "Turn on notifications" }).click();
    }
    const [a] = pages;
    const shot = async (name: string, page = a, full = false) => {
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-scrabble-${name}.png`, fullPage: full, animations: "allow" });
    };
    await a.goto("/games");
    await shot("games");
    await a.goto("/scrabble");
    await shot("hub");
    await a.goto("/scrabble/mode/classic");
    await a.getByRole("button", { name: "Settings" }).click();
    await shot("mode", a, true);
    await a.getByRole("button", { name: "Open a game" }).click();
    await expect(a.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
    const id = a.url().split("/scrabble/")[1];
    for (const p of pages.slice(1)) await p.goto(`/scrabble/${id}?accept=1`);
    await expect(a.getByRole("heading", { name: "4 in" })).toBeVisible();
    await shot("lobby");
    await shot("lobby-guest", pages[1]);
    await a.getByRole("button", { name: "Start with 4" }).click();
    await expect(a.getByRole("group", { name: "Board" })).toBeVisible();

    // Play a few words so the board has something on it.
    const m = await admin().query(anyApi.testing.getMatch, { id });
    const pageOf = (seat: number) => pages[players.findIndex((p) => p.userId === m.players[seat].userId)];
    const words: [string, number, number, boolean][] = [["QUIZ", 6, 7, false], ["ZONE", 9, 7, true], ["OX", 9, 8, false], ["TEN", 7, 9, false]];
    for (const [seat, [word, x, y, down]] of words.entries()) {
      const id2 = id;
      await admin().mutation(anyApi.testing.setRack, { id: id2, userId: m.players[seat].userId, letters: word.padEnd(7, "E") });
      const page = pageOf(seat);
      const rack = await admin().query(anyApi.testing.rackOf, { id, userId: m.players[seat].userId });
      const board = (await admin().query(anyApi.testing.getMatch, { id })).state.tiles as { x: number; y: number }[];
      const tiles = [...word]
        .map((_, i) => ({ x: down ? x : x + i, y: down ? y + i : y }))
        .map((c, i) => ({ ...c, letter: word[i] }))
        .filter((c) => !board.some((t) => t.x === c.x && t.y === c.y));
      const used = new Set<number>();
      const placement = tiles.map((c) => {
        const t = rack.find((r: { id: number; letter: string }) => r.letter === c.letter && !used.has(r.id));
        used.add(t.id);
        return { id: t.id, x: c.x, y: c.y };
      });
      await admin().mutation(anyApi.testing.playAs, { id, userId: m.players[seat].userId, tiles: placement });
      void page;
    }
    // The next player lays out a plan.
    const next = pageOf(0);
    await admin().mutation(anyApi.testing.setRack, { id, userId: m.players[0].userId, letters: "RAINBOW" });
    await next.reload();
    await expect(next.getByText("Your turn")).toBeVisible();
    await shot("game", next);
    for (const [l, x, y] of [["B", 8, 6]] as const) {
      await next.getByRole("button", { name: `Tile ${l}` }).first().click();
      const pt = await next.getByRole("group", { name: "Board" }).evaluate(
        (el, [x, y]) => {
          const layer = el.firstElementChild as HTMLElement;
          const mm = new DOMMatrix(getComputedStyle(layer).transform);
          const base = layer.offsetWidth / 15;
          const r = el.getBoundingClientRect();
          return { x: r.left + mm.e + (x + 0.5) * base * mm.a, y: r.top + mm.f + (y + 0.5) * base * mm.d };
        },
        [x, y] as const,
      );
      await next.mouse.click(pt.x, pt.y);
    }
    await shot("planning", next);
    await next.getByRole("button", { name: "Menu" }).click();
    await shot("menu", next);
    await next.keyboard.press("Escape");
    await next.getByRole("button", { name: /^Bag/ }).click();
    await shot("bag", next);
    await next.keyboard.press("Escape");
    await shot("watching-turn", pageOf(1));
    for (const c of ctxs) await c.close();
  });
}
