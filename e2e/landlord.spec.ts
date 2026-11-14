import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, fillLobby, getMatch, openLobby, test, type Phones } from "./fixtures";

// Landlord on two phones: the lobby with house rules, rolling and buying, the other phone watching it play out,
// catching up after being away, and a trade.

type Mono = { seq: number; current: number; phase: { k: string }; players: { pos: number; cash: number }[]; props: ({ owner: number } | null)[] };
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

// The show has caught up and the dock's offering moves.
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
        return JSON.stringify({ busyEls: document.querySelectorAll("[data-busy]").length, screens: document.querySelectorAll(".ll-board").length, view: v?.seq, real: r?.seq, phase: r?.phase, queued: l?.queued(), running: l?.running(), playedTo: l?.playedTo() });
      }),
    );
    throw e;
  }
};

// Whatever the phone up has to do next, the obvious way: roll, buy, drop out of an auction, pay up.
async function step(page: Page) {
  await settledOn(page);
  const dock = page.locator(".rounded-t-3xl");
  for (const name of [/^Roll/, /^Buy for/, /^Pay /, /^Drop out/, /^Auction it/, /^Move \d+$/]) {
    const b = dock.getByRole("button", { name }).first();
    if (await b.isVisible().catch(() => false)) {
      if (await b.isEnabled()) return await b.click({ timeout: 5000 }).then(() => true, () => false);
    }
  }
  return false;
}

async function startGame(phones: Phones, settings: Record<string, string> = {}) {
  const { pa, pb, a, b } = await twoPhones(phones);
  const id = await openLobby(pa, "landlord", "classic", settings);
  await fillLobby(pa, [pb]);
  for (const p of [pa, pb]) await expect(p.getByRole("button", { name: /^Cinder Lane/ })).toBeVisible({ timeout: 20_000 });
  const m = await getMatch(id);
  const [up, other] = m.turn === a.userId ? [pa, pb] : [pb, pa];
  return { id, pa, pb, a, b, up, other };
}

test("Landlord has a card on Games and a mode page with its house rules", async ({ phones }) => {
  const page = await phones.open({ player: await createPlayer("Shlok"), push: "on" });
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Landlord" })).toBeVisible();
  await page.goto("/landlord/mode/classic");
  await page.getByRole("button", { name: "Settings" }).click();
  for (const group of ["Starting cash", "Auctions", "Rest Stop jackpot", "Speed die", "Game"]) await expect(page.getByRole("radiogroup", { name: group })).toBeVisible();
  await shot(page, "mode");
});

test("a game on two phones: roll, buy, and the other phone sees it happen", async ({ phones }) => {
  test.setTimeout(240_000);
  const { id, up, other, pa, pb, a } = await startGame(phones, { "Starting cash": "$2,000" });
  await settledOn(up);
  await expect(up.getByRole("button", { name: "Roll" })).toBeVisible();
  await expect(other.locator(".rounded-t-3xl")).toContainText("'s turn");
  await shot(up, "start");
  const before = await stateOf(id);
  expect(before.players.map((p) => p.cash)).toEqual([2000, 2000]);
  await up.getByRole("button", { name: "Roll" }).click();
  // The piece leaves Start on both phones, and lands where the server has it.
  await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(before.seq);
  const s = await stateOf(id);
  const seat = before.current;
  for (const p of [up, other]) await expect(p.locator(`[data-token="${seat}"]`)).toHaveAttribute("data-pos", String(s.players[seat].pos), { timeout: 15_000 });
  await shot(up, "rolled");
  // Play on a few turns, whoever's up doing the obvious thing, and both phones agree on everyone's money.
  for (let i = 0; i < 6; i++) {
    const who = (await getMatch(id)).turn === a.userId ? pa : pb;
    const seq = (await stateOf(id)).seq;
    if (await step(who)) await expect.poll(async () => (await stateOf(id)).seq).toBeGreaterThan(seq);
  }
  const end = await stateOf(id);
  for (const p of [up, other]) {
    await settledOn(p);
    for (const [i, pl] of end.players.entries()) await expect(p.locator(`[data-seat="${i}"]`)).toContainText(`$${pl.cash.toLocaleString("en-US")}`);
  }
  // Tapping an owned square shows its deed.
  const owned = end.props.findIndex((x) => x && x.owner >= 0);
  if (owned >= 0) {
    // The whole board, so the square's on screen whatever the camera was following.
    await up.getByRole("button", { name: "Whole board" }).click();
    await up.locator(`button[data-pos="${owned}"]`).click({ timeout: 10_000 });
    await expect(up.getByRole("list", { name: "Rent" })).toBeVisible();
    await shot(up, "deed");
  }
});

test("coming back plays what you missed, then it's live", async ({ phones }) => {
  test.setTimeout(120_000);
  const { id, a, b, pb } = await startGame(phones);
  // Chris's phone looks, then leaves.
  await settledOn(pb);
  const url = pb.url();
  await pb.goto("/");
  // Shlok's seat (bots standing in) plays until it's Chris's decision.
  for (let i = 0; i < 4; i++) {
    await admin().mutation(anyApi.testing.landlordBots, { id, human: b.userId, steps: 40 });
    const s = await stateOf(id);
    if ((await getMatch(id)).turn === b.userId && s.seq > 6) break;
    // Chris's own turns, played for him on the server, so there's something of Shlok's to miss after.
    await admin().mutation(anyApi.testing.landlordBots, { id, human: a.userId, steps: 40 });
  }
  await pb.goto(url);
  await expect(pb.getByText("Catching up")).toBeVisible({ timeout: 15_000 });
  await shot(pb, "catching-up");
  await pb.getByRole("button", { name: "Skip to now" }).click();
  await settledOn(pb);
  const s = await stateOf(id);
  for (const [i, p] of s.players.entries()) await expect(pb.locator(`[data-token="${i}"]`)).toHaveAttribute("data-pos", String(p.pos));
  // Nothing new: straight to live.
  await pb.reload();
  await expect(pb.getByRole("button", { name: /^Cinder Lane/ })).toBeVisible({ timeout: 20_000 });
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
  await pa.getByRole("region", { name: "You give" }).getByRole("button", { name: /Cinder Lane/ }).click();
  await pa.getByRole("textbox", { name: /gives: cash/ }).fill("100");
  await shot(pa, "trade");
  await pa.getByRole("button", { name: /^Send to/ }).click();
  await expect(pb.getByRole("button", { name: "Trade" })).toContainText("1", { timeout: 15_000 });
  await pb.getByRole("button", { name: "Trade" }).click();
  await pb.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => (await stateOf(id)).props[1]?.owner).toBe(1 - seatA);
});

// Review shots of a game well under way: owners, houses, a hotel, a mortgage, the whole board, the menu and
// your properties. Only with SCREENS=1.
test("landlord-screens", async ({ phones }) => {
  test.skip(!SHOTS, "Screenshots only");
  test.setTimeout(120_000);
  const { id, pa, a } = await startGame(phones);
  const m = await getMatch(id);
  const me = m.players.findIndex((p: { userId: string }) => p.userId === a.userId);
  const them = 1 - me;
  const s = m.state as Mono;
  const own: Record<number, [number, number, boolean?]> = { 1: [me, 2], 3: [me, 2], 5: [me, 0], 11: [them, 0], 13: [them, 0, true], 16: [me, 0], 21: [them, 3], 23: [them, 3], 24: [them, 4], 37: [them, 5], 39: [them, 5], 25: [them, 0], 12: [me, 0] };
  const props = s.props.map((p, i) => (own[i] ? { owner: own[i][0], houses: own[i][1], mortgaged: !!own[i][2] } : p));
  const players = s.players.map((p, i) => ({ ...p, pos: i === me ? 24 : 26, cash: i === me ? 640 : 1820 }));
  await admin().mutation(anyApi.testing.landlordPatch, { id, state: { props, players } });
  await pa.reload();
  await settledOn(pa);
  await pa.locator('[data-token="0"]').waitFor();
  await pa.waitForTimeout(800);
  await shot(pa, "midgame");
  await pa.getByRole("button", { name: "Whole board" }).click();
  await pa.waitForTimeout(900);
  await shot(pa, "overview");
  await pa.getByRole("button", { name: "Properties" }).click();
  await pa.waitForTimeout(500);
  await shot(pa, "holdings");
  await pa.keyboard.press("Escape");
  await pa.getByRole("button", { name: "Menu" }).click();
  await pa.waitForTimeout(500);
  await shot(pa, "menu");
  await pa.emulateMedia({ colorScheme: "dark" });
  await pa.keyboard.press("Escape");
  await pa.waitForTimeout(500);
  await shot(pa, "overview-dark");
});

// A long game through the real screen: one phone against two bots on the server, the phone doing the obvious
// thing when it's up (and a bot standing in when it's something harder, like raising money). The show never
// sticks, the page never throws, and the phone always ends up where the server is. Only with SOAK=1.
test("landlord-soak", async ({ phones }) => {
  test.skip(!process.env.SOAK, "Soak only");
  test.setTimeout(45 * 60_000);
  const [me, b1, b2] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris"), createPlayer("Sam")]);
  const page = await phones.open({ player: me, push: "on" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = await openLobby(page, "landlord", "classic", process.env.SOAK_SHORT ? { "Starting cash": "$1,000", Game: "Short game" } : { "Speed die": "On", "Rest Stop jackpot": "Plus $500" });
  // The bots take their seats on the server, then the host starts it.
  for (const b of [b1, b2]) await admin().mutation(anyApi.testing.joinAs, { id, userId: b.userId });
  await page.getByRole("button", { name: "Start with 3" }).click();
  await expect(page.getByRole("button", { name: /^Cinder Lane/ })).toBeVisible({ timeout: 20_000 });
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
  for (const [i, p] of s.players.entries()) if (!(p as { out?: boolean }).out) await expect(page.locator(`[data-token="${i}"]`)).toHaveAttribute("data-pos", String(p.pos));
  // Then the bots finish it off on the server, and the phone plays it through to the result.
  for (let i = 0; i < 100 && (await getMatch(id)).status === "active"; i++) await admin().mutation(anyApi.testing.landlordBots, { id, steps: 200 });
  expect((await getMatch(id)).status).toBe("finished");
  // That's a lot to watch: it offers Skip.
  await page.getByRole("button", { name: "Skip to now" }).click({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-busy]")).toHaveCount(0);
  expect(errors).toEqual([]);
  await shot(page, "soak-end");
});
