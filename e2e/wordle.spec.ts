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

type Wordle = { round: number; players: { rows: number; done: boolean; won: boolean; picked: boolean; effects: { item: string }[] }[] };
const stateOf = async (id: string) => (await getMatch(id)).state as Wordle;
const answerOf = (id: string): Promise<string> => admin().query(anyApi.testing.wordleWord, { id });
const SHOTS = !!process.env.SCREENS;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await readyForShot(page);
  await page.screenshot({ path: `e2e/.state/screens/wordle-${name}.png` });
};
const WRONG = ["pious", "ghost", "flame", "brick", "shard", "dumpy"];

async function startGame(phones: Phones, settings: Record<string, string> = {}, names = ["Shlok", "Chris"]) {
  const players = await Promise.all(names.map((n) => createPlayer(n)));
  const pages = await Promise.all(players.map((p) => phones.open({ player: p, push: "on" })));
  const id = await openLobby(pages[0], "wordle", "classic", settings);
  await fillLobby(pages[0], pages.slice(1));
  for (const p of pages) await expect(p.getByRole("group", { name: "Keyboard" })).toBeVisible({ timeout: 20_000 });
  const m = await getMatch(id);
  const seatOf = (i: number) => m.players.findIndex((x: { userId: string }) => x.userId === players[i].userId);
  return { id, pages, players, seatOf };
}

async function type(page: Page, word: string) {
  const keys = page.getByRole("group", { name: "Keyboard" });
  for (const ch of word) await keys.getByRole("button", { name: ch.toUpperCase(), exact: true }).click();
  await keys.getByRole("button", { name: "Enter" }).click();
}

async function guessOn(page: Page, id: string, seat: number, word: string) {
  const before = (await stateOf(id)).players[seat].rows;
  await type(page, word);
  await expect.poll(async () => (await stateOf(id)).players[seat].rows).toBe(before + 1);
  await expect(page.getByRole("grid", { name: "Your board" })).toHaveAttribute("data-played", String(before + 1));
}

test("PvP Wordle has a card on Games and a mode page with its settings", async ({ phones }) => {
  const page = await phones.open({ player: await createPlayer("Shlok"), push: "on" });
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "PvP Wordle" })).toBeVisible();
  await page.goto("/wordle/mode/classic");
  await page.getByRole("button", { name: "Settings" }).click();
  for (const group of ["Words to win", "Time per word", "Shop"]) await expect(page.getByRole("radiogroup", { name: group })).toBeVisible();
  await ready(page);
  await shot(page, "mode");
});

test("two phones: guesses land live, colors show once you're done, the shop's fog hits the next word", async ({ phones }) => {
  test.setTimeout(180_000);
  const { id, pages, seatOf } = await startGame(phones);
  const [pa, pb] = pages;
  const [sa, sb] = [seatOf(0), seatOf(1)];
  const stock = ["fog", "pickpocket", "shield", "hint", "extra"].map((item) => ({ item, left: 1 }));
  await admin().mutation(anyApi.testing.wordlePatch, { id, stock });
  const answer = await answerOf(id);
  const wrong = WRONG.filter((w) => w !== answer);

  await type(pa, "zzzzz");
  await expect(pa.getByText("Not in the word list.")).toBeVisible();
  expect((await stateOf(id)).players[sa].rows).toBe(0);
  for (let i = 0; i < 5; i++) await pa.getByRole("group", { name: "Keyboard" }).getByRole("button", { name: "Delete" }).click();

  await guessOn(pa, id, sa, wrong[0]);
  await expect(pb.locator(`[data-seat="${sa}"]`)).toHaveAttribute("data-rows", "1");
  await shot(pa, "playing");

  await guessOn(pa, id, sa, answer);
  await expect(pa.locator("[data-my-word]")).toHaveAttribute("data-my-word", "won");
  await expect(pb.locator(`[data-seat="${sa}"]`)).toHaveAttribute("data-done", "won");
  await expect(pa.locator(`[data-board-of="${sb}"] [data-marks]`)).toHaveAttribute("data-marks", "");

  await guessOn(pb, id, sb, wrong[1]);
  await expect(pa.locator(`[data-board-of="${sb}"] [data-marks]`)).not.toHaveAttribute("data-marks", "");
  await guessOn(pb, id, sb, answer);
  await expect(pb.locator(`[data-board-of="${sa}"] [data-marks]`)).toHaveAttribute("data-marks", /22222$/);
  await shot(pa, "done");

  await pa.getByRole("button", { name: /^Shop/ }).click();
  await pa.getByRole("radio", { name: /^Fog/ }).click();
  await shot(pa, "shop");
  await pa.getByRole("button", { name: /^Buy Fog/ }).click();
  await expect.poll(async () => (await stateOf(id)).players[sa].picked).toBe(true);
  await expect(pa.getByRole("button", { name: /^Fog at/ })).toBeVisible();

  await pb.getByRole("button", { name: /^Shop/ }).click();
  await pb.getByRole("button", { name: "Pass and keep my coins" }).click();
  await expect.poll(async () => (await stateOf(id)).round).toBe(1);

  await expect(pb.locator("[data-incoming]")).toBeVisible();
  await expect(pb.locator("[data-incoming]")).toContainText(/fogged you/);
  const next = await answerOf(id);
  const misses = WRONG.filter((w) => w !== next);
  await guessOn(pb, id, sb, misses[0]);
  await guessOn(pb, id, sb, misses[1]);
  await expect(pb.locator("[data-fog]")).toHaveAttribute("data-fog", "1");
  await shot(pb, "fogged");

  await pa.getByRole("button", { name: "Log" }).click();
  await expect(pa.locator(`[data-log-word="${answer}"]`)).toBeVisible();
  await shot(pa, "log");
});

test("a whole game to the result, then everyone's words in the log", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pages, players } = await startGame(phones, { "Words to win": "3", Shop: "Off" });
  for (let r = 0; r < 3; r++) {
    const answer = await answerOf(id);
    for (const p of players) await admin().mutation(anyApi.testing.wordleGuessAs, { id, userId: p.userId, word: answer });
  }
  await expect.poll(async () => (await getMatch(id)).status).toBe("finished");
  for (const p of pages) await expect(p.getByRole("region", { name: "Result" })).toBeVisible();
  await expect(pages[0].getByText(/^It was /)).toBeVisible();
  await shot(pages[0], "result");
});

test("on its side: the keyboard on the left, the board in the side column, all on screen", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pages, seatOf } = await startGame(phones);
  const [pa] = pages;
  await simulateSafeAreas(pa, SAFE_LANDSCAPE);
  await rotate(pa, "landscape");
  await expect(pa.getByRole("group", { name: "Keyboard" })).toBeVisible();
  await holdsStill(pa);
  await expectFitsScreen(pa);
  const keys = (await pa.getByRole("group", { name: "Keyboard" }).boundingBox())!;
  const board = (await pa.getByRole("grid", { name: "Your board" }).boundingBox())!;
  expect(board.x, "the board sits right of the keyboard").toBeGreaterThan(keys.x + keys.width / 2);
  await shot(pa, "landscape");
  await guessOn(pa, id, seatOf(0), await answerOf(id));
  await expect(pa.locator("[data-my-word]")).toBeVisible();
  await holdsStill(pa);
  await expectFitsScreen(pa);
  await rotate(pa, "portrait");
  await holdsStill(pa);
  await expectFitsScreen(pa, SAFE_PORTRAIT);
});

test("wordle-screens", async ({ phones }) => {
  test.skip(!SHOTS, "Screenshots only");
  test.setTimeout(180_000);
  const { id, pages, players, seatOf } = await startGame(phones, {}, ["Shlok", "Chris", "Sam", "Alex"]);
  const [pa] = pages;
  const answer = await answerOf(id);
  for (const p of players.slice(1)) {
    for (const w of WRONG.filter((x) => x !== answer).slice(0, 2))
      await admin().mutation(anyApi.testing.wordleGuessAs, { id, userId: p.userId, word: w });
  }
  await guessOn(
    pa,
    id,
    seatOf(0),
    WRONG.find((w) => w !== answer)!,
  );
  await shot(pa, "four-playing");
  await pa.emulateMedia({ colorScheme: "light" });
  await shot(pa, "four-playing-light");
});
