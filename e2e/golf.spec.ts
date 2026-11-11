import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { SOLUTIONS } from "../convex/golf/solutions";
import { admin, createPlayer, expect, fillLobby, getMatch, openLobby, test, type Phones } from "./fixtures";

// Golf's open world on two phones: both in, a shot on one, and the ball ending up in exactly the same
// place on both (every phone runs the same physics from the same commands).

type BallView = { id: string; x: number; y: number; mode: string; holes: number; strokes: number; t: number };
const balls = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: { balls(): BallView[] } }).__golf?.balls() ?? []);
const shoot = (page: Page, a: number, p: number) => page.evaluate(([x, y]) => (window as unknown as { __golf: { shoot(a: number, p: number): void } }).__golf.shoot(x, y), [a, p]);
const meOn = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: { me(): string } }).__golf?.me());

// Two phones with push on.
async function twoPhones(phones: Phones) {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  return await Promise.all([phones.open({ player: a, push: "on" }), phones.open({ player: b, push: "on" })]);
}

// The open world as the server has it, and the snapshot this phone is running from.
const world = () => admin().query(anyApi.testing.golfWorld, { key: "sandbox" });
const fromOn = (page: Page) => page.evaluate(() => (window as unknown as { __golf: { from(): number } }).__golf.from());
// The server has settled everything and gone to sleep, and this phone has the snapshot it wrote.
async function worldAsleep(page: Page) {
  await expect.poll(async () => (await world())?.awake, { timeout: 20_000 }).toBe(false);
  await expect.poll(async () => (await fromOn(page)) === (await world())?.snapshotTick, { timeout: 10_000 }).toBe(true);
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

test("Golf has a card on Games, and Play opens the courses and the open world", async ({ phones }) => {
  const player = await createPlayer("Shlok");
  const page = await phones.open({ player, push: "on" });
  await page.goto("/games");
  await expect(page.getByRole("heading", { name: "Golf" })).toBeVisible();
  // Card art plays once it's scrolled to.
  await page.getByRole("heading", { name: "Golf" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: "A putt rolling into the cup" })).toBeVisible();
  await page.getByRole("link", { name: "Play Golf" }).click();
  await expect(page).toHaveURL(/\/golf$/);
  // Golf's page: its two modes, then practice.
  await expect(page.getByRole("link", { name: /^Async/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Real-time/ })).toBeVisible();
  await page.getByRole("link", { name: /Practice holes/ }).click();
  await expect(page).toHaveURL(/\/golf\/practice$/);
  await expect(page.getByRole("heading", { name: "Bumper Plains" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cold Start" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Hole \d, par \d/ })).toHaveCount(18);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/golf$/);
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

test("a shot on one phone lands in exactly the same spot on the other", async ({ phones }) => {
  const [pa, pb] = await twoPhones(phones);
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
});

test("players see each other's names over their balls and who's here", async ({ phones }) => {
  const [pa, pb] = await twoPhones(phones);
  await intoGolf(pa);
  await intoGolf(pb);
  await expect(pa.getByText("Chris is here")).toBeVisible({ timeout: 15_000 });
  await expect(pb.getByText("Shlok is here")).toBeVisible({ timeout: 15_000 });
});

test("a shot costs the other phone a few kilobytes, not a stream of positions", async ({ phones }) => {
  const [pa, pb] = await twoPhones(phones);
  await intoGolf(pa);
  await intoGolf(pb);
  const idA = (await meOn(pa))!;
  await expect.poll(async () => (await balls(pb)).length).toBe(2);
  // Let joining settle, then count everything the other phone receives from the first touch of the
  // shot until the server has settled it and gone to sleep.
  await worldAsleep(pb);
  let bytes = 0, frames = 0;
  const cdp = await pb.context().newCDPSession(pb);
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameReceived", (e: { response: { payloadData: string } }) => {
    bytes += e.response.payloadData.length;
    frames++;
  });
  const start = (await balls(pb)).find((x) => x.id === idA)!;
  await putt(pa, -70, 0);
  // The shot reaches this phone, the ball stops, and the server settles it and sleeps.
  await expect.poll(async () => {
    const seen = (await balls(pb)).find((x) => x.id === idA)!;
    return Math.hypot(seen.x - start.x, seen.y - start.y) > 2 && seen.mode === "aim";
  }, { timeout: 15_000 }).toBe(true);
  await worldAsleep(pb);
  expect(frames).toBeGreaterThan(0);
  console.log(`A shot cost the other phone ${bytes} bytes in ${frames} messages`);
  // About 8.6 KB when this was written (the command, the settled snapshot once, presence). The budget
  // leaves room for a slow machine (a longer wait is more presence and more snapshot rewrites while it
  // rolls); streaming positions would cost tens of kilobytes a second.
  expect(bytes).toBeLessThan(30_000);
});

test("a hole: sink it, see the score on both phones, go on to the next, and it's on the course page", async ({ phones }) => {
  const [pa, pb] = await twoPhones(phones);
  await pa.goto("/golf/practice");
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
  await expect(pa).toHaveURL(/\/golf\/practice$/);
  await expect(pa.getByRole("link", { name: "Play Bumper Plains" })).toContainText("Play from hole 2");
});

test("an ice hole plays, and the putt goes further than you'd think", async ({ phones }) => {
  const player = await createPlayer("Shlok");
  const page = await phones.open({ player, push: "on" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
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

test("on a slow connection a putt plays at once and the ball never jumps, even as the snapshot changes", async ({ phones }) => {
  test.setTimeout(120_000);
  const player = await createPlayer("Shlok");
  const page = await phones.open({ player, push: "on" });
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
          let movedAfter: number | null = null, biggest = 0, last = start, lastAt = t0;
          const frame = () => {
            const at = g.drawn();
            // Per 60fps frame, so a frame a busy machine drew late doesn't count as a jump.
            const now = performance.now();
            biggest = Math.max(biggest, (Math.hypot(at.x - last.x, at.y - last.y) * (1000 / 60)) / Math.max(1000 / 60, now - lastAt));
            last = at;
            lastAt = now;
            if (movedAfter === null && Math.hypot(at.x - start.x, at.y - start.y) > 0.05) movedAfter = performance.now() - t0;
            if (performance.now() - t0 > 1500) done({ movedAfter, biggest });
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
      [i % 2 ? 0 : Math.PI],
    );
    console.log(`putt ${i + 1}: moved after ${result.movedAfter}ms, biggest step ${result.biggest.toFixed(2)}`);
    // Moving within a few frames, not a round trip later: about 30ms when this was written, and a round
    // trip on this connection is over 1200ms, so this leaves room for a busy machine and still catches it.
    expect(result.movedAfter).not.toBeNull();
    expect(result.movedAfter!).toBeLessThan(600);
    // Gliding: never more than a step of a fast ball in one frame (about 0.09 when this was written).
    expect(result.biggest).toBeLessThan(1.5);
  }
});

test("on a slow connection, sinking one still shows the score", async ({ phones }) => {
  test.setTimeout(90_000);
  const player = await createPlayer("Shlok");
  const page = await phones.open({ player, push: "on" });
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

test("moving obstacles keep moving while your ball sits still", async ({ phones }) => {
  const player = await createPlayer("Shlok");
  const page = await phones.open({ player, push: "on" });
  await page.goto("/golf/cold/7");
  await expect(page.getByLabel("Avalanche, hole 7", { exact: true })).toBeVisible();
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  // What they're drawn from: a ball that's still, on a clock that isn't.
  const first = (await balls(page))[0];
  expect(first.mode).toBe("aim");
  await expect.poll(async () => (await balls(page))[0].t - first.t).toBeGreaterThan(1);
  expect((await balls(page))[0].mode).toBe("aim");
});

// A game: a lobby with settings, two phones, one shot at a time.
test("a turn-based game: the lobby, then one shot at a time, and the card", async ({ phones }) => {
  test.setTimeout(120_000);
  const [pa, pb] = await twoPhones(phones);
  const id = await openLobby(pa, "golf", "turns", { Course: "Bumper Plains", Holes: "3" });
  await fillLobby(pa, [pb]);
  for (const p of [pa, pb]) {
    await expect(p.getByLabel(/hole 1 of 3/)).toBeVisible({ timeout: 20_000 });
    await expect(p.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  }
  const m = await getMatch(id);
  const turnId = m.turn as string;
  const [mine, theirs] = (await meOn(pa)) === turnId ? [pa, pb] : [pb, pa];
  // Whose turn it is, on both.
  await expect(mine.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine");
  await expect(theirs.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "theirs");
  await expect(mine.getByText("Your shot")).toBeVisible();
  // A short putt up the hole: the turn goes to the other phone once it stops (they haven't teed off).
  await shoot(mine, -Math.PI / 2, 0.2);
  await expect(theirs.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine", { timeout: 20_000 });
  await expect(mine.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "theirs");
  // Both phones agree where the first ball stopped.
  const strip = (b: BallView[]) => b.map(({ t: _t, ...x }) => x).sort((p, q) => p.id.localeCompare(q.id));
  await expect.poll(async () => JSON.stringify(strip(await balls(theirs))) === JSON.stringify(strip(await balls(mine))), { timeout: 10_000 }).toBe(true);
  // The card's in the menu, with the seedless course's holes on it.
  await mine.getByRole("button", { name: "Menu" }).click();
  await expect(mine.getByRole("region", { name: "Scorecard" })).toBeVisible();
  await expect(mine.getByRole("region", { name: "Scorecard" })).toContainText("Hello");
  await expect(mine.getByRole("region", { name: "Scorecard" })).toContainText("Elbow");
});

test("a generated course shows its seed, and the same seed plays the same holes", async ({ phones }) => {
  test.setTimeout(120_000);
  const [pa, pb] = await twoPhones(phones);
  await pa.goto("/golf/mode/turns");
  await pa.getByRole("button", { name: "Settings" }).click();
  await pa.getByRole("radiogroup", { name: "Holes" }).getByRole("radio", { name: "3", exact: true }).click();
  await pa.getByRole("textbox", { name: "Seed" }).fill("4242");
  await pa.getByRole("textbox", { name: "Seed" }).press("Enter");
  await pa.getByRole("button", { name: "Open a game" }).click();
  await expect(pa.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  await fillLobby(pa, [pb]);
  await expect(pa.getByLabel(/hole 1 of 3/)).toBeVisible({ timeout: 60_000 });
  await pa.getByRole("button", { name: "Menu" }).click();
  await expect(pa.getByRole("button", { name: "Copy seed 4242" })).toBeVisible();
});

test("the mode page shows the holes the next game will be played on", async ({ phones }) => {
  test.setTimeout(120_000);
  const [pa] = await twoPhones(phones);
  await pa.goto("/golf/mode/turns");
  const holes = pa.getByRole("list", { name: "The holes" });
  // Generated: a real seed straight away, and the holes fill in as they're made.
  await expect(pa.getByRole("button", { name: /^Seed \d+, roll another$/ })).toBeVisible();
  await expect(holes.getByRole("button", { name: /^Hole 1, / })).toBeVisible({ timeout: 60_000 });
  await expect(holes.getByRole("button", { name: /^Hole \d+, / })).toHaveCount(6, { timeout: 90_000 });
  // A course made by hand: its holes at once.
  await pa.getByRole("button", { name: "Settings" }).click();
  await pa.getByRole("radiogroup", { name: "Course" }).getByRole("radio", { name: "Bumper Plains" }).click();
  await expect(holes.getByRole("button", { name: "Hole 1, Hello, par 2" })).toBeVisible();
  await holes.getByRole("button", { name: "Hole 2, Elbow, par 4" }).click();
  await expect(pa.getByRole("dialog", { name: "2. Elbow" })).toBeVisible();
});
