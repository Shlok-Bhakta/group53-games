import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, fillLobby, getMatch, holdsStill, openLobby, readyForShot, test, type Phones } from "./fixtures";
import { SAFE_LANDSCAPE, SAFE_PORTRAIT, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

type Hex = {
  seq: number;
  current: number;
  turn: number;
  phase: { k: string; at?: number };
  players: { res: number[] }[];
  offers: { id: number }[];
  spots: unknown[];
  roads: number[];
};
const stateOf = async (id: string) => (await getMatch(id)).state as Hex;
const SHOTS = !!process.env.SCREENS;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await readyForShot(page);
  await page.screenshot({ path: `e2e/.state/screens/hexhaven-${name}.png` });
};

async function startGame(phones: Phones, settings: Record<string, string> = {}) {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const [pa, pb] = await Promise.all([phones.open({ player: a, push: "on" }), phones.open({ player: b, push: "on" })]);
  const id = await openLobby(pa, "hexhaven", "classic", settings);
  await fillLobby(pa, [pb]);
  for (const p of [pa, pb]) await expect(p.getByRole("group", { name: "The island" })).toBeVisible({ timeout: 20_000 });
  const m = await getMatch(id);
  const [up, other] = m.turn === a.userId ? [pa, pb] : [pb, pa];
  const [upPlayer, otherPlayer] = m.turn === a.userId ? [a, b] : [b, a];
  return { id, pa, pb, a, b, up, other, upPlayer, otherPlayer };
}

async function settle(page: Page, id: string) {
  const before = (await stateOf(id)).seq;
  await page.locator('[data-pick="village"]').first().click();
  await page.getByRole("button", { name: "Settle here" }).click();
  await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(before);
  await page.locator('[data-pick="road"]').first().click();
  await page.getByRole("button", { name: "Build the road" }).click();
  await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(before + 1);
}

async function pastSetup(id: string, human?: string) {
  await admin().mutation(anyApi.testing.hexhavenBots, { id, human, steps: 8 });
}

test("Hexhaven has a card on Games and a mode page with its settings", async ({ phones }) => {
  const page = await phones.open({ player: await createPlayer("Shlok"), push: "on" });
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Hexhaven" })).toBeVisible();
  await page.goto("/hexhaven/mode/classic");
  await page.getByRole("button", { name: "Settings" }).click();
  for (const group of ["Points to win", "Hand limit on a 7", "Friendly bandit", "Numbers"])
    await expect(page.getByRole("radiogroup", { name: group })).toBeVisible();
  await shot(page, "mode");
});

test("settling on two phones: each placement shows up on the other phone, then the first roll", async ({ phones }) => {
  test.setTimeout(180_000);
  const { id, up, other } = await startGame(phones, { "Points to win": "8" });
  expect((await stateOf(id)).phase.k).toBe("setup");
  await expect(other.locator("[data-dock]")).toContainText(/Waiting for|is on it/);
  await shot(up, "setup");
  await settle(up, id);
  for (const p of [up, other]) await expect(p.locator("[data-pieces]")).toHaveAttribute("data-pieces", "2");
  await settle(other, id);
  await settle(other, id);
  await expect(other.getByRole("list", { name: "Your cards" })).toBeVisible();
  await settle(up, id);
  for (const p of [up, other]) await expect(p.locator("[data-pieces]")).toHaveAttribute("data-pieces", "8");
  const s = await stateOf(id);
  expect(s.phase.k).toBe("roll");
  for (const [p, seat] of [
    [up, s.current],
    [other, 1 - s.current],
  ] as const) {
    const res = s.players[seat].res;
    for (const [r, n] of res.entries()) await expect(p.locator(`[data-res="${r}"]`)).toHaveAttribute("data-count", String(n));
  }
  await up.getByRole("button", { name: "Roll" }).click();
  await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(s.seq);
  const rolled = (await getMatch(id)).state as Hex & { dice: number[] };
  const total = String(rolled.dice[0] + rolled.dice[1]);
  for (const p of [up, other]) await expect(p.locator("[data-roll]")).toHaveAttribute("data-roll", total);
  await shot(up, "rolled");
});

test("building a road: pick it, place it, and the other phone sees it", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, up, other, upPlayer } = await startGame(phones);
  await pastSetup(id);
  const s = await stateOf(id);
  const seat = (await getMatch(id)).players.findIndex((p: { userId: string }) => p.userId === upPlayer.userId);
  const players = s.players.map((p, i) => (i === seat ? { ...p, res: [2, 2, 0, 0, 0] } : p));
  await admin().mutation(anyApi.testing.hexhavenPatch, { id, state: { phase: { k: "main" }, current: seat, players } });
  const pieces = Number(await up.locator("[data-pieces]").getAttribute("data-pieces"));
  await up.getByRole("button", { name: "Road", exact: true }).click();
  await up.locator('[data-pick="road"]').first().click();
  await shot(up, "build");
  await up.getByRole("button", { name: "Build road here" }).click();
  for (const p of [up, other]) await expect(p.locator("[data-pieces]")).toHaveAttribute("data-pieces", String(pieces + 1));
  await expect(up.locator('[data-res="0"]')).toHaveAttribute("data-count", "1");
  await up.getByRole("button", { name: "End turn" }).click();
  await expect(other.getByRole("button", { name: "Roll" })).toBeVisible();
});

test("a trade: offered on one phone, accepted on the other", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, up, other, upPlayer } = await startGame(phones);
  await pastSetup(id);
  const m = await getMatch(id);
  const seat = m.players.findIndex((p: { userId: string }) => p.userId === upPlayer.userId);
  const s = m.state as Hex;
  const players = s.players.map((p, i) => ({ ...p, res: i === seat ? [2, 0, 0, 0, 0] : [0, 0, 0, 0, 3] }));
  await admin().mutation(anyApi.testing.hexhavenPatch, { id, state: { phase: { k: "main" }, current: seat, players } });
  await up.getByRole("button", { name: "Trade" }).click();
  const offer = up.getByRole("region", { name: "New offer" });
  await offer.getByRole("button", { name: "More timber" }).first().click();
  await offer.getByRole("group", { name: "You get" }).getByRole("button", { name: "More ore" }).click();
  await shot(up, "trade");
  await offer.getByRole("button", { name: "Offer to everyone" }).click();
  await expect.poll(async () => (await stateOf(id)).offers.length).toBe(1);
  await expect(other.getByRole("button", { name: "Trade" })).toContainText("1", { timeout: 15_000 });
  await other.getByRole("button", { name: "Trade" }).click();
  await other.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => (await stateOf(id)).players[seat].res).toEqual([1, 0, 0, 0, 1]);
  await up.keyboard.press("Escape");
  await expect(up.locator('[data-res="4"]')).toHaveAttribute("data-count", "1");
});

test("a 7: the other phone gives back half, and the roller moves the bandit", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, up, other, upPlayer } = await startGame(phones);
  await pastSetup(id);
  const m = await getMatch(id);
  const seat = m.players.findIndex((p: { userId: string }) => p.userId === upPlayer.userId);
  const s = m.state as Hex;
  const players = s.players.map((p, i) => ({ ...p, res: i === seat ? [0, 0, 0, 0, 0] : [2, 2, 2, 2, 0] }));
  const owe = s.players.map((_, i) => (i === seat ? 0 : 4));
  await admin().mutation(anyApi.testing.hexhavenPatch, {
    id,
    state: { phase: { k: "discard", owe }, current: seat, players, dice: [3, 4] },
  });
  await other.getByRole("button", { name: "Give back 4 cards" }).click();
  for (const r of [0, 1, 2, 3]) await other.getByRole("button", { name: `More ${["timber", "brick", "wool", "grain"][r]}` }).click();
  await other.getByRole("button", { name: "Give back 4", exact: true }).click();
  await expect.poll(async () => (await stateOf(id)).phase.k).toBe("bandit");
  await up.locator('[data-pick="hex"]').first().click();
  const rob = up.getByRole("button", { name: /^Rob / });
  if (await rob.count()) await rob.first().click();
  else await up.getByRole("button", { name: "Move the bandit here" }).click();
  await expect.poll(async () => (await stateOf(id)).phase.k).toBe("main");
  const bandit = String(((await getMatch(id)).state as { bandit: number }).bandit);
  for (const p of [up, other]) await expect(p.locator("[data-pieces]")).toHaveAttribute("data-bandit-at", bandit);
});

test("on its side: the board beside a side column with the dock, all on screen", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, up } = await startGame(phones);
  await pastSetup(id);
  await simulateSafeAreas(up, SAFE_LANDSCAPE);
  await rotate(up, "landscape");
  await expect(up.getByRole("button", { name: "Roll" })).toBeVisible();
  await holdsStill(up);
  await expectFitsScreen(up);
  const dock = (await up.locator("[data-dock]").boundingBox())!;
  expect(dock.x, "the dock is a column on the right").toBeGreaterThan(up.viewportSize()!.width / 2);
  await shot(up, "landscape");
  await rotate(up, "portrait");
  await holdsStill(up);
  await expectFitsScreen(up, SAFE_PORTRAIT);
});

test("hexhaven-screens", async ({ phones }) => {
  test.skip(!SHOTS, "Screenshots only");
  test.setTimeout(180_000);
  const { id, up, upPlayer } = await startGame(phones);
  await admin().mutation(anyApi.testing.hexhavenBots, { id, human: upPlayer.userId, steps: 8 });
  for (let i = 0; i < 12; i++) {
    const s = await stateOf(id);
    if (s.turn > 8) break;
    await admin().mutation(anyApi.testing.hexhavenBots, { id, steps: 25 });
  }
  await admin().mutation(anyApi.testing.hexhavenBots, { id, human: upPlayer.userId, steps: 60 });
  await up.reload();
  await expect(up.getByRole("group", { name: "The island" })).toBeVisible();
  await shot(up, "midgame");
  await up.getByRole("button", { name: "Log" }).click();
  await shot(up, "log");
  await up.keyboard.press("Escape");
  await up.locator("[data-seat]").first().click();
  await shot(up, "player");
  await up.keyboard.press("Escape");
  await up.emulateMedia({ colorScheme: "light" });
  await shot(up, "midgame-light");
});
