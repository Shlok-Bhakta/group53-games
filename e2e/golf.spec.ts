import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { SOLUTIONS } from "../convex/golf/solutions";
import { admin, createPlayer, expect, fillLobby, getMatch, holdsStill, matchIdOf, openLobby, resign, test, type Phones } from "./fixtures";
import { LANDSCAPE, PORTRAIT, SAFE_LANDSCAPE, SAFE_PORTRAIT, expectFitsScreen, simulateSafeAreas } from "./landscape";

type BallView = { id: string; x: number; y: number; mode: string; holes: number; strokes: number; t: number };
const balls = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: { balls(): BallView[] } }).__golf?.balls() ?? []);
const shoot = (page: Page, a: number, p: number) =>
  page.evaluate(([x, y]) => (window as unknown as { __golf: { shoot(a: number, p: number): void } }).__golf.shoot(x, y), [a, p]);
const cameraOn = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __golf: { camera(): { x: number; y: number; s: number; ox: number; oy: number } } }).__golf.camera(),
  );
async function teedUp(page: Page) {
  await expect
    .poll(async () => {
      const me = await meOn(page);
      return (await balls(page)).find((b) => b.id === me)?.mode;
    })
    .toBe("aim");
}
const meOn = (page: Page) => page.evaluate(() => (window as unknown as { __golf?: { me(): string } }).__golf?.me());

async function twoPhones(phones: Phones) {
  const [a, b] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  return await Promise.all([phones.open({ player: a, push: "on" }), phones.open({ player: b, push: "on" })]);
}

const world = () => admin().query(anyApi.testing.golfWorld, { key: "sandbox" });
const fromOn = (page: Page) => page.evaluate(() => (window as unknown as { __golf: { from(): number } }).__golf.from());
async function worldAsleep(page: Page) {
  await expect.poll(async () => (await world())?.awake, { timeout: 20_000 }).toBe(false);
  await expect.poll(async () => (await fromOn(page)) === (await world())?.snapshotTick, { timeout: 10_000 }).toBe(true);
}

async function intoGolf(page: Page) {
  await page.goto("/golf/world");
  await expect(page.getByLabel("Driftwood Bay, an open course")).toBeVisible();
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
}

async function putt(page: Page, dx: number, dy: number) {
  const box = (await page.getByLabel("Driftwood Bay, an open course").boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
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
  await page.getByRole("heading", { name: "Golf" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: "A putt rolling into the cup" })).toBeVisible();
  await page.getByRole("link", { name: "Play Golf" }).click();
  await expect(page).toHaveURL(/\/golf$/);
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
  await expect.poll(async () => (await balls(pa)).length).toBe(2);
  await expect.poll(async () => (await balls(pb)).length).toBe(2);
  const start = (await balls(pb)).find((x) => x.id === idA)!;

  await putt(pa, -70, 0);
  await expect.poll(async () => (await balls(pa)).find((x) => x.id === idA)?.mode, { timeout: 5000 }).toBe("roll");
  await expect
    .poll(
      async () => {
        const seen = (await balls(pb)).find((x) => x.id === idA)!;
        return Math.hypot(seen.x - start.x, seen.y - start.y) > 2 && seen.mode === "aim";
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect.poll(async () => (await balls(pa)).find((x) => x.id === idA)?.mode, { timeout: 15_000 }).toBe("aim");

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
  await worldAsleep(pb);
  let bytes = 0,
    frames = 0;
  const cdp = await pb.context().newCDPSession(pb);
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameReceived", (e: { response: { payloadData: string } }) => {
    bytes += e.response.payloadData.length;
    frames++;
  });
  const start = (await balls(pb)).find((x) => x.id === idA)!;
  await putt(pa, -70, 0);
  await expect
    .poll(
      async () => {
        const seen = (await balls(pb)).find((x) => x.id === idA)!;
        return Math.hypot(seen.x - start.x, seen.y - start.y) > 2 && seen.mode === "aim";
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await worldAsleep(pb);
  expect(frames).toBeGreaterThan(0);
  console.log(`A shot cost the other phone ${bytes} bytes in ${frames} messages`);
  expect(bytes).toBeLessThan(30_000);
});

test("a hole: sink it, see the score on both phones, go on to the next, and it's on the course page", async ({ phones }) => {
  const [pa, pb] = await twoPhones(phones);
  await pa.goto("/golf/practice");
  await pa.getByRole("link", { name: "Hello, Hole 1, par 2" }).click();
  await expect(pa.getByLabel("Hello, hole 1", { exact: true })).toBeVisible();
  await expect(pa.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  await expect(pa.getByText("Hole 1, par 2").last()).toBeVisible();
  await pb.goto("/golf/plains/1");
  await expect(pb.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => (await balls(pa)).length).toBe(2);
  await expect(pa.getByRole("button", { name: "See the whole map" })).toHaveCount(0);

  await expect.poll(async () => (await balls(pa)).every((x) => x.mode === "aim")).toBe(true);
  await shoot(pa, -2.78, 0.84);
  const sheet = pa.getByRole("dialog", { name: "Hole finished" });
  await Promise.all([
    (async () => {
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await expect(sheet.getByRole("heading", { name: "Hole in one" })).toBeVisible();
      await expect(sheet.getByText("Shlok")).toBeVisible({ timeout: 15_000 });
    })(),
    expect(pb.getByText("Shlok sank one"), "the toast on the other phone, caught before it fades").toBeVisible({ timeout: 20_000 }),
  ]);

  await sheet.getByRole("button", { name: "Next hole" }).click();
  await expect(pa).toHaveURL(/\/golf\/plains\/2$/);
  await expect(pa.getByLabel("Elbow, hole 2", { exact: true })).toBeVisible();
  await expect(pa.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
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
  expect(me[0].y - (await balls(page))[0].y).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

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
    if (i > 0) await expect.poll(from, { timeout: 20_000, intervals: [5] }).not.toBe(was);
    was = await from();
    const result = await page.evaluate(
      ([angle]) =>
        new Promise<{ movedAfter: number | null; biggest: number }>((done) => {
          const g = (window as unknown as { __golf: { drawn(): { x: number; y: number }; shoot(a: number, p: number): void } }).__golf;
          const start = g.drawn();
          g.shoot(angle, 0.14);
          const t0 = performance.now();
          let movedAfter: number | null = null,
            biggest = 0,
            last = start,
            lastAt = t0;
          const frame = () => {
            const at = g.drawn();
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
    expect(result.movedAfter).not.toBeNull();
    expect(result.movedAfter!).toBeLessThan(600);
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
  const [angle, power] = SOLUTIONS["plains-1"][0];
  await shoot(page, angle, power);
  await expect(page.getByRole("dialog", { name: "Hole finished" }).getByRole("heading", { name: "Hole in one" })).toBeVisible({
    timeout: 15_000,
  });
  await expect.poll(async () => (await balls(page))[0].holes, { timeout: 15_000 }).toBe(1);
});

test("moving obstacles keep moving while your ball sits still", async ({ phones }) => {
  const player = await createPlayer("Shlok");
  const page = await phones.open({ player, push: "on" });
  await page.goto("/golf/cold/7");
  await expect(page.getByLabel("Avalanche, hole 7", { exact: true })).toBeVisible();
  await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  const first = (await balls(page))[0];
  expect(first.mode).toBe("aim");
  await expect.poll(async () => (await balls(page))[0].t - first.t).toBeGreaterThan(1);
  expect((await balls(page))[0].mode).toBe("aim");
});

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
  await expect(mine.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine");
  await expect(theirs.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "theirs");
  await expect(mine.getByText("Your shot")).toBeVisible();
  const ring = theirs.getByRole("button", { name: "Scorecard" }).locator(".pa[data-seat]");
  await expect(ring).toHaveCount(1);
  expect(await ring.evaluate((el) => el.parentElement?.getAttribute("aria-label"))).toBe("Scorecard");
  await shoot(mine, -Math.PI / 2, 0.2);
  await expect(theirs.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine", { timeout: 20_000 });
  await expect(mine.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "theirs");
  const strip = (b: BallView[]) => b.map(({ t: _t, ...x }) => x).sort((p, q) => p.id.localeCompare(q.id));
  await expect
    .poll(async () => JSON.stringify(strip(await balls(theirs))) === JSON.stringify(strip(await balls(mine))), { timeout: 10_000 })
    .toBe(true);
  await mine.getByRole("button", { name: "Menu" }).click();
  await expect(mine.getByRole("region", { name: "Scorecard" })).toBeVisible();
  await expect(mine.getByRole("region", { name: "Scorecard" })).toContainText("Hello");
  await expect(mine.getByRole("region", { name: "Scorecard" })).toContainText("Elbow");
});

test("opening a turn-based game again plays back the shots you missed, then goes live", async ({ phones }) => {
  test.setTimeout(150_000);
  const [pa, pb] = await twoPhones(phones);
  const id = await openLobby(pa, "golf", "turns", { Course: "Bumper Plains", Holes: "3" });
  await fillLobby(pa, [pb]);
  for (const p of [pa, pb]) {
    await expect(p.getByLabel(/hole 1 of 3/)).toBeVisible({ timeout: 30_000 });
    await expect(p.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
  }
  const m = await getMatch(id);
  const [mine, theirs] = (await meOn(pa)) === (m.turn as string) ? [pa, pb] : [pb, pa];
  await expect(mine.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine");
  const name = mine === pa ? "Shlok" : "Chris";
  await expect.poll(() => theirs.evaluate((k) => localStorage.getItem(k), `golf-seen:${id}`), { timeout: 15_000 }).not.toBeNull();
  const url = theirs.url();
  await theirs.goto("/");
  await shoot(mine, -Math.PI / 2, 0.35);
  await expect.poll(async () => (await getMatch(id)).turn, { timeout: 30_000 }).not.toBe(m.turn);
  await theirs.goto(url);
  await expect(theirs.getByRole("status").filter({ hasText: "Catching up" })).toBeVisible({ timeout: 20_000 });
  await expect(theirs.getByRole("button", { name: "Scorecard" })).toContainText(`${name}'s shot`);
  await expect(theirs.getByRole("status").filter({ hasText: "Catching up" })).toHaveCount(0, { timeout: 30_000 });
  await expect(theirs.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine");
  const strip = (b: BallView[]) => b.map(({ t: _t, ...x }) => x).sort((p, q) => p.id.localeCompare(q.id));
  await expect
    .poll(async () => JSON.stringify(strip(await balls(theirs))) === JSON.stringify(strip(await balls(mine))), { timeout: 10_000 })
    .toBe(true);
  await theirs.goto("/");
  await theirs.goto(url);
  await expect(theirs.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine", { timeout: 20_000 });
  await expect(theirs.getByRole("status").filter({ hasText: "Catching up" })).toHaveCount(0);
  await shoot(theirs, -Math.PI / 2, 0.35);
  await expect(theirs.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "theirs", { timeout: 30_000 });
  const seenNow = () => theirs.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.tick ?? -1, `golf-seen:${id}`);
  const after = await seenNow();
  await expect.poll(seenNow, { timeout: 10_000 }).toBeGreaterThan(after);
  await theirs.goto("/");
  await expect(mine.getByLabel(/hole 1 of 3/)).toHaveAttribute("data-turn", "mine", { timeout: 30_000 });
  const moves = (await getMatch(id)).moveCount;
  await shoot(mine, -Math.PI / 2, 0.2);
  await expect.poll(async () => (await getMatch(id)).moveCount, { timeout: 30_000 }).toBeGreaterThan(moves);
  await mine.getByRole("button", { name: "Menu" }).click();
  await resign(mine);
  await expect.poll(async () => (await getMatch(id)).status, { timeout: 15_000 }).toBe("finished");
  await theirs.goto(url);
  await expect(theirs.getByRole("status").filter({ hasText: "Catching up" })).toBeVisible({ timeout: 20_000 });
  await expect(theirs.getByRole("button", { name: "Scorecard" })).toContainText(`${name}'s shot`);
  await expect(theirs.getByRole("region", { name: "Result" })).toBeVisible({ timeout: 30_000 });
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
  await expect(pa.getByRole("list", { name: "The holes" }).getByRole("button", { name: /^Hole 1, / })).toBeVisible({ timeout: 60_000 });
  await pb.goto(`/golf/${matchIdOf(pa)}?accept=1`);
  await expect(pb.getByRole("list", { name: "The holes" }).getByRole("button", { name: /^Hole 1, / })).toBeVisible({ timeout: 60_000 });
  await expect(pb.getByText("Seed 4242").first()).toBeVisible();
  await pa.getByRole("button", { name: "Start with 2" }).click();
  await expect(pa.getByLabel(/hole 1 of 3/)).toBeVisible({ timeout: 60_000 });
  await pa.getByRole("button", { name: "Menu" }).click();
  await expect(pa.getByRole("button", { name: "Copy seed 4242" })).toBeVisible();
});

test("the mode page shows the holes the next game will be played on", async ({ phones }) => {
  test.setTimeout(120_000);
  const [pa] = await twoPhones(phones);
  await pa.goto("/golf/mode/turns");
  const holes = pa.getByRole("list", { name: "The holes" });
  await expect(pa.getByRole("button", { name: /^Seed \d+, roll another$/ })).toBeVisible();
  await expect(holes.getByRole("button", { name: /^Hole 1, / })).toBeVisible({ timeout: 60_000 });
  await expect(holes.getByRole("button", { name: /^Hole \d+, / })).toHaveCount(6, { timeout: 90_000 });
  await pa.getByRole("button", { name: "Settings" }).click();
  await pa.getByRole("radiogroup", { name: "Course" }).getByRole("radio", { name: "Bumper Plains" }).click();
  await expect(holes.getByRole("button", { name: "Hole 1, Hello, par 2" })).toBeVisible();
  await holes.getByRole("button", { name: "Hole 2, Elbow, par 4" }).click();
  await expect(pa.getByRole("dialog", { name: "2. Elbow" })).toBeVisible();
});

test.describe("landscape", () => {
  async function inLandscape(page: Page, path: string) {
    await page.setViewportSize(LANDSCAPE);
    await page.goto("/");
    await simulateSafeAreas(page, SAFE_LANDSCAPE);
    await page.goto(path);
    await expect(page.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
    await holdsStill(page);
  }
  async function turnTo(page: Page, to: "portrait" | "landscape") {
    await simulateSafeAreas(page, to === "landscape" ? SAFE_LANDSCAPE : SAFE_PORTRAIT);
    await page.setViewportSize(to === "landscape" ? LANDSCAPE : PORTRAIT);
  }
  async function besideTheRail(page: Page) {
    const back = (await page.getByRole("button", { name: "Back", exact: true }).boundingBox())!;
    const rail = (await page.locator("[data-floating-bar]").boundingBox())!;
    expect(rail.height, "the top bar is a rail down the left").toBeGreaterThan(rail.width);
    expect(back.x).toBeLessThan(LANDSCAPE.width / 4);
    const cam = await cameraOn(page);
    const open = { left: rail.x + rail.width, right: LANDSCAPE.width - SAFE_LANDSCAPE.right };
    expect(cam.ox, "the hole is framed in the open part, right of the rail").toBeGreaterThan(open.left);
    expect(Math.abs(cam.ox - (rail.x + rail.width + LANDSCAPE.width) / 2), "centred in it").toBeLessThan(2);
    return rail;
  }

  test("a practice hole and its result fit, with the hole framed beside the rail", async ({ phones }) => {
    const player = await createPlayer("Shlok");
    const page = await phones.open({ player, push: "on" });
    await inLandscape(page, "/golf/plains/1");
    await expect(page.getByLabel("Hello, hole 1", { exact: true })).toBeVisible();
    await expectFitsScreen(page);
    const rail = await besideTheRail(page);
    const reset = (await page.getByRole("button", { name: "Start the hole again" }).boundingBox())!;
    expect(reset.x, "the dock sits beside the rail").toBeGreaterThan(rail.x + rail.width);
    const [angle, power] = SOLUTIONS["plains-1"][0];
    await teedUp(page);
    await shoot(page, angle, power);
    const sheet = page.getByRole("dialog", { name: "Hole finished" });
    await expect(sheet.getByRole("heading", { name: "Hole in one" })).toBeVisible({ timeout: 15_000 });
    await holdsStill(page);
    await expectFitsScreen(page);
    const box = (await sheet.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(LANDSCAPE.height);
  });

  test("the open world: items, the whole map, and turning the phone", async ({ phones }) => {
    const player = await createPlayer("Shlok");
    const page = await phones.open({ player, push: "on" });
    await inLandscape(page, "/golf/world");
    await expectFitsScreen(page);
    await besideTheRail(page);
    await page.getByRole("button", { name: "See the whole map" }).click();
    await holdsStill(page);
    await expectFitsScreen(page);
    await page.getByRole("button", { name: "Follow my ball" }).click();
    await turnTo(page, "portrait");
    await expect
      .poll(async () => (await cameraOn(page)).ox, { message: "back to the middle of the screen" })
      .toBeCloseTo(PORTRAIT.width / 2, 0);
    await turnTo(page, "landscape");
    await holdsStill(page);
    await besideTheRail(page);
  });

  test("a game: the turn in the rail, the menu, and the card", async ({ phones }) => {
    test.setTimeout(120_000);
    const [pa, pb] = await twoPhones(phones);
    await openLobby(pa, "golf", "turns", { Course: "Bumper Plains", Holes: "3" });
    await fillLobby(pa, [pb]);
    await expect(pa.getByLabel(/hole 1 of 3/)).toBeVisible({ timeout: 20_000 });
    await turnTo(pa, "landscape");
    await expect(pa.getByText("Teeing up")).toHaveCount(0, { timeout: 15_000 });
    await holdsStill(pa);
    await expectFitsScreen(pa);
    const rail = await besideTheRail(pa);
    const menu = (await pa.getByRole("button", { name: "Menu" }).boundingBox())!;
    expect(menu.y + menu.height, "the menu at the foot of the rail").toBeGreaterThan(rail.y + rail.height - 60);
    await pa.getByRole("button", { name: "Menu" }).click();
    await expect(pa.getByRole("region", { name: "Scorecard" })).toBeVisible();
    await holdsStill(pa);
    await expectFitsScreen(pa);
  });
});
