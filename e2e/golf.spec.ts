import type { Browser, Page } from "@playwright/test";
import { SOLUTIONS } from "../convex/golf/solutions";
import { createPlayer, expect, phone, test, type Player } from "./fixtures";

// Golf's open world on two phones: both in, a shot on one, and the ball ending up in exactly the same
// place on both (every phone runs the same physics from the same commands).

type BallView = { id: string; x: number; y: number; mode: string; holes: number; strokes: number; t: number };
const balls = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: { balls(): BallView[] } }).__golf?.balls() ?? []);
const shoot = (page: Page, a: number, p: number) => page.evaluate(([x, y]) => (window as unknown as { __golf: { shoot(a: number, p: number): void } }).__golf.shoot(x, y), [a, p]);
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
  await page.goto("/golf/world");
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

test("Golf has a card on Games, and Play opens the courses and the open world", async ({ context }) => {
  const player = await createPlayer("Shlok");
  const page = await phone(context, { player, notifications: "granted" });
  await enablePush(page);
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Golf" })).toBeVisible();
  // Card art plays once it's scrolled to.
  await page.getByRole("heading", { name: "Golf" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: "A putt rolling into the cup" })).toBeVisible();
  await page.getByRole("link", { name: "Play Golf" }).click();
  await expect(page).toHaveURL(/\/golf$/);
  await expect(page.getByRole("heading", { name: "Bumper Plains" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cold Start" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Hole \d, par \d/ })).toHaveCount(18);
  await page.getByRole("link", { name: /Driftwood Bay/ }).click();
  await expect(page).toHaveURL(/\/golf\/world$/);
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
  // (Not the clock: each phone's is wherever that phone has got to.)
  const settled = async (page: Page) => (await balls(page)).map(({ t: _t, ...b }) => b).sort((p, q) => p.id.localeCompare(q.id));
  const onA = await settled(pa);
  const onB = await settled(pb);
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

test("a hole: sink it, see the score on both phones, go on to the next, and it's on the course page", async ({ context, browser }) => {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const pa = await phone(context, { player: a, notifications: "granted" });
  const other = await otherPhone(browser, b);
  const pb = other.page;
  await enablePush(pa);
  await enablePush(pb);
  await pa.goto("/golf");
  await pa.getByRole("link", { name: "Hello, Hole 1, par 2" }).click();
  // (Exactly: the row on the course page has this in its label too.)
  await expect(pa.getByLabel("Hello, hole 1", { exact: true })).toBeVisible();
  await expect(pa.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  await expect(pa.getByText("Hole 1, par 2").last()).toBeVisible();
  await pb.goto("/golf/plains/1");
  await expect(pb.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => (await balls(pa)).length).toBe(2);
  // A small hole shows whole: no need for the map button.
  await expect(pa.getByRole("button", { name: "See the whole map" })).toHaveCount(0);

  await expect.poll(async () => (await balls(pa)).every((x) => x.mode === "aim")).toBe(true);
  // A hole in one off the left rail, clear of the other ball on the next tee.
  await shoot(pa, -2.78, 0.84);
  const sheet = pa.getByRole("dialog", { name: "Hole finished" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole("heading", { name: "Hole in one" })).toBeVisible();
  // The server counted it, from its own run of the world.
  await expect(sheet.getByText("Shlok")).toBeVisible({ timeout: 15_000 });
  // The other phone saw it go in, and its ball's still there.
  await expect(pb.getByText("Shlok sank one")).toBeVisible({ timeout: 15_000 });

  await sheet.getByRole("button", { name: "Next hole" }).click();
  await expect(pa).toHaveURL(/\/golf\/plains\/2$/);
  await expect(pa.getByLabel("Elbow, hole 2", { exact: true })).toBeVisible();
  await expect(pa.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  // Leaving took my ball off the first hole.
  await expect.poll(async () => (await balls(pb)).map((x) => x.id), { timeout: 15_000 }).toEqual([await meOn(pb)]);

  await pa.getByRole("button", { name: "Back" }).click();
  await expect(pa).toHaveURL(/\/golf$/);
  await expect(pa.getByRole("link", { name: "Play Bumper Plains" })).toContainText("Play from hole 2");
  await other.context.close();
});

test("an ice hole plays, and the putt goes further than you'd think", async ({ context }) => {
  const player = await createPlayer("Shlok");
  const page = await phone(context, { player, notifications: "granted" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await enablePush(page);
  await page.goto("/golf/cold/1");
  await expect(page.getByLabel("Thin Ice, hole 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  const me = await balls(page);
  await shoot(page, -Math.PI / 2, 0.12);
  await expect.poll(async () => (await balls(page))[0].strokes).toBe(1);
  await expect.poll(async () => (await balls(page))[0].mode, { timeout: 15_000 }).toBe("aim");
  // About twice what the same tap would do on grass.
  expect(me[0].y - (await balls(page))[0].y).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

// Airplane wifi: every WebSocket message held back this long, each way.
async function slowConnection(page: Page, ms: number) {
  await page.addInitScript((delay) => {
    const Real = window.WebSocket;
    class Slow extends Real {
      private handler: ((e: MessageEvent) => void) | null = null;
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        super.addEventListener("message", (e) => setTimeout(() => this.handler?.call(this, e), delay));
      }
      set onmessage(f: ((e: MessageEvent) => void) | null) {
        this.handler = f;
      }
      get onmessage() {
        return this.handler;
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        setTimeout(() => {
          if (this.readyState === Real.OPEN) super.send(data);
        }, delay);
      }
    }
    window.WebSocket = Slow as unknown as typeof WebSocket;
  }, ms);
}

test("on a slow connection a putt plays at once and the ball never jumps, even as the snapshot changes", async ({ context }) => {
  test.setTimeout(120_000);
  const player = await createPlayer("Shlok");
  const page = await phone(context, { player, notifications: "granted" });
  await enablePush(page);
  await slowConnection(page, 600);
  await page.goto("/golf/plains/3");
  await expect(page.getByLabel("Tilt, hole 3", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 30_000 });

  const from = () => page.evaluate(() => (window as unknown as { __golf: { from(): number } }).__golf.from());
  let was = -1;
  for (let i = 0; i < 3; i++) {
    // Wait for the ball to stop and for the server's snapshot of that to reach the phone: the moment the
    // phone is between subscriptions, which on this connection lasts over a second.
    if (i > 0) await expect.poll(from, { timeout: 20_000, intervals: [5] }).not.toBe(was);
    was = await from();
    const result = await page.evaluate(
      ([angle]) =>
        new Promise<{ movedAfter: number | null; biggest: number }>((done) => {
          const g = (window as unknown as { __golf: { drawn(): { x: number; y: number }; shoot(a: number, p: number): void } }).__golf;
          const start = g.drawn();
          g.shoot(angle, 0.14);
          const t0 = performance.now();
          let movedAfter: number | null = null, biggest = 0, last = start;
          const frame = () => {
            const at = g.drawn();
            biggest = Math.max(biggest, Math.hypot(at.x - last.x, at.y - last.y));
            last = at;
            if (movedAfter === null && Math.hypot(at.x - start.x, at.y - start.y) > 0.05) movedAfter = performance.now() - t0;
            if (performance.now() - t0 > 1500) done({ movedAfter, biggest });
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
      [i % 2 ? 0 : Math.PI],
    );
    console.log(`putt ${i + 1}: moved after ${result.movedAfter}ms, biggest step ${result.biggest.toFixed(2)}`);
    // Moving within a few frames, not a round trip later.
    expect(result.movedAfter).not.toBeNull();
    expect(result.movedAfter!).toBeLessThan(250);
    // Gliding: never more than a step of a fast ball in one frame.
    expect(result.biggest).toBeLessThan(1.5);
  }
});

test("on a slow connection, sinking one still shows the score", async ({ context }) => {
  test.setTimeout(90_000);
  const player = await createPlayer("Shlok");
  const page = await phone(context, { player, notifications: "granted" });
  await enablePush(page);
  await slowConnection(page, 600);
  await page.goto("/golf/plains/1");
  await expect(page.getByLabel("Hello, hole 1", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 30_000 });
  // Alone on the hole, so the solver's line.
  const [angle, power] = SOLUTIONS["plains-1"][0];
  await shoot(page, angle, power);
  await expect(page.getByRole("dialog", { name: "Hole finished" }).getByRole("heading", { name: "Hole in one" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await balls(page))[0].holes, { timeout: 15_000 }).toBe(1);
});

test("moving obstacles keep moving while your ball sits still", async ({ context }) => {
  const player = await createPlayer("Shlok");
  const page = await phone(context, { player, notifications: "granted" });
  await enablePush(page);
  await page.goto("/golf/cold/7");
  await expect(page.getByLabel("Avalanche, hole 7", { exact: true })).toBeVisible();
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  // What they're drawn from: a ball that's still, on a clock that isn't.
  const first = (await balls(page))[0];
  expect(first.mode).toBe("aim");
  await page.waitForTimeout(1500);
  const later = (await balls(page))[0];
  expect(later.mode).toBe("aim");
  expect(later.t - first.t).toBeGreaterThan(1);
});
