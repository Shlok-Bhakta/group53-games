import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, fillLobby, getMatch, matchIdOf, openLobby, test, type Phones } from "./fixtures";

const setRack = (id: string, userId: string, letters: string) => admin().mutation(anyApi.testing.setRack, { id, userId, letters });

// Taps a rack tile, then a square. Squares are found by where they are on the board.
async function place(page: Page, letter: string, x: number, y: number) {
  await page.getByRole("button", { name: letter === "?" ? "Blank tile" : `Tile ${letter}` }).first().click();
  await tapSquare(page, x, y);
}
async function tapSquare(page: Page, x: number, y: number) {
  const board = page.getByRole("group", { name: "Board" });
  const box = (await board.boundingBox())!;
  // Find the square on screen from a known tile-free square size: the layer is scaled, so ask the page.
  const pt = await board.evaluate(
    (el, [x, y, size]) => {
      const layer = el.firstElementChild as HTMLElement;
      const m = new DOMMatrix(getComputedStyle(layer).transform);
      const base = layer.offsetWidth / size;
      return { x: m.e + (x + 0.5) * base * m.a, y: m.f + (y + 0.5) * base * m.d };
    },
    [x, y, 15] as const,
  );
  await page.mouse.click(box.x + pt.x, box.y + pt.y);
}

const sounds = (page: Page) => page.evaluate(() => (window as unknown as { __sfx: string[] }).__sfx);

// Two phones with push on.
async function twoPhones(phones: Phones) {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const [pa, pb] = await Promise.all([phones.open({ player: a, push: "on" }), phones.open({ player: b, push: "on" })]);
  return { a, b, pa, pb };
}

// Two phones in a started classic game. Returns them in seat order.
async function twoPlayerGame(phones: Phones, mode = "classic") {
  const { a, b, pa, pb } = await twoPhones(phones);
  const id = await openLobby(pa, "scrabble", mode);
  await fillLobby(pa, [pb]);
  await expect(pa.getByRole("group", { name: "Board" })).toBeVisible();
  await expect(pb.getByRole("group", { name: "Board" })).toBeVisible();
  const m = await getMatch(id);
  const first = m.players[0].userId === a.userId ? { player: a, page: pa } : { player: b, page: pb };
  const second = first.player === a ? { player: b, page: pb } : { player: a, page: pa };
  return { id, first, second };
}

test.describe("Scrabble", () => {
  test("the game card opens the Scrabble page with its two modes", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.goto("/games");
    await page.getByRole("link", { name: "Play Scrabble" }).click();
    await expect(page).toHaveURL(/\/scrabble$/);
    await expect(page.getByRole("region", { name: "Async" }).getByRole("link")).toHaveText([/2–8/]);
    await expect(page.getByRole("region", { name: "Real-time" }).getByRole("link")).toHaveText([/2–8/]);
    await page.getByRole("region", { name: "Real-time" }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Live", level: 1 })).toBeVisible();
    await expect(page.getByText("Each turn has a 90-second timer.")).toBeVisible();
    // Settings change the rules as you pick them.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radiogroup", { name: "Turn timer" }).getByRole("radio", { name: "30s" }).click();
    await expect(page.getByText("Each turn has a 30-second timer.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toContainText("30s turns");
    await page.getByRole("button", { name: "Open a game" }).click();
    await expect(page.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Needs 2 to start" })).toBeDisabled();
    expect((await getMatch(matchIdOf(page))).settings).toEqual({ turnTime: 30 });
  });

  test("the host's setting changes show up live in everyone's lobby", async ({ phones }) => {
    const { pa, pb } = await twoPhones(phones);
    const id = await openLobby(pa, "scrabble", "classic");
    await pb.goto(`/scrabble/${id}?accept=1`);
    await expect(pb.getByRole("heading", { name: "Waiting for Shlok to start" })).toBeVisible();
    await pa.getByRole("button", { name: "Settings" }).click();
    await pa.getByRole("radiogroup", { name: "Board" }).getByRole("radio", { name: "21×21" }).click();
    await pa.getByRole("radiogroup", { name: "Rules" }).getByRole("radio", { name: "Letter League" }).click();
    await expect(pb.getByRole("list", { name: "Settings" })).toHaveText(/21×21 board.*Letter League rules/);
    await pa.getByRole("button", { name: "Start with 2" }).click();
    await expect(pb.getByRole("group", { name: "Board" })).toBeVisible();
    expect((await getMatch(id)).state.size).toBe(21);
  });

  test("two phones play words, plans survive a reload, and the other phone sees it all live", async ({ phones }) => {
    const { id, first, second } = await twoPlayerGame(phones);
    await setRack(id, first.player.userId, "CATSDOG");
    await setRack(id, second.player.userId, "ZORPHIE");
    const p1 = first.page;
    const p2 = second.page;
    await expect(p1.getByText("Your turn")).toBeVisible();
    await expect(p2.getByText(/is on it|Waiting for/)).toBeVisible();

    // Lay out CAT through the centre: the button names the word and the score before you commit.
    await place(p1, "C", 6, 7);
    await place(p1, "A", 7, 7);
    await place(p1, "T", 8, 7);
    await expect(p1.getByRole("button", { name: "Play CAT for 10" })).toBeEnabled();
    expect(await sounds(p1)).toEqual(expect.arrayContaining(["pick", "place"]));
    // The game screen has music on, once you've touched it.
    await expect.poll(() => p1.evaluate(() => (window as unknown as { __music?: string }).__music)).toBe("53_1");
    // The other phone sees face-down tiles where they're trying things, never the letters.
    await expect(p2.locator("[data-ghost]")).toHaveCount(3);
    await expect(p2.locator('[data-ghost="7,7"]')).toBeVisible();
    expect((await p2.locator("[data-ghost]").allTextContents()).join("")).toBe("");
    await p1.reload();
    await expect(p1.getByRole("button", { name: "Play CAT for 10" })).toBeEnabled();
    await p1.getByRole("button", { name: "Play CAT for 10" }).click();
    await expect.poll(() => sounds(p1)).toContain("play");

    // It lands on the other phone, scores, and passes the turn.
    await expect(p2.locator('[data-cell="7,7"]')).toHaveAttribute("data-letter", "A");
    await expect(p2.locator("[data-ghost]")).toHaveCount(0);
    await expect.poll(() => sounds(p2)).toEqual(expect.arrayContaining(["land", "turn"]));
    await expect(p2.getByText("Your turn")).toBeVisible();
    await p2.getByRole("button", { name: "Menu" }).click();
    await expect(p2.getByRole("list", { name: "Scores" }).getByLabel("10 points")).toBeVisible();
    await p2.keyboard.press("Escape");
    await expect(p1.getByLabel("Your tiles").getByRole("button")).toHaveCount(7);

    // Made-up words can't be played.
    await place(p2, "Z", 7, 8);
    await place(p2, "R", 7, 9);
    await expect(p2.getByRole("button", { name: "AZR isn't a word" })).toBeDisabled();
    await p2.getByRole("button", { name: "Recall tiles" }).click();
    // Tapping a placed tile sends it home too.
    await place(p2, "H", 7, 6);
    await tapSquare(p2, 7, 6);
    await expect(p2.getByRole("button", { name: "Tile H" })).toBeVisible();

    // Meanwhile the first player plans their next word out of turn, and it waits for them.
    await place(p1, "S", 9, 7);
    await expect(p1.getByRole("button", { name: "Planned: CATS, 6" })).toBeDisabled();
  });

  test("a game link opened in Discord's browser sends the game to your phone", async ({ phones }) => {
    // Chris has push on; Sam never turned it on.
    const { pa } = await twoPhones(phones);
    await createPlayer("Sam");
    const id = await openLobby(pa, "scrabble", "classic");

    // Someone opens the shared link in a browser: not the app, and not signed in.
    const link = await phones.open({
      installed: false,
      context: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Discord/250.0" },
    });
    await link.goto(`/scrabble/${id}?accept=1`);
    await expect(link.getByRole("heading", { name: "Shlok wants Scrabble" })).toBeVisible();
    await link.getByRole("button", { name: "I'm Chris" }).click();
    await expect(link.getByRole("status")).toHaveText("Sent to your phone. Tap the notification to jump in.");
    if (process.env.SCREENS) await link.screenshot({ path: "e2e/.state/screens/scrabble-link.png", fullPage: true });
    // Sam never turned notifications on, so he's told how to get there instead.
    await link.getByRole("button", { name: "I'm Sam" }).click();
    await expect(link.getByRole("status")).toContainText("Your notifications are off");
    // The install steps are still there for anyone new.
    await expect(link.getByRole("heading", { name: /New here/ })).toBeVisible();
  });

  test("the board fills the screen; the dock has the bag, Swap, Play and Shuffle, and the menu has scores, words and Resign", async ({ phones }) => {
    const { id, first, second } = await twoPlayerGame(phones);
    const p = first.page;
    const board = (await p.getByRole("group", { name: "Board" }).boundingBox())!;
    expect(board.width).toBeGreaterThanOrEqual(390);
    expect(board.height).toBeGreaterThan(500);
    const dock = p.getByLabel("Your tiles").locator("..");
    await expect(dock.getByRole("button", { name: /^Bag, \d+ left$/ })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Swap or pass" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Shuffle tiles" })).toBeVisible();
    // Resign lives in the menu now, far from Shuffle.
    await expect(p.getByRole("button", { name: "Resign" })).toHaveCount(0);

    // The bag shows what's left.
    await p.getByRole("button", { name: /^Bag/ }).click();
    await expect(p.getByRole("heading", { name: "86 in the bag" })).toBeVisible();
    await expect(p.getByRole("list", { name: "Unseen letters" }).getByRole("listitem")).toHaveCount(27);
    await p.keyboard.press("Escape");

    // Swap with nothing picked passes the turn.
    await p.getByRole("button", { name: "Swap or pass" }).click();
    await p.getByRole("button", { name: "Pass turn" }).click();
    await expect(second.page.getByText("Your turn")).toBeVisible();

    await setRack(id, second.player.userId, "CATSXYZ");
    await place(second.page, "C", 6, 7);
    await place(second.page, "A", 7, 7);
    await place(second.page, "T", 8, 7);
    await second.page.getByRole("button", { name: "Play CAT for 10" }).click();

    // The menu: everyone's score, who's up, the words played, and Resign.
    await p.getByRole("button", { name: "Menu" }).click();
    const menu = p.getByRole("dialog");
    await expect(menu.getByRole("list", { name: "Scores" }).getByRole("listitem")).toHaveCount(2);
    await expect(menu.getByRole("list", { name: "Scores" }).locator('[aria-current="true"]')).toContainText("Your turn");
    await expect(menu.getByRole("region", { name: "Words played" }).getByRole("button", { name: "CAT" })).toBeVisible();
    await expect(menu.getByRole("region", { name: "Game settings" })).toContainText("Tiles in hand");
    await expect(menu.getByRole("button", { name: "Resign" })).toBeVisible();
  });

  test("sound settings: pick music and an effects pack, and they stick", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, notifications: "granted" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/you");
    const musicRow = page.getByRole("button", { name: /^Music/ });
    const sfxRow = page.getByRole("button", { name: /^Sound effects/ });
    await expect(musicRow).toContainText("53_1");
    await expect(sfxRow).toContainText("Wood");
    // On by default, so the game makes noise with the ringer off.
    await expect(page.getByRole("switch", { name: "Play on silent" })).toBeChecked();
    // Music plays everywhere, not just in games, once you've tapped; picking a track switches to it.
    await musicRow.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __music?: string }).__music)).toBe("53_1");
    // Alex's track first, the generated ones in their own section.
    await expect(page.getByRole("dialog").getByRole("radiogroup", { name: "Made by a human" }).getByRole("radio")).toHaveText([/53_1.*By Alex/]);
    await page.getByRole("dialog").getByRole("radiogroup", { name: "AI slop" }).getByRole("radio", { name: /Late night/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __music?: string }).__music)).toBe("nightcap");
    await page.keyboard.press("Escape");
    await sfxRow.click();
    await page.getByRole("dialog").getByRole("radio", { name: /Thock/ }).click();
    expect(await sounds(page)).toContain("preview");
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("button", { name: /^Music/ })).toContainText("Late night");
    await expect(page.getByRole("button", { name: /^Sound effects/ })).toContainText("Thock");
    await page.getByRole("switch", { name: "Play on silent" }).click();
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sound")))!)).toMatchObject({ music: "nightcap", sfx: "keys", onSilent: false });
    expect(errors).toEqual([]);
  });

  test("phones that saved Lo-fi move to 53_1 once, and music that was off stays off", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, notifications: "granted" });
    await page.goto("/you");
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("sound")!));
    await page.evaluate(() => localStorage.setItem("sound", JSON.stringify({ sfx: "keys", music: "lofi", lastMusic: "lofi", onSilent: true })));
    await page.reload();
    await expect(page.getByRole("button", { name: /^Music/ })).toContainText("53_1");
    await expect(page.getByRole("button", { name: /^Sound effects/ })).toContainText("Thock");
    // Picking Lo-fi again after that sticks.
    await page.getByRole("button", { name: /^Music/ }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /Lo-fi/ }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: /^Music/ })).toContainText("Lo-fi");
    expect(await stored()).toMatchObject({ music: "lofi", tune: 2 });
    await page.evaluate(() => localStorage.setItem("sound", JSON.stringify({ sfx: "wood", music: "off", lastMusic: "lofi", onSilent: true })));
    await page.reload();
    await expect(page.getByRole("button", { name: /^Music/ })).toContainText("Off");
  });

  test("53_1 decodes to its exact length and loops sample for sample, a little under Lo-fi's level", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/you");
    type Lab = { loop: (id: string) => Promise<{ length: number; loopStart: number; loopEnd: number; seconds: number; seam: number; nearby: number }>; music: (t: string, s: number) => Promise<{ peak: number; rms: number }> };
    const { loop, song, lofi } = await page.evaluate(async () => {
      const lab = (window as unknown as { __soundLab: Lab }).__soundLab;
      return { loop: await lab.loop("53_1"), song: await lab.music("53_1", 20), lofi: await lab.music("lofi", 20) };
    });
    // The loop is the whole track as bounced, the encoder delay trimmed, and past its end the file carries
    // on with the track's start, so the seam lines up sample for sample.
    expect(loop.loopStart).toBe(2048 / 44100);
    expect(loop.length).toBeGreaterThan(Math.round(loop.loopEnd * 44100) + 1024);
    expect(loop.seam).toBeLessThan(0.01);
    expect(loop.seam).toBeLessThan(loop.nearby);
    expect(song.peak).toBeGreaterThan(0.01);
    expect(song.peak).toBeLessThan(0.99);
    expect(song.rms).toBeLessThanOrEqual(lofi.rms * 1.1);
  });

  test("sound survives leaving the app and coming straight back", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, notifications: "granted" });
    await page.goto("/you");
    await page.getByRole("heading", { name: "You" }).click();
    type Audio = { state: () => string; rebuilds: () => number; break: () => void };
    const audio = () => page.evaluate(() => (window as unknown as { __audio: Audio }).__audio.state());
    const music = () => page.evaluate(() => (window as unknown as { __music?: string }).__music);
    await expect.poll(audio).toBe("running");
    await expect.poll(music).toBe("53_1");
    // Away and back again before the pause has even finished.
    const visible = (shown: boolean) =>
      page.evaluate((shown) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => !shown });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (shown ? "visible" : "hidden") });
        document.dispatchEvent(new Event("visibilitychange"));
      }, shown);
    await visible(false);
    await visible(true);
    await expect.poll(audio).toBe("running");
    await visible(false);
    await expect.poll(audio).toBe("suspended");
    await visible(true);
    await expect.poll(audio).toBe("running");
    expect(await music()).toBe("53_1");
    // A context iOS has left dead is replaced on the next tap, and the music comes back on the new one.
    await page.evaluate(() => (window as unknown as { __audio: Audio }).__audio.break());
    await page.getByRole("heading", { name: "You" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __audio: Audio }).__audio.rebuilds())).toBe(1);
    await expect.poll(audio).toBe("running");
    await expect.poll(music).toBe("53_1");
  });

  test("every effects pack and music track makes sound, and none of it clips", async ({ phones }) => {
    test.setTimeout(240_000);
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/you");
    const report = await page.evaluate(async () => {
      type Lab = { packs: string[]; tracks: string[]; sfx: (p: string, n: string) => Promise<{ peak: number; rms: number }>; music: (t: string, s: number) => Promise<{ peak: number; rms: number }> };
      const lab = (window as unknown as { __soundLab: Lab }).__soundLab;
      const names = ["pick", "place", "recall", "shuffle", "play", "bingo", "invalid", "turn", "ghost", "land", "tick", "win", "lose", "preview", "deal", "flip", "chips", "knock", "sweep", "slam", "payout"];
      const out: Record<string, { peak: number; rms: number }> = {};
      // Offline renders run side by side: a pack's sounds at once, then every track at once (ten seconds
      // of each, the same as before, just not one after another).
      for (const p of lab.packs) (await Promise.all(names.map((n) => lab.sfx(p, n)))).forEach((r, i) => (out[`sfx ${p} ${names[i]}`] = r));
      (await Promise.all(lab.tracks.map((t) => lab.music(t, 10)))).forEach((r, i) => (out[`music ${lab.tracks[i]}`] = r));
      return out;
    });
    expect(Object.keys(report).length).toBeGreaterThan(100);
    const silent = Object.entries(report).filter(([k, r]) => r.peak < (k.includes("ghost") ? 0.002 : 0.01)).map(([k]) => k);
    const clipping = Object.entries(report).filter(([, r]) => r.peak >= 0.99).map(([k]) => k);
    expect(silent).toEqual([]);
    expect(clipping).toEqual([]);
    // Music sits under the game: there, but never loud.
    for (const [k, r] of Object.entries(report)) if (k.startsWith("music")) expect(r.rms, k).toBeLessThan(0.2);
  });

  test("tiles drag from the rack onto the board and back", async ({ phones }) => {
    const { id, first } = await twoPlayerGame(phones);
    await setRack(id, first.player.userId, "HIXYZQJ");
    const p = first.page;
    const tile = p.getByRole("button", { name: "Tile H" });
    await expect(tile).toBeVisible();
    const from = (await tile.boundingBox())!;
    const board = (await p.getByRole("group", { name: "Board" }).boundingBox())!;
    const target = await p.getByRole("group", { name: "Board" }).evaluate((el) => {
      const layer = el.firstElementChild as HTMLElement;
      const m = new DOMMatrix(getComputedStyle(layer).transform);
      const base = layer.offsetWidth / 15;
      return { x: m.e + 7.5 * base * m.a, y: m.f + 7.5 * base * m.d };
    });
    await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await p.mouse.down();
    // The tile sits right under the finger, so it lands where the finger lets go.
    for (let i = 1; i <= 8; i++) await p.mouse.move(from.x + ((board.x + target.x - from.x) * i) / 8, from.y + ((board.y + target.y - from.y) * i) / 8);
    await p.mouse.up();
    await expect(p.locator('[data-draft][data-cell="7,7"]')).toHaveAttribute("data-letter", "H");
    await place(p, "I", 8, 7);
    await expect(p.getByRole("button", { name: "Play HI for 10" })).toBeEnabled();
  });

  test("live games show the turn clock and skip you when it runs out", async ({ phones }) => {
    const { id, first, second } = await twoPlayerGame(phones, "live");
    await expect(first.page.getByLabel(/seconds left/)).toBeVisible();
    await expect(second.page.getByLabel(/seconds left/)).toBeVisible();
    await expect(first.page.getByText("Your turn")).toBeVisible();
    // Run the timer out now: the turn is skipped and both phones move on.
    await admin().mutation(anyApi.scrabble.turnTimeout, { id, moveCount: 0 });
    await expect(second.page.getByText("Your turn")).toBeVisible();
    await expect(first.page.getByText(/ran out of time/)).toBeVisible();
  });
});
