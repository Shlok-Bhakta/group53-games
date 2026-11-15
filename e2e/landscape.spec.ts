import { createPlayer, expect, holdsStill, openLobby, ready, test } from "./fixtures";
import { LANDSCAPE, SAFE_LANDSCAPE, SAFE_PORTRAIT, barGap, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

test.describe("landscape", () => {
  test("the tabs fit a phone on its side", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    await createPlayer("Chris", { tagline: "Certified word guesser", badge: "🐐" });
    const page = await phones.open({ player: me, push: "on" });
    await page.setViewportSize(LANDSCAPE);
    await page.goto("/");
    await simulateSafeAreas(page, SAFE_LANDSCAPE);
    for (const path of ["/", "/games", "/crew", "/you"]) {
      await page.goto(path);
      await ready(page);
      await expectFitsScreen(page);
    }
  });

  test("a mode page and a lobby fit", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.setViewportSize(LANDSCAPE);
    await page.goto("/");
    await simulateSafeAreas(page, SAFE_LANDSCAPE);
    await page.goto("/scrabble/mode/classic");
    await ready(page);
    await expectFitsScreen(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await holdsStill(page);
    await expectFitsScreen(page);

    await openLobby(page, "scrabble", "classic");
    await ready(page);
    await expectFitsScreen(page);
  });

  test("a sheet fits, with its body scrolling inside it", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    await createPlayer("Chris", { tagline: "Certified word guesser", badge: "🐐" });
    const page = await phones.open({ player: me, push: "on" });
    await page.setViewportSize(LANDSCAPE);
    await page.goto("/");
    await simulateSafeAreas(page, SAFE_LANDSCAPE);
    await page.goto("/crew");
    await ready(page);
    await page.getByRole("button", { name: /Certified word guesser/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("link", { name: "Stonks profile" })).toBeVisible();
    await holdsStill(page);
    await expectFitsScreen(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await page.goto("/you");
    await ready(page);
    await page.getByRole("button", { name: /^Theme/ }).click();
    await expect(page.getByRole("dialog", { name: "Theme" })).toBeVisible();
    await holdsStill(page);
    await expectFitsScreen(page);
  });
});

test.describe("the tab bar stays on the bottom edge", () => {
  test("through rotations and a resize", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/");
    await simulateSafeAreas(page, SAFE_PORTRAIT);
    await ready(page);
    await expect.poll(() => barGap(page)).toBe(0);
    for (const to of ["landscape", "portrait", "landscape", "portrait"] as const) {
      await rotate(page, to);
      await expect.poll(() => barGap(page), `after turning to ${to}`).toBe(0);
    }
    await page.setViewportSize({ width: 393, height: 700 });
    await expect.poll(() => barGap(page), "after the viewport shrinks").toBe(0);
    await page.setViewportSize({ width: 393, height: 852 });
    await expect.poll(() => barGap(page), "after it grows back").toBe(0);
  });

  test("when the layout viewport goes stale, the bar follows the visual one down", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/");
    await ready(page);
    const nav = page.locator("nav[aria-label='Main']");
    const stale = 120;
    await page.evaluate((extra) => {
      const vv = window.visualViewport!;
      const height = vv.height;
      Object.defineProperty(vv, "height", { configurable: true, get: () => height + extra });
      vv.dispatchEvent(new Event("resize"));
    }, stale);
    await expect(page.locator("html")).toHaveAttribute("data-viewport-gap", String(stale));
    await expect.poll(() => barGap(page), "the bar sits on the visual viewport's bottom").toBe(0);
    await expect.poll(() => nav.evaluate((n) => Math.round(n.getBoundingClientRect().bottom - window.innerHeight))).toBe(stale);

    await page.evaluate(() => {
      const vv = window.visualViewport!;
      delete (vv as unknown as Record<string, unknown>).height;
      vv.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-viewport-gap", "0");
    await expect.poll(() => barGap(page)).toBe(0);
  });
});
