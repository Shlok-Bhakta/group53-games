import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import {
  admin,
  createPlayer,
  expect,
  getMatch,
  holdsStill,
  matchIdOf,
  onScreen,
  ready,
  realtimePair,
  resign,
  settled,
  test,
  type Phones,
} from "./fixtures";
import { LANDSCAPE, SAFE_LANDSCAPE, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

const rtCommands = (id: string) => admin().query(anyApi.testing.rtCommands, { id });

async function tapMove(page: Page, from: string, to: string) {
  await page.locator(`[data-square=${from}]`).click();
  await page.locator(`[data-square=${to}]`).click();
}

async function classicMove(page: Page, from: string, to: string) {
  await expect(
    onScreen(page).locator("span:not(a *)", { hasText: /^Your move$/ }),
    "the chip under the board, not one on a game in a list sliding out behind it",
  ).toBeVisible();
  await tapMove(page, from, to);
  await page.getByRole("button", { name: /^Confirm/ }).click();
}

function piecesOn(page: Page, piece: string, square: string) {
  return page.evaluate(
    ([piece, square]) => {
      const sq = document.querySelector(`[data-square="${square}"]`)!.getBoundingClientRect();
      return [...document.querySelectorAll(`[data-piece="${piece}"]`)]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return Math.abs(b.x - sq.x) < 2 && Math.abs(b.y - sq.y) < 2;
        })
        .map((el) => el.getAttribute("data-status") ?? "here");
    },
    [piece, square] as const,
  );
}
const pieceOn = async (page: Page, piece: string, square: string) => (await piecesOn(page, piece, square)).length > 0;
const restsOn = async (page: Page, piece: string, square: string) => (await piecesOn(page, piece, square)).some((s) => s !== "moving");
const readyOn = async (page: Page, piece: string, square: string) => (await piecesOn(page, piece, square)).includes("ready");

async function startClassic(phones: Phones) {
  const [shlok, chris] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const [a, b] = await Promise.all([phones.open({ player: shlok, push: "on" }), phones.open({ player: chris, push: "on" })]);

  await a.goto("/chess/mode/classic");
  await a.getByRole("button", { name: "Find a game" }).click();
  await expect(a.getByRole("heading", { name: "Looking for an opponent" })).toBeVisible();
  const id = matchIdOf(a);

  await b.goto("/chess/mode/classic");
  await expect(b.getByRole("region", { name: "Open seats" })).toContainText("Shlok");
  await b.getByRole("button", { name: "Join a game" }).click();
  await expect(b.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
  await expect(a.getByRole("grid", { name: "Classic chess board" })).toBeVisible();

  const m = await getMatch(id);
  const aWhite = m.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId;
  const [white, black] = aWhite ? [a, b] : [b, a];
  const [whitePlayer, blackPlayer] = aWhite ? [shlok, chris] : [chris, shlok];
  return { id, white, black, whitePlayer, blackPlayer };
}

test.describe("chess", () => {
  test("game links stay locked until notifications are on", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const id = await admin().action(anyApi.testing.startMatch, { mode: "chess:classic", a: me.userId, b: chris.userId });
    const page = await phones.open({ player: me });
    await page.goto(`/chess/${id}`);
    await expect(page.getByText("Turn on notifications to play")).toBeVisible();
    await expect(page.getByRole("grid")).toHaveCount(0);
  });

  test("classic: find a game, play moves live on both phones, resign, and see the leaderboard", async ({ phones }) => {
    const g = await startClassic(phones);

    await g.white.locator("[data-square=e2]").click();
    await expect(g.white.locator("[data-target]"), "picking up a piece shows where it can go").toHaveCount(2);
    await expect(g.black.getByRole("grid")).toHaveAttribute("data-disabled", "true");
    await g.black.locator("[data-square=e7]").click();
    await expect(g.black.locator("[data-target]"), "only for whoever's move it is").toHaveCount(0);

    const grid = g.white.getByRole("grid");
    await tapMove(g.white, "e2", "e3");
    await expect(g.white.getByRole("button", { name: /^Confirm/ })).toBeVisible();
    await expect.poll(() => pieceOn(g.white, "wP", "e3")).toBe(true);
    const boardYOnPage = () => grid.evaluate((el) => el.getBoundingClientRect().y + window.scrollY);
    let pendingY = NaN;
    await expect
      .poll(
        async () => {
          const y = await boardYOnPage();
          const steady = Math.abs(y - pendingY) < 0.5;
          pendingY = y;
          return steady;
        },
        { intervals: [250], message: "the board holds still" },
      )
      .toBe(true);
    expect((await getMatch(g.id)).state.moves, "the move waits on this phone only").toHaveLength(0);
    await expect.poll(() => pieceOn(g.black, "wP", "e2")).toBe(true);
    await expect(g.black.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
    await g.white.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => pieceOn(g.white, "wP", "e2")).toBe(true);
    expect(await boardYOnPage(), "swapping the dock for Confirm doesn't shift the board").toBeCloseTo(pendingY, 0);
    const confirm = g.white.getByRole("button", { name: /^Confirm/ });
    await tapMove(g.white, "e2", "e3");
    await expect(g.white.locator("[data-ghost]"), "a waiting move leaves a faint copy at home").toHaveCount(1);
    await tapMove(g.white, "e3", "e2");
    await expect(confirm, "moving the piece back home takes the move back").toHaveCount(0);
    await expect(g.white.locator("[data-ghost]")).toHaveCount(0);
    await tapMove(g.white, "d2", "d4");
    await expect(confirm, "moving another piece replaces it, with no Cancel needed").toContainText("d4");
    await tapMove(g.white, "e2", "e4");
    await expect(confirm).toContainText("e4");
    await expect.poll(() => pieceOn(g.white, "wP", "d2")).toBe(true);
    await confirm.click();
    await expect(g.black.getByLabel("Moves")).toContainText("e4");
    expect((await getMatch(g.id)).state.moves.map((m: { san: string }) => m.san)).toEqual(["e4"]);
    await expect(g.white.getByLabel("Moves")).toContainText("e4");

    await classicMove(g.black, "e7", "e5");
    await expect(g.white.getByLabel("Moves")).toContainText("e5");

    const from = await g.white.locator("[data-square=g1]").boundingBox();
    const to = await g.white.locator("[data-square=f3]").boundingBox();
    await g.white.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await g.white.mouse.down();
    await g.white.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
    await g.white.mouse.up();
    await expect(g.white.getByRole("button", { name: /^Confirm/ })).toContainText("Nf3");
    await expect.poll(() => pieceOn(g.white, "wN", "f3")).toBe(true);
    expect((await getMatch(g.id)).state.moves).toHaveLength(2);
    await expect.poll(() => pieceOn(g.black, "wN", "g1")).toBe(true);
    await g.white.getByRole("button", { name: /^Confirm/ }).click();
    await expect(g.black.getByLabel("Moves")).toContainText("Nf3");

    const stored = await getMatch(g.id);
    expect(stored.state.moves.map((m: { san: string }) => m.san)).toEqual(["e4", "e5", "Nf3"]);

    await tapMove(g.black, "b8", "c6");
    await expect(g.black.getByRole("button", { name: /^Confirm/ })).toBeVisible();
    await resign(g.white);
    await expect(g.white.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(g.black.getByRole("heading", { name: "You won" })).toBeVisible();
    await expect(g.black.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
    await expect(g.black.getByText("1216", { exact: true })).toBeVisible();

    await g.black.goto("/chess/mode/classic");
    const board = g.black.getByRole("list", { name: "Classic leaderboard" });
    await expect(board.getByRole("listitem").first()).toContainText("You");
    await expect(board.getByRole("listitem").first()).toContainText("1216");
    await expect(board).toContainText("1184");

    await g.black.goto("/crew");
    const ratings = g.black.getByRole("region", { name: "Ratings" });
    await expect(ratings.getByRole("link", { name: /Chess Classic/ })).toContainText("You lead");
    await expect(ratings).toContainText("1216");
    await g.black.getByRole("button", { name: new RegExp(g.whitePlayer.name) }).click();
    const sheet = g.black.getByRole("dialog");
    await expect(sheet).toContainText("Chess Classic");
    await expect(sheet).toContainText("0 won, 1 lost");
    await expect(sheet).toContainText("1184");
  });

  test("a game opened from a push goes back to Home, and back again from there leaves nothing stuck", async ({ phones }) => {
    const g = await startClassic(phones);
    const cold = await g.white.context().newPage();
    await cold.goto(`/chess/${g.id}`);
    await classicMove(cold, "e2", "e4");
    await expect.poll(async () => (await getMatch(g.id)).state.fen).toContain(" b ");
    await cold.getByRole("button", { name: "Back" }).click();
    await expect(cold).toHaveURL(/\/$/);
    await expect(cold.getByRole("heading", { name: "Home" })).toBeVisible();

    await cold.goto("/chess/mode/classic");
    await cold.locator(`a[href="/chess/${g.id}"]`).first().click();
    await expect(cold).toHaveURL(new RegExp(`/chess/${g.id}`));
    await expect(cold.getByRole("button", { name: "Back" })).toHaveCount(1);
    await cold.getByRole("button", { name: "Back" }).click();
    await expect(cold, "opened from inside the app, Back still goes where you came from").toHaveURL(/\/chess\/mode\/classic$/);
  });

  test("classic: step back through the moves, stay put as a move lands, and tap the board to come back", async ({ phones }) => {
    const g = await startClassic(phones);
    await classicMove(g.white, "e2", "e4");
    await classicMove(g.black, "e7", "e5");
    await classicMove(g.white, "g1", "f3");
    const p = g.white;
    await expect(g.black.getByLabel("Moves")).toContainText("Nf3");
    const back = p.getByRole("button", { name: "Previous move" });
    const next = p.getByRole("button", { name: "Next move" });
    const current = p.getByLabel("Moves").locator("[aria-current=step]");
    await expect(next).toBeDisabled();
    await expect(current).toHaveText("Nf3");

    await back.click();
    await expect(current).toHaveText("e5");
    await expect.poll(() => pieceOn(p, "wN", "g1")).toBe(true);
    await back.click();
    await back.click();
    await expect(back).toBeDisabled();
    await expect(current).toHaveCount(0);
    await expect.poll(() => pieceOn(p, "wP", "e2")).toBe(true);
    await p.getByLabel("Moves").getByRole("button", { name: "e4" }).click();
    await expect(current).toHaveText("e4");
    await expect.poll(() => pieceOn(p, "bP", "e7")).toBe(true);

    await classicMove(g.black, "b8", "c6");
    await expect(p.getByLabel("Moves")).toContainText("Nc6");
    await expect(current, "a move landing doesn't pull the board away from someone looking back").toHaveText("e4");
    await expect.poll(() => pieceOn(p, "bN", "b8")).toBe(true);
    await next.click();
    await expect(current).toHaveText("e5");
    await expect.poll(() => pieceOn(p, "bP", "e5")).toBe(true);

    await p.getByRole("button", { name: "Back to the current position" }).click();
    await expect(current, "tapping the board goes back to now").toHaveText("Nc6");
    await expect(next).toBeDisabled();
    await expect.poll(() => pieceOn(p, "bN", "c6")).toBe(true);
    await classicMove(p, "f1", "c4");
    await expect(g.black.getByLabel("Moves")).toContainText("Bc4");
  });

  test("classic: checkmate ends the game for both players", async ({ phones }) => {
    const g = await startClassic(phones);
    await classicMove(g.white, "f2", "f3");
    await expect(g.black.getByLabel("Moves")).toContainText("f3");
    await classicMove(g.black, "e7", "e5");
    await expect(g.white.getByLabel("Moves")).toContainText("e5");
    await classicMove(g.white, "g2", "g4");
    await expect(g.black.getByLabel("Moves")).toContainText("g4");
    await classicMove(g.black, "d8", "h4");
    await expect(g.black.getByRole("heading", { name: "You won" })).toBeVisible();
    await expect(g.white.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(g.white.getByText("Checkmate")).toBeVisible();
  });

  test("classic: choosing a promotion previews it until confirmed", async ({ phones }) => {
    test.setTimeout(60_000);
    const g = await startClassic(phones);
    for (const [page, from, to] of [
      [g.white, "a2", "a4"],
      [g.black, "h7", "h5"],
      [g.white, "a4", "a5"],
      [g.black, "h5", "h4"],
      [g.white, "a5", "a6"],
      [g.black, "h4", "h3"],
      [g.white, "a6", "b7"],
      [g.black, "h3", "g2"],
    ] as const) {
      await classicMove(page, from, to);
      await expect.poll(async () => (await getMatch(g.id)).state.moves.at(-1)?.lan.slice(2, 4)).toBe(to);
    }
    await tapMove(g.white, "b7", "a8");
    await g.white.getByRole("button", { name: "Knight", exact: true }).click();
    await expect(g.white.getByRole("button", { name: /^Confirm/ })).toContainText("bxa8=N");
    await expect.poll(() => pieceOn(g.white, "wN", "a8")).toBe(true);
    expect((await getMatch(g.id)).state.moves).toHaveLength(8);
    await expect.poll(() => pieceOn(g.black, "bR", "a8")).toBe(true);
    await g.white.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => pieceOn(g.white, "bR", "a8")).toBe(true);
    await tapMove(g.white, "b7", "a8");
    await g.white.getByRole("button", { name: "Queen", exact: true }).click();
    await g.white.getByRole("button", { name: /^Confirm/ }).click();
    await expect(g.black.getByLabel("Moves")).toContainText("bxa8=Q");
    await expect.poll(() => pieceOn(g.black, "wQ", "a8")).toBe(true);
    expect((await getMatch(g.id)).state.moves).toHaveLength(9);
  });

  test("challenge someone, they accept from the inbox on the home screen", async ({ phones }) => {
    const [shlok, chris] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
    const [a, b] = await Promise.all([phones.open({ player: shlok, push: "on" }), phones.open({ player: chris, push: "on" })]);

    await a.goto("/chess/mode/classic");
    await a.getByRole("button", { name: "Challenge Chris" }).click();
    await expect(a.getByRole("heading", { name: "Challenge sent" })).toBeVisible();

    await b.goto("/");
    const invite = b.getByRole("region", { name: "Challenge from Shlok" });
    await expect(invite, "the challenge shows up live on Home").toBeVisible();
    await expect(invite).toContainText("Classic");
    await invite.getByRole("button", { name: "Accept" }).click();
    await expect(b.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    await expect(a.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
  });

  test("real-time: countdown, then pieces move without turns and show up on the other phone", async ({ phones }) => {
    test.setTimeout(60_000);
    const [shlok, chris] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
    const [a, b] = await Promise.all([phones.open({ player: shlok, push: "on" }), phones.open({ player: chris, push: "on" })]);

    await a.goto("/chess/mode/realtime");
    await a.getByRole("button", { name: "Find a game" }).click();
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    const id = matchIdOf(a);
    await b.goto(`/chess/${id}`);
    await b.getByRole("button", { name: "Join game" }).click();
    const boardOf = (p: Page) => p.getByRole("grid", { name: "Real-time chess board" });
    await expect(boardOf(a)).toBeVisible();
    await expect(boardOf(b)).toBeVisible();

    await expect.poll(async () => (await getMatch(id)).state?.startAt ?? null, { timeout: 10_000 }).not.toBeNull();
    const m = await getMatch(id);
    const white = m.players.find((p: { color: string }) => p.color === "w").userId === shlok.userId ? a : b;
    const black = white === a ? b : a;
    for (const p of [white, black]) await expect(boardOf(p), "the countdown's over").toHaveAttribute("data-playing", "true");
    await tapMove(white, "e2", "e4");
    await tapMove(black, "d7", "d5");

    await expect
      .poll(() => pieceOn(black, "wP", "e4"), { timeout: 6000, message: "the white pawn lands on e4 on black's screen" })
      .toBe(true);

    await expect
      .poll(async () => (await rtCommands(id)).map((c: { color: string }) => c.color).sort(), {
        message: "both moves are stored once each, as separate inserts",
      })
      .toEqual(["b", "w"]);

    await tapMove(white, "e4", "e5");
    await expect(white.locator("[data-premove]"), "a cooling-down pawn takes a premove, drawn as an arrow").toHaveCount(1);
    await white.locator("[data-square=e4]").click();
    await expect(white.locator("[data-premove]"), "tapping the piece again cancels it").toHaveCount(0);
    await tapMove(white, "e4", "e5");
    await expect
      .poll(() => pieceOn(black, "wP", "e5"), { timeout: 9000, message: "the premove fires by itself the moment the cooldown ends" })
      .toBe(true);

    await resign(white);
    await expect(black.getByRole("heading", { name: "You won" })).toBeVisible();
  });

  test("real-time: taking the king ends the game on its own, with no further moves", async ({ phones }) => {
    const { id, white, black } = await realtimePair(phones, { cooldown: 2, speed: 15 });

    await tapMove(white, "e2", "e4");
    await expect.poll(() => restsOn(white, "wP", "e4"), { timeout: 10_000 }).toBe(true);
    await tapMove(white, "d1", "h5");
    await expect.poll(() => readyOn(white, "wQ", "h5"), { timeout: 10_000 }).toBe(true);
    await tapMove(white, "h5", "f7");
    await expect.poll(() => readyOn(white, "wQ", "f7"), { timeout: 10_000 }).toBe(true);
    await tapMove(white, "f7", "e8");

    await expect(white.getByRole("heading", { name: "You won" })).toBeVisible({ timeout: 8000 });
    await expect(black.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(black.getByText("King captured")).toBeVisible();
    expect((await getMatch(id)).result.reason).toBe("king");
  });

  test("real-time: a drag the phone cancels leaves the piece where it was", async ({ phones }) => {
    const { id, white } = await realtimePair(phones);
    const box = async (sq: string) => (await white.locator(`[data-square=${sq}]`).boundingBox())!;
    const [e2, e4] = [await box("e2"), await box("e4")];
    await white.mouse.move(e2.x + 10, e2.y + 10);
    await white.mouse.down();
    await white.mouse.move(e4.x + 10, e4.y + 10, { steps: 6 });
    await white
      .getByRole("grid", { name: "Real-time chess board" })
      .evaluate(
        (el, [x, y]) => el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1, clientX: x, clientY: y })),
        [e4.x + 10, e4.y + 10],
      );
    await white.mouse.up();
    await tapMove(white, "d2", "d4");
    await expect.poll(async () => (await rtCommands(id)).length, { message: "only the tapped move is sent" }).toBe(1);
    expect(await pieceOn(white, "wP", "e2")).toBe(true);
  });

  test("real-time: your own move never jumps backwards on your screen", async ({ phones }) => {
    const { white } = await realtimePair(phones);
    const index = await white.locator('[data-piece="wP"]').evaluateAll((els) => {
      const sq = document.querySelector("[data-square=e2]")!.getBoundingClientRect();
      return els.findIndex((el) => Math.abs(el.getBoundingClientRect().x - sq.x) < 2 && Math.abs(el.getBoundingClientRect().y - sq.y) < 2);
    });
    expect(index).toBeGreaterThanOrEqual(0);
    const pawn = white.locator('[data-piece="wP"]').nth(index);
    const everyFrameUntilItLands = pawn.evaluate(
      (el) =>
        new Promise<number[]>((resolve) => {
          const ys: number[] = [];
          let left = false;
          const frame = () => {
            ys.push(el.getBoundingClientRect().y);
            const moving = el.getAttribute("data-status") === "moving";
            left ||= moving;
            if ((left && !moving) || ys.length > 600) resolve(ys);
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
    );
    await tapMove(white, "e2", "e4");
    const ys = await everyFrameUntilItLands;
    for (let i = 1; i < ys.length; i++) expect(ys[i], `frame ${i}: ${ys.join(",")}`).toBeLessThanOrEqual(ys[i - 1] + 0.5);
    const e4 = (await white.locator("[data-square=e4]").boundingBox())!;
    expect(Math.abs(ys.at(-1)! - e4.y)).toBeLessThan(2);
  });

  test("the game header scrolls with the page and the menu button lines up with the title", async ({ phones }) => {
    const g = await startClassic(phones);
    const heading = g.white.getByRole("heading", { name: "Classic", exact: true, level: 1 });
    const header = g.white.locator("header", { has: heading });
    expect(await header.evaluate((el) => getComputedStyle(el).position), "nothing with text is pinned to the top, where iOS blurs").toBe(
      "static",
    );
    const title = (await heading.boundingBox())!;
    const block = (await heading.locator("..").boundingBox())!;
    const menu = (await g.white.getByRole("button", { name: "Menu" }).boundingBox())!;
    expect(Math.abs(block.y + block.height / 2 - (menu.y + menu.height / 2)), "the title centers on the menu button").toBeLessThan(4);
    expect(title.y, "the title starts below the strip covering the band iOS blurs").toBeGreaterThanOrEqual(32);
    await g.white.getByRole("button", { name: "Menu" }).click();
    const settings = g.white.getByRole("dialog").getByRole("region", { name: "Game settings" });
    await expect(settings).toContainText("Time to move");
    await expect(g.white.getByRole("dialog").getByRole("button", { name: "How to play" })).toBeVisible();
    await expect(g.white.getByRole("dialog").getByRole("button", { name: "Share this game" })).toBeVisible();
  });

  test("mashing Find a game or a challenge only ever makes one game", async ({ phones }) => {
    const shlok = await createPlayer("Shlok");
    await createPlayer("Chris");
    const a = await phones.open({ player: shlok, push: "on" });
    await a.goto("/chess/mode/classic");
    const find = a.getByRole("button", { name: "Find a game" });
    await find.evaluate((el: HTMLElement) => {
      for (let i = 0; i < 8; i++) el.click();
    });
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    await a.goto("/chess/mode/realtime");
    const row = a.getByRole("button", { name: "Challenge Chris" });
    await expect(row).toBeVisible();
    await row.evaluate((el: HTMLElement) => {
      for (let i = 0; i < 8; i++) el.click();
    });
    await a.waitForURL(/\/chess\/[a-z0-9]+$/);
    const count = async () => {
      const all = await admin().query(anyApi.testing.allMatches, {});
      return ["chess:classic", "chess:realtime"].map((mode) => all.filter((m: { mode: string }) => m.mode === mode).length);
    };
    expect(await settled(count)).toEqual([1, 1]);
  });

  test("real-time pieces sit on their squares while waiting for the other player", async ({ phones }) => {
    const shlok = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const a = await phones.open({ player: shlok, push: "on" });
    const id = await admin().action(anyApi.testing.startMatch, { mode: "chess:realtime", a: shlok.userId, b: chris.userId });
    await a.goto(`/chess/${id}`);
    await expect(a.getByText(/Waiting for Chris/)).toBeVisible();
    const corner = (await a.locator("[data-square]").first().boundingBox())!;
    const boxes = await a.locator("[data-piece]").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(32);
    const inCorner = boxes.filter((b) => Math.abs(b.x - corner.x) < 2 && Math.abs(b.y - corner.y) < 2);
    expect(inCorner.length).toBeLessThanOrEqual(1);
  });

  test("rematch: ask in place, the other player accepts, and both land in the new game", async ({ phones }) => {
    const g = await startClassic(phones);
    await resign(g.white);
    await expect(g.black.getByRole("heading", { name: "You won" })).toBeVisible();
    const oldUrl = g.white.url();

    await g.white.getByRole("button", { name: "Rematch" }).click();
    await expect(g.white.getByText(/Waiting for/)).toBeVisible();
    await expect(g.black.getByText(/wants a rematch/)).toBeVisible();
    expect(g.white.url()).toBe(oldUrl);

    await g.black.getByRole("button", { name: "Accept rematch" }).click();
    await g.white.waitForURL((u) => u.toString() !== oldUrl);
    await g.black.waitForURL((u) => u.toString() !== oldUrl);
    expect(g.white.url()).toBe(g.black.url());
    await expect(g.white.getByRole("grid", { name: "Classic chess board" })).toBeVisible();
    const next = await getMatch(matchIdOf(g.white));
    expect(next.players.find((p: { color: string }) => p.color === "w").userId, "colors swap: last game's black is white now").toBe(
      g.blackPlayer.userId,
    );
  });

  test("rematch: leaving the page declines it", async ({ phones }) => {
    const g = await startClassic(phones);
    await resign(g.white);
    await g.white.getByRole("button", { name: "Rematch" }).click();
    await expect(g.black.getByText(/wants a rematch/)).toBeVisible();
    await g.black.getByRole("button", { name: "Back", exact: true }).click();
    await expect(g.white.getByText(/passed on a rematch/)).toBeVisible();
    await expect(g.white.getByRole("button", { name: "New game" })).toBeVisible();
  });

  test("someone else can watch a game but not touch it", async ({ phones }) => {
    const g = await startClassic(phones);
    const boiler = await createPlayer("Boiler");
    const c = await phones.open({ player: boiler, push: "on" });
    await c.goto(`/chess/${g.id}`);
    await expect(c.getByText("You're watching.")).toBeVisible();
    await expect(c.getByRole("button", { name: "Resign" })).toHaveCount(0);
    await classicMove(g.white, "e2", "e4");
    await expect(c.getByLabel("Moves")).toContainText("e4");
  });

  test("landscape: classic, 4-player and real-time boards fill the height with everything else beside them", async ({ phones }) => {
    const [shlok, chris, sam, alex] = await Promise.all(["Shlok", "Chris", "Sam", "Alex"].map((n) => createPlayer(n)));
    const page = await phones.open({ player: shlok, push: "on" });
    await page.setViewportSize(LANDSCAPE);
    await page.goto("/");
    await simulateSafeAreas(page, SAFE_LANDSCAPE);
    const open = async (id: string) => {
      await page.goto(`/chess/${id}`);
      await rotate(page, "landscape");
    };
    const fitsBesideTheBoard = async (board: string) => {
      await ready(page);
      await expectFitsScreen(page);
      const grid = (await page.getByRole("grid", { name: board }).boundingBox())!;
      expect(grid.height, "the board fills the height").toBeGreaterThan(LANDSCAPE.height * 0.8);
      const menu = (await page.getByRole("button", { name: "Menu" }).boundingBox())!;
      expect(menu.x, "the menu sits beside the board").toBeGreaterThan(grid.x + grid.width);
    };

    const classic = await admin().action(anyApi.testing.startMatch, { mode: "chess:classic", a: shlok.userId, b: chris.userId });
    await open(classic);
    await fitsBesideTheBoard("Classic chess board");
    await tapMove(page, "e2", "e4");
    await expect(page.getByRole("button", { name: /^Confirm/ })).toBeVisible();
    await holdsStill(page);
    await expectFitsScreen(page);
    await page.getByRole("button", { name: /^Confirm/ }).click();
    await expect(page.getByLabel("Moves")).toContainText("e4");
    await fitsBesideTheBoard("Classic chess board");

    const four = await admin().action(anyApi.testing.startFour, {
      mode: "chess:four",
      players: [shlok, chris, sam, alex].map((p) => p.userId),
    });
    await open(four);
    await fitsBesideTheBoard("4-player chess board");
    await expect(page.getByText("Your move")).toBeVisible();
    await tapMove(page, "e2", "e4");
    await expect(page.getByRole("button", { name: /^Confirm/ })).toBeVisible();
    await holdsStill(page);
    await expectFitsScreen(page);

    const realtime = await admin().action(anyApi.testing.startMatch, { mode: "chess:realtime", a: shlok.userId, b: chris.userId });
    await open(realtime);
    await expect(page.getByText(/Waiting for Chris/)).toBeVisible();
    await fitsBesideTheBoard("Real-time chess board");
  });
});
