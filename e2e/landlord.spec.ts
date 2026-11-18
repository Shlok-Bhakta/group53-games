import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, fillLobby, getMatch, holdsStill, openLobby, readyForShot, test, type Phones } from "./fixtures";
import { SAFE_LANDSCAPE, SAFE_PORTRAIT, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

type Mono = {
  seq: number;
  current: number;
  phase: { k: string };
  players: { pos: number; cash: number }[];
  props: ({ owner: number } | null)[];
};
const stateOf = async (id: string) => (await getMatch(id)).state as Mono;
const SHOTS = !!process.env.SCREENS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `e2e/.state/screens/landlord-${name}.png` });
};

async function twoPhones(phones: Phones) {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const [pa, pb] = await Promise.all([phones.open({ player: a, push: "on" }), phones.open({ player: b, push: "on" })]);
  return { pa, pb, a, b };
}

const settledOn = async (page: Page) => {
  try {
    await expect(page.locator("[data-busy]")).toHaveCount(0, { timeout: 90_000 });
  } catch (e) {
    console.log(
      "STUCK",
      await page.evaluate(() => {
        const l = (window as unknown as { __landlord?: Record<string, () => unknown> }).__landlord;
        const v = l?.view() as { seq: number } | null;
        const r = l?.real() as { seq: number; phase: unknown } | null;
        return JSON.stringify({
          busyEls: document.querySelectorAll("[data-busy]").length,
          screens: document.querySelectorAll(".ll-board").length,
          view: v?.seq,
          real: r?.seq,
          phase: r?.phase,
          queued: l?.queued(),
          running: l?.running(),
          playedTo: l?.playedTo(),
        });
      }),
    );
    throw e;
  }
};

async function step(page: Page) {
  await settledOn(page);
  const dock = page.locator("[data-dock]");
  for (const name of [/^Roll/, /^Buy for/, /^Pay /, /^Drop out/, /^Auction it/, /^Move \d+$/]) {
    const b = dock.getByRole("button", { name }).first();
    if (await b.isVisible().catch(() => false)) {
      if (await b.isEnabled())
        return await b.click({ timeout: 5000 }).then(
          () => true,
          () => false,
        );
    }
  }
  return false;
}

async function startGame(phones: Phones, settings: Record<string, string> = {}) {
  const { pa, pb, a, b } = await twoPhones(phones);
  const id = await openLobby(pa, "landlord", "classic", settings);
  await fillLobby(pa, [pb]);
  for (const p of [pa, pb]) await expect(p.getByRole("button", { name: /^Mediterranean Avenue/ })).toBeVisible({ timeout: 20_000 });
  const m = await getMatch(id);
  const [up, other] = m.turn === a.userId ? [pa, pb] : [pb, pa];
  return { id, pa, pb, a, b, up, other };
}

test("Monopoly has a card on Games and a mode page with its house rules", async ({ phones }) => {
  const page = await phones.open({ player: await createPlayer("Shlok"), push: "on" });
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Monopoly" })).toBeVisible();
  await page.goto("/landlord/mode/classic");
  await expect(page).toHaveURL(/\/monopoly\/mode\/classic$/);
  await page.getByRole("button", { name: "Settings" }).click();
  for (const group of ["Starting cash", "Auctions", "Free Parking jackpot", "Speed die", "Game"])
    await expect(page.getByRole("radiogroup", { name: group })).toBeVisible();
  if (SHOTS) await readyForShot(page);
  await shot(page, "mode");
});

test("a game on two phones: roll, buy, and the other phone sees it happen", async ({ phones }) => {
  test.setTimeout(240_000);
  const { id, up, other, pa, pb, a } = await startGame(phones, { "Starting cash": "$2,000" });
  await settledOn(up);
  await expect(up.getByRole("button", { name: "Roll" })).toBeVisible();
  await expect(other.locator("[data-dock]")).toContainText("'s turn");
  await shot(up, "start");
  const before = await stateOf(id);
  expect(before.players.map((p) => p.cash)).toEqual([2000, 2000]);
  await up.getByRole("button", { name: "Roll" }).click();
  await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(before.seq);
  const s = await stateOf(id);
  const seat = before.current;
  for (const p of [up, other])
    await expect(p.locator(`[data-token="${seat}"]`)).toHaveAttribute("data-pos", String(s.players[seat].pos), { timeout: 15_000 });
  await shot(up, "rolled");
  for (let i = 0; i < 6; i++) {
    const who = (await getMatch(id)).turn === a.userId ? pa : pb;
    const seq = (await stateOf(id)).seq;
    if (await step(who)) await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(seq);
  }
  const end = await stateOf(id);
  for (const p of [up, other]) {
    await settledOn(p);
    for (const [i, pl] of end.players.entries())
      await expect(p.locator(`[data-seat="${i}"]`)).toContainText(`$${pl.cash.toLocaleString("en-US")}`);
  }
  const owned = end.props.findIndex((x) => x && x.owner >= 0);
  if (owned >= 0) {
    await up.getByRole("button", { name: "Whole board" }).click();
    await up.locator(`button[data-pos="${owned}"]`).click({ timeout: 10_000 });
    await expect(up.getByRole("list", { name: "Rent" })).toBeVisible();
    await shot(up, "deed");
  }
});

test("coming back plays what you missed, then it's live", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, a, b, pb } = await startGame(phones);
  await settledOn(pb);
  const url = pb.url();
  await pb.goto("/");
  for (let i = 0; i < 4; i++) {
    await admin().mutation(anyApi.testing.landlordBots, { id, human: b.userId, steps: 40 });
    const s = await stateOf(id);
    if ((await getMatch(id)).turn === b.userId && s.seq > 6) break;
    await admin().mutation(anyApi.testing.landlordBots, { id, human: a.userId, steps: 40 });
  }
  await pb.goto(url);
  await expect(pb.getByText("Catching up")).toBeVisible({ timeout: 15_000 });
  await shot(pb, "catching-up");
  await pb.getByRole("button", { name: "Skip to now" }).click();
  await settledOn(pb);
  const s = await stateOf(id);
  for (const [i, p] of s.players.entries()) await expect(pb.locator(`[data-token="${i}"]`)).toHaveAttribute("data-pos", String(p.pos));
  await pb.reload();
  await expect(pb.getByRole("button", { name: /^Mediterranean Avenue/ })).toBeVisible({ timeout: 20_000 });
  await expect(pb.getByText("Catching up")).toHaveCount(0);
});

test("a trade: offered on one phone, accepted on the other", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pa, pb, a } = await startGame(phones);
  const m = await getMatch(id);
  const seatA = m.players.findIndex((p: { userId: string }) => p.userId === a.userId);
  const props = (m.state as Mono).props.map((p, i) => (i === 1 || i === 3 ? { owner: seatA, houses: 0, mortgaged: false } : p));
  await admin().mutation(anyApi.testing.landlordPatch, { id, state: { props } });
  await settledOn(pa);
  await pa.getByRole("button", { name: "Trade" }).click();
  await pa
    .getByRole("region", { name: "You give" })
    .getByRole("button", { name: /Mediterranean Avenue/ })
    .click();
  await pa.getByRole("textbox", { name: /gives: cash/ }).fill("100");
  await shot(pa, "trade");
  await pa.getByRole("button", { name: /^Send to/ }).click();
  await expect(pb.getByRole("button", { name: "Trade" })).toContainText("1", { timeout: 15_000 });
  await pb.getByRole("button", { name: "Trade" }).click();
  await pb.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => (await stateOf(id)).props[1]?.owner).toBe(1 - seatA);
});

test("with a long list to trade, the sheet scrolls and who you trade with stays whole", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pa, a } = await startGame(phones);
  const m = await getMatch(id);
  const seatA = m.players.findIndex((p: { userId: string }) => p.userId === a.userId);
  const owned = [1, 3, 6, 8, 9, 11, 12, 13, 14, 16, 18, 19];
  const props = (m.state as Mono).props.map((p, i) => (owned.includes(i) ? { owner: seatA, houses: 0, mortgaged: i === 12 } : p));
  await admin().mutation(anyApi.testing.landlordPatch, { id, state: { props } });
  await settledOn(pa);
  await pa.getByRole("button", { name: "Trade" }).click();
  const picker = pa.getByRole("radiogroup", { name: "Trade with" });
  const partner = picker.getByRole("radio").first();
  await expect(partner).toBeVisible();
  expect((await picker.boundingBox())!.height, "the row of players isn't squeezed shut").toBeGreaterThanOrEqual(
    (await partner.boundingBox())!.height,
  );
  await expect(pa.getByRole("region", { name: "You give" }).getByRole("button", { name: /Electric Company/ })).toBeVisible();
});

test("with a long list of properties, the rows stay whole and the sheet scrolls to the last one", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pa, a } = await startGame(phones);
  const m = await getMatch(id);
  const seatA = m.players.findIndex((p: { userId: string }) => p.userId === a.userId);
  const owned = [1, 3, 6, 8, 9, 11, 12, 13, 14, 16, 18, 19, 21, 23, 24, 26, 27, 29, 31, 32, 34, 37, 39];
  const props = (m.state as Mono).props.map((p, i) => (owned.includes(i) ? { owner: seatA, houses: 0, mortgaged: i === 11 } : p));
  await admin().mutation(anyApi.testing.landlordPatch, { id, state: { props } });
  await settledOn(pa);
  await pa.getByRole("button", { name: "Properties" }).click();
  await expect(pa.getByRole("heading", { name: "Your properties" })).toBeVisible();
  const cards = pa.locator('[data-slot="drawer-content"] [data-slot="card"]');
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    const fits = await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    expect(fits, "a group of properties isn't squeezed and clipped").toBe(true);
  }
  const last = pa.getByRole("button", { name: "Mortgage Boardwalk for $200" });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
});

test("mortgaging asks first, from the properties list and the deed", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, pa, a } = await startGame(phones);
  const m = await getMatch(id);
  const seatA = m.players.findIndex((p: { userId: string }) => p.userId === a.userId);
  const props = (m.state as Mono).props.map((p, i) => (i === 1 || i === 3 ? { owner: seatA, houses: 0, mortgaged: false } : p));
  await admin().mutation(anyApi.testing.landlordPatch, { id, state: { props } });
  await settledOn(pa);
  await pa.getByRole("button", { name: "Properties" }).click();
  await pa.getByRole("button", { name: "Mortgage Mediterranean Avenue for $30" }).click();
  const ask = pa.getByRole("alertdialog", { name: "Mortgage Mediterranean Avenue?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep it" }).click();
  await expect(ask).toHaveCount(0);
  expect((await stateOf(id)).props[1]?.mortgaged).toBe(false);
  await pa.getByRole("button", { name: "Mortgage Mediterranean Avenue for $30" }).click();
  await ask.getByRole("button", { name: "Mortgage +$30" }).click();
  await expect.poll(async () => (await stateOf(id)).props[1]?.mortgaged).toBe(true);
  await pa.getByRole("button", { name: "Baltic Avenue", exact: false }).first().click();
  await pa.getByRole("button", { name: "Mortgage +$30" }).click();
  await pa.getByRole("alertdialog", { name: "Mortgage Baltic Avenue?" }).getByRole("button", { name: "Mortgage +$30" }).click();
  await expect.poll(async () => (await stateOf(id)).props[3]?.mortgaged).toBe(true);
});

test("on its side: the board beside a side column with the dock, all on screen", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, up, other } = await startGame(phones);
  const m = await getMatch(id);
  const upSeat = m.players.findIndex((p: { userId: string }) => p.userId === m.turn);
  const props = (m.state as Mono).props.map((p, i) => (i === 1 || i === 3 ? { owner: upSeat, houses: 0, mortgaged: false } : p));
  await admin().mutation(anyApi.testing.landlordPatch, { id, state: { props } });
  await simulateSafeAreas(up, SAFE_LANDSCAPE);
  await rotate(up, "landscape");
  await settledOn(up);
  const roll = up.getByRole("button", { name: "Roll" });
  await expect(roll).toBeVisible();
  await holdsStill(up);
  await expectFitsScreen(up);
  const dock = (await up.locator("[data-dock]").boundingBox())!;
  const width = up.viewportSize()!.width;
  const height = up.viewportSize()!.height;
  expect(dock.x, "the dock is a column on the right").toBeGreaterThan(width / 2);
  expect((await roll.boundingBox())!.x, "Roll is in the side column").toBeGreaterThanOrEqual(dock.x);
  expect((await up.getByRole("button", { name: "Menu" }).boundingBox())!.x, "the bar sits over the dock").toBeGreaterThanOrEqual(dock.x);
  const token = (await up.locator(`[data-token="${upSeat}"]`).boundingBox())!;
  expect(token.x + token.width / 2, "the camera looks at whoever's up, left of the column").toBeLessThan(dock.x);
  if (SHOTS) await up.screenshot({ path: "e2e/.state/screens/landlord-landscape.png" });

  await up.getByRole("button", { name: "Properties" }).click();
  await expect(up.getByRole("heading", { name: "Your properties" })).toBeVisible();
  await holdsStill(up);
  await expectFitsScreen(up);
  await up.keyboard.press("Escape");
  await expect(up.getByRole("heading", { name: "Your properties" })).toHaveCount(0);

  await up.getByRole("button", { name: "Whole board" }).click();
  await holdsStill(up);
  const board = (await up.locator(".ll-board").boundingBox())!;
  expect(board.x, "the whole board clears the notch").toBeGreaterThanOrEqual(SAFE_LANDSCAPE.left - 1);
  expect(board.x + board.width, "the whole board fits left of the column").toBeLessThanOrEqual(dock.x + 1);
  expect(board.y, "the whole board fits the height").toBeGreaterThanOrEqual(-1);
  expect(board.y + board.height).toBeLessThanOrEqual(height - SAFE_LANDSCAPE.bottom + 1);
  if (SHOTS) await up.screenshot({ path: "e2e/.state/screens/landlord-landscape-whole.png" });
  await up.getByRole("button", { name: "Zoom in" }).click();
  await holdsStill(up);

  const before = await stateOf(id);
  await roll.click();
  await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(before.seq);
  const s = await stateOf(id);
  for (const p of [up, other])
    await expect(p.locator(`[data-token="${before.current}"]`)).toHaveAttribute("data-pos", String(s.players[before.current].pos), {
      timeout: 15_000,
    });
  await settledOn(up);
  await holdsStill(up);
  await expectFitsScreen(up);

  await rotate(up, "portrait");
  await holdsStill(up);
  await expectFitsScreen(up, SAFE_PORTRAIT);
  const portraitDock = (await up.locator("[data-dock]").boundingBox())!;
  expect(portraitDock.y, "back upright, the dock is along the bottom").toBeGreaterThan(up.viewportSize()!.height / 2);
});

test("landlord-screens", async ({ phones }) => {
  test.skip(!SHOTS, "Screenshots only");
  test.setTimeout(120_000);
  const { id, pa, a } = await startGame(phones);
  const m = await getMatch(id);
  const me = m.players.findIndex((p: { userId: string }) => p.userId === a.userId);
  const them = 1 - me;
  const s = m.state as Mono;
  const own: Record<number, [number, number, boolean?]> = {
    1: [me, 2],
    3: [me, 2],
    5: [me, 0],
    11: [them, 0],
    13: [them, 0, true],
    16: [me, 0],
    21: [them, 3],
    23: [them, 3],
    24: [them, 4],
    37: [them, 5],
    39: [them, 5],
    25: [them, 0],
    12: [me, 0],
  };
  const props = s.props.map((p, i) => (own[i] ? { owner: own[i][0], houses: own[i][1], mortgaged: !!own[i][2] } : p));
  const players = s.players.map((p, i) => ({ ...p, pos: i === me ? 24 : 26, cash: i === me ? 640 : 1820 }));
  await admin().mutation(anyApi.testing.landlordPatch, { id, state: { props, players } });
  await pa.reload();
  await settledOn(pa);
  await pa.locator('[data-token="0"]').waitFor();
  await readyForShot(pa);
  await shot(pa, "midgame");
  await pa.getByRole("button", { name: "Whole board" }).click();
  await readyForShot(pa);
  await shot(pa, "overview");
  await pa.getByRole("button", { name: "Properties" }).click();
  await expect(pa.getByRole("heading", { name: "Your properties" })).toBeVisible();
  await readyForShot(pa);
  await shot(pa, "holdings");
  await pa.keyboard.press("Escape");
  await expect(pa.getByRole("heading", { name: "Your properties" })).toHaveCount(0);
  await pa.getByRole("button", { name: "Menu" }).click();
  await expect(pa.getByRole("list", { name: "Standings" })).toBeVisible();
  await readyForShot(pa);
  await shot(pa, "menu");
  await pa.emulateMedia({ colorScheme: "dark" });
  await pa.keyboard.press("Escape");
  await expect(pa.getByRole("list", { name: "Standings" })).toHaveCount(0);
  await readyForShot(pa);
  await shot(pa, "overview-dark");
});

test("landlord-soak", async ({ phones }) => {
  test.skip(!process.env.SOAK, "Soak only");
  test.setTimeout(45 * 60_000);
  const [me, b1, b2] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris"), createPlayer("Sam")]);
  const page = await phones.open({ player: me, push: "on" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = await openLobby(
    page,
    "landlord",
    "classic",
    process.env.SOAK_SHORT ? { "Starting cash": "$1,000", Game: "Short game" } : { "Speed die": "On", "Free Parking jackpot": "Plus $500" },
  );
  for (const b of [b1, b2]) await admin().mutation(anyApi.testing.joinAs, { id, userId: b.userId });
  await page.getByRole("button", { name: "Start with 3" }).click();
  await expect(page.getByRole("button", { name: /^Mediterranean Avenue/ })).toBeVisible({ timeout: 20_000 });
  const rounds = Number(process.env.SOAK) > 1 ? Number(process.env.SOAK) : 40;
  for (let i = 0; i < rounds; i++) {
    const m = await getMatch(id);
    if (m.status !== "active") break;
    await admin().mutation(anyApi.testing.landlordBots, { id, human: me.userId, steps: 30 });
    const s = await stateOf(id);
    if ((await getMatch(id)).turn !== me.userId) continue;
    const seq = s.seq;
    if (!(await step(page))) await admin().mutation(anyApi.testing.landlordBots, { id, steps: 1 });
    await expect.poll(async () => (await stateOf(id)).seq, { timeout: 15_000 }).toBeGreaterThan(seq);
  }
  await settledOn(page);
  const s = await stateOf(id);
  for (const [i, p] of s.players.entries())
    if (!(p as { out?: boolean }).out) await expect(page.locator(`[data-token="${i}"]`)).toHaveAttribute("data-pos", String(p.pos));
  for (let i = 0; i < 100 && (await getMatch(id)).status === "active"; i++)
    await admin().mutation(anyApi.testing.landlordBots, { id, steps: 200 });
  expect((await getMatch(id)).status).toBe("finished");
  await page.getByRole("button", { name: "Skip to now" }).click({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-busy]")).toHaveCount(0);
  expect(errors).toEqual([]);
  await shot(page, "soak-end");
});
