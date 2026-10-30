import type { Browser, Page } from "@playwright/test";
import { createPlayer, expect, phone, test, type Player } from "./fixtures";

// Golf's open world on two phones: both in, a shot on one, and the ball ending up in exactly the same
// place on both (every phone runs the same physics from the same commands).

type BallView = { id: string; x: number; y: number; mode: string; holes: number };
const balls = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: { balls(): BallView[] } }).__golf?.balls() ?? []);
const meOn = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: { me(): string } }).__golf?.me());

async function otherPhone(browser: Browser, player: Player) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  return { context, page: await phone(context, { player, notifications: "granted" }) };
}

async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}

async function intoGolf(page: Page) {
  await page.goto("/golf");
  await expect(page.getByLabel("Driftwood Bay, an open course")).toBeVisible();
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
}

// Drags back from the middle of the screen and lets go: the shot goes the other way.
async function putt(page: Page, dx: number, dy: number) {
  const box = (await page.getByLabel("Driftwood Bay, an open course").boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

test("Golf has a card on Games, and Play goes straight into the world", async ({ context }) => {
  const player = await createPlayer("Shlok");
  const page = await phone(context, { player, notifications: "granted" });
  await enablePush(page);
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Golf" })).toBeVisible();
  await expect(page.getByRole("img", { name: "A putt rolling into the cup" })).toBeVisible();
  await page.getByRole("link", { name: "Play Golf" }).click();
  await expect(page).toHaveURL(/\/golf$/);
  // Golf loads on demand, then tees up.
  await expect(page.getByLabel("Driftwood Bay, an open course")).toBeVisible();
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => meOn(page)).toBeTruthy();
  const me = await meOn(page);
  await expect.poll(async () => (await balls(page)).map((b) => b.id)).toContain(me);
  await expect(page.getByRole("button", { name: "Back to a tee" })).toBeVisible();
  await expect(page.getByRole("button", { name: "See the whole map" })).toBeVisible();
});

test("a shot on one phone lands in exactly the same spot on the other", async ({ context, browser }) => {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const pa = await phone(context, { player: a, notifications: "granted" });
  const other = await otherPhone(browser, b);
  const pb = other.page;
  await enablePush(pa);
  await enablePush(pb);
  await intoGolf(pa);
  await intoGolf(pb);
  const idA = (await meOn(pa))!;
  // Both phones see both balls.
  await expect.poll(async () => (await balls(pa)).length).toBe(2);
  await expect.poll(async () => (await balls(pb)).length).toBe(2);
  const start = (await balls(pb)).find((x) => x.id === idA)!;

  // A gentle putt east along the plaza.
  await putt(pa, -70, 0);
  await expect.poll(async () => (await balls(pa)).find((x) => x.id === idA)?.mode, { timeout: 5000 }).toBe("roll");
  // It reaches the other phone, rolls, and stops.
  await expect.poll(async () => {
    const seen = (await balls(pb)).find((x) => x.id === idA)!;
    return Math.hypot(seen.x - start.x, seen.y - start.y) > 2 && seen.mode === "aim";
  }, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await balls(pa)).find((x) => x.id === idA)?.mode, { timeout: 15_000 }).toBe("aim");

  // Exactly the same world on both: every coordinate, to the last bit.
  const onA = (await balls(pa)).sort((p, q) => p.id.localeCompare(q.id));
  const onB = (await balls(pb)).sort((p, q) => p.id.localeCompare(q.id));
  expect(onB).toEqual(onA);
  await other.context.close();
});

test("players see each other's names over their balls and who's here", async ({ context, browser }) => {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const pa = await phone(context, { player: a, notifications: "granted" });
  const other = await otherPhone(browser, b);
  await enablePush(pa);
  await enablePush(other.page);
  await intoGolf(pa);
  await intoGolf(other.page);
  await expect(pa.getByText("Chris is here")).toBeVisible({ timeout: 15_000 });
  await expect(other.page.getByText("Shlok is here")).toBeVisible({ timeout: 15_000 });
  await other.context.close();
});

test("a shot costs the other phone a few kilobytes, not a stream of positions", async ({ context, browser }) => {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const pa = await phone(context, { player: a, notifications: "granted" });
  const other = await otherPhone(browser, b);
  const pb = other.page;
  await enablePush(pa);
  await enablePush(pb);
  await intoGolf(pa);
  await intoGolf(pb);
  const idA = (await meOn(pa))!;
  await expect.poll(async () => (await balls(pb)).length).toBe(2);
  // Let joining settle, then count everything the other phone receives from the first touch of the
  // shot until the server has settled it and gone to sleep.
  await pb.waitForTimeout(4000);
  let bytes = 0, frames = 0;
  const cdp = await pb.context().newCDPSession(pb);
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameReceived", (e: { response: { payloadData: string } }) => {
    bytes += e.response.payloadData.length;
    frames++;
  });
  await putt(pa, -70, 0);
  await expect.poll(async () => (await balls(pb)).find((x) => x.id === idA)?.mode, { timeout: 15_000 }).toBe("aim");
  await pb.waitForTimeout(6000);
  console.log(`A shot cost the other phone ${bytes} bytes in ${frames} messages`);
  // About 8 KB when this was written (the command, the settled snapshot once, presence).
  expect(bytes).toBeLessThan(20_000);
  await other.context.close();
});
