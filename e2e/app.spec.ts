import AxeBuilder from "@axe-core/playwright";
import { anyApi } from "convex/server";
import { admin, createPlayer, expect, onScreen, ready, test } from "./fixtures";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

test.describe("install gate", () => {
  test("iPhone in Safari gets Add to Home Screen steps and no way in", async ({ phones }) => {
    const page = await phones.open({ installed: false });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Put Group 53 on your home screen" })).toBeVisible();
    await expect(page.getByText("Add to Home Screen")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toHaveCount(0);
  });

  test("Android in Chrome gets Chrome menu steps", async ({ phones }) => {
    const page = await phones.open({ installed: false, context: { userAgent: ANDROID_UA, viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } });
    await page.goto("/");
    await expect(page.getByText("Add to Home screen")).toBeVisible();
  });

  test("in-app browsers are told to open Safari", async ({ phones }) => {
    const page = await phones.open({
      installed: false,
      context: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Discord/250.0",
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
      },
    });
    await page.goto("/");
    await expect(page.getByText("Open in Safari")).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("installed app shows Discord sign-in, which starts the OAuth flow", async ({ phones }) => {
    const page = await phones.open();
    await page.goto("/");
    const button = page.getByRole("button", { name: "Sign in with Discord" });
    await expect(button).toBeVisible();
    const [request] = await Promise.all([page.waitForRequest((r) => r.url().includes("/api/auth/signin/discord")), button.click()]);
    expect(request.url()).toContain("redirectTo=");
    await expect(page.getByRole("button", { name: "Ada", exact: true })).toHaveCount(0);
  });
});

test.describe("updates", () => {
  test("a new build covers the app with Updating, reloads, and says so when it's back", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    const real = (await (await page.request.get("/version.json")).json()).id as string;
    // Pretend a newer build just went out.
    await page.route("**/version.json*", (r) => r.fulfill({ json: { id: "newer-build" } }));
    await page.getByRole("link", { name: "Games" }).click();
    await expect(page.getByRole("status", { name: "Updating" })).toBeVisible();
    await page.waitForEvent("load");
    // The reload didn't land on the new build (it doesn't exist), so it offers instead of looping.
    await expect(page.getByText("A new version is ready")).toBeVisible();
    await page.unroute("**/version.json*");
    // Back on the build it was updating to: a little "you're up to date".
    await page.evaluate((id) => sessionStorage.setItem("updating-to", id), real);
    await page.reload();
    await expect(page.getByText("You're up to date")).toBeVisible();
    await expect(page.getByText("You're up to date")).toHaveCount(0, { timeout: 6000 });
  });
});

test.describe("signed in", () => {
  test("games stay locked until notifications are on, then unlock in one tap", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/games");
    await expect(page.getByRole("heading", { name: "Games", level: 1 })).toBeVisible();
    // Every game you can play is locked, however many there are.
    const cards = page.getByRole("article");
    await expect(cards.first()).toBeVisible();
    const playable = (await cards.count()) - (await page.getByRole("button", { name: "Coming soon" }).count());
    expect(playable).toBeGreaterThanOrEqual(5);
    await expect(page.getByRole("button", { name: "Locked" })).toHaveCount(playable);
    for (const b of await page.getByRole("button", { name: "Locked" }).all()) await expect(b).toBeDisabled();
    await page.getByRole("button", { name: "Turn on notifications" }).click();
    await expect(page.getByRole("link", { name: /^Play / })).toHaveCount(playable);
    for (const name of ["Chess", "Scrabble", "Poker", "Golf", "Stonks"]) await expect(page.getByRole("link", { name: `Play ${name}` })).toBeVisible();
    await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
  });

  test("game cards play their art only once you scroll to them", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.goto("/games");
    const arts = page.locator("[data-art]");
    await expect(arts.first()).toHaveAttribute("data-art", "played");
    // The last card is below the fold: it waits, then plays when scrolled to.
    const last = arts.last();
    await expect(last).toHaveAttribute("data-art", "waiting");
    await last.scrollIntoViewIfNeeded();
    await expect(last).toHaveAttribute("data-art", "played");
    // Every card's art sits in the middle of its card, whatever its width, once it's played in.
    const offCenter = () =>
      arts.evaluateAll((els) =>
        els
          .map((el) => {
            const box = el.getBoundingClientRect();
            const art = (el.firstElementChild!.firstElementChild as HTMLElement).getBoundingClientRect();
            return Math.round(art.left + art.width / 2 - (box.left + box.width / 2));
          })
          .filter((off) => Math.abs(off) > 2),
      );
    await expect.poll(offCenter).toEqual([]);
    if (process.env.SCREENS) await page.screenshot({ path: "e2e/.state/screens/games-bottom.png" });
  });

  test("the tab bar reaches every tab and sits at native height", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [tab, heading] of [["Games", "Games"], ["Crew", "Crew"], ["You", "You"], ["Home", "Home"]] as const) {
      await nav.getByRole("link", { name: tab }).click();
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      // iOS misplaces fixed bottom bars on pages shorter than the screen, so every tab fills it.
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(pageHeight, `${tab} page height`).toBeGreaterThanOrEqual(page.viewportSize()!.height);
    }
    const box = await nav.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(84);
    expect(box!.y + box!.height).toBeCloseTo(page.viewportSize()!.height, 0);
  });

  test("every control on the main tabs is at least 44px tall", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    await createPlayer("Chris");
    const page = await phones.open({ player: me, notifications: "granted" });
    for (const path of ["/", "/games", "/crew", "/you"]) {
      await page.goto(path);
      await ready(page);
      const small = await page.$$eval("button, a[href], [role=switch], [role=radio]", (els) =>
        els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && style.visibility !== "hidden" && !el.closest("[aria-hidden=true]") && r.height < 44 && el.getAttribute("role") !== "switch";
          })
          .map((el) => `${el.tagName} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
      );
      expect(small, `small targets on ${path}`).toEqual([]);
    }
  });

  test("crew shows everyone, with live online dots", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris", { tagline: "Certified word guesser", badge: "🐐" });
    const page = await phones.open({ player: me });
    await page.goto("/crew");
    const chrisCard = page.getByRole("button", { name: /Certified word guesser/ });
    await expect(chrisCard).toBeVisible();
    // Offline shows no dot at all (mine is there, so the dots have loaded).
    await expect(page.getByRole("img", { name: "Online" })).toHaveCount(1);
    await expect(chrisCard.getByRole("img", { name: "Online" })).toHaveCount(0);

    // Chris opens the app on another phone; Shlok sees him come online without reloading.
    const chrisPage = await phones.open({ player: chris });
    await chrisPage.goto("/");
    await expect(chrisCard.getByRole("img", { name: "Online" })).toBeVisible();
  });

  test("someone opening the app bumps the Crew badge and drops an arrival pill", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const page = await phones.open({ player: me });
    await page.goto("/");
    const crewTab = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Crew" });
    await expect(crewTab).toBeVisible();
    await expect(page.getByLabel("1 online")).toHaveCount(0);

    const chrisPage = await phones.open({ player: chris });
    await chrisPage.goto("/");
    await expect(page.getByLabel("1 online")).toBeVisible();
    await expect(page.getByText("hopped on")).toBeVisible();
  });

  test("a game shows when the other player has it open right now", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const id = await admin().action(anyApi.testing.startMatch, { mode: "chess:classic", a: me.userId, b: chris.userId });
    const page = await phones.open({ player: me, push: "on" });
    await page.goto(`/chess/${id}`);
    await expect(page.getByText("Black", { exact: true })).toBeVisible();
    // Chris has the app open, but not on the game.
    const chrisPage = await phones.open({ player: chris, push: "on" });
    await chrisPage.goto("/");
    await expect(page.getByRole("img", { name: "Online" })).toHaveCount(2);
    await expect(page.getByText("Black, here now")).toHaveCount(0);
    await chrisPage.goto(`/chess/${id}`);
    await expect(page.getByText("Black, here now")).toBeVisible();
  });

  test("the game card only counts people who are in the game", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const page = await phones.open({ player: me });
    await page.goto("/games");
    const chrisPage = await phones.open({ player: chris, push: "on" });
    await chrisPage.goto("/");
    await expect(page.getByLabel("1 online")).toBeVisible();
    await expect(page.getByText("Chris is playing")).toHaveCount(0);
    await chrisPage.goto("/chess");
    await expect(page.getByText("Chris is playing")).toBeVisible();
  });

  test("old links land on the right mode page", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.goto("/?new=four");
    await expect(page).toHaveURL(/\/chess\/mode\/four$/);
    await expect(page.getByRole("heading", { name: "4-Player", level: 1 })).toBeVisible();
    await page.goto("/chess?mode=chess:realtime");
    await expect(page).toHaveURL(/\/chess\/mode\/realtime$/);
    await expect(page.getByRole("heading", { name: "Real-time", level: 1 })).toBeVisible();
  });

  test("a swipe from the left edge goes back", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    const id = await admin().action(anyApi.testing.startMatch, { mode: "chess:classic", a: me.userId, b: chris.userId });
    const page = await phones.open({ player: me, push: "on" });
    await page.goto("/");
    await page.getByRole("link", { name: /Chris/ }).click();
    await expect(page).toHaveURL(new RegExp(`/chess/${id}$`));
    await expect(page.getByRole("grid")).toBeVisible();
    // How far across the game's screen sits: 0 once it's all the way in, or has sprung back.
    const offset = () => onScreen(page).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    // A finger moving at a steady pace, then pausing before it lets go (so it isn't a flick).
    const swipe = (to: number) =>
      page.evaluate(async (to) => {
        const touch = (x: number) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 400 });
        const wait = () => new Promise((r) => setTimeout(r, 40));
        document.body.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(4)], bubbles: true }));
        for (let x = 20; x <= to; x += 20) {
          await wait();
          document.body.dispatchEvent(new TouchEvent("touchmove", { touches: [touch(x)], bubbles: true, cancelable: true }));
        }
        for (let i = 0; i < 5; i++) {
          await wait();
          document.body.dispatchEvent(new TouchEvent("touchmove", { touches: [touch(to)], bubbles: true, cancelable: true }));
        }
        document.body.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
      }, to);
    // Home has gone and the game has slid in.
    await expect(page.locator("[data-screen]")).toHaveCount(1);
    await expect.poll(offset).toBe(0);
    // A short drag springs back and stays put.
    await swipe(70);
    await expect.poll(offset).toBe(0);
    await expect(page).toHaveURL(new RegExp(`/chess/${id}$`));
    await swipe(260);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  });

  test("the app icon badge counts games waiting on me", async ({ phones, context }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris");
    await context.addInitScript(() => {
      (window as unknown as { badges: number[] }).badges = [];
      const nav = navigator as Navigator & { setAppBadge: (n?: number) => Promise<void>; clearAppBadge: () => Promise<void> };
      nav.setAppBadge = async (n?: number) => void (window as unknown as { badges: number[] }).badges.push(n ?? 0);
      nav.clearAppBadge = async () => void (window as unknown as { badges: number[] }).badges.push(0);
    });
    const page = await phones.open({ player: me, notifications: "granted" });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => (window as unknown as { badges: number[] }).badges.at(-1))).toBe(0);
    await admin().action(anyApi.testing.startMatch, { mode: "chess:classic", a: me.userId, b: chris.userId });
    await expect.poll(() => page.evaluate(() => (window as unknown as { badges: number[] }).badges.at(-1))).toBe(1);
  });

  test("taps show up live on other players' screens", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const chris = await createPlayer("Chris", { frame: "solid", frameColor: "#3b82f6" });
    const page = await phones.open({ player: me });
    await page.goto("/crew");
    await expect(page.getByRole("heading", { name: "Crew" })).toBeVisible();

    const chrisPage = await phones.open({ player: chris });
    await chrisPage.goto("/crew");
    await expect(chrisPage.getByRole("heading", { name: "Crew" })).toBeVisible();
    // Shlok's phone has seen Chris arrive: a tap from someone it's never seen is taken as old news.
    await expect(page.getByRole("button", { name: /Chris/ }).getByRole("img", { name: "Online" })).toBeVisible();
    await chrisPage.mouse.click(200, 400);
    await expect(page.locator("[data-tap=Chris]").getByText("Chris")).toBeVisible();
  });

  test("tapping someone's card opens it in a sheet", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    await createPlayer("Chris", { tagline: "Never lost a duel" });
    const page = await phones.open({ player: me });
    await page.goto("/crew");
    await page.getByRole("button", { name: /Never lost a duel/ }).click();
    await expect(page.getByRole("dialog").getByText("Hasn't opened the app yet")).toBeVisible();
  });

  test("card edits save, show live, and survive a reload", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/you");
    await page.getByRole("button", { name: "Edit card" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Holo" }).click();
    await sheet.getByRole("button", { name: "👑" }).click();
    await sheet.getByRole("radio", { name: "Foil" }).click();
    const tagline = sheet.locator("textarea");
    await tagline.fill("Typing fast, guessing faster");
    await tagline.press("Enter");
    await expect(sheet.locator("[data-player-card][data-frame=holo]")).toBeVisible();
    // Saved on the server, not just drawn in the sheet.
    await expect
      .poll(async () => {
        const p = await admin().query(anyApi.testing.profileOf, { userId: me.userId });
        return [p?.frame, p?.badge, p?.effect, p?.tagline];
      })
      .toEqual(["holo", "👑", "foil", "Typing fast, guessing faster"]);
    await page.reload();
    const card = page.locator("[data-player-card]").first();
    await expect(card).toHaveAttribute("data-frame", "holo");
    await expect(card.getByText("Typing fast, guessing faster")).toBeVisible();
    await expect(card.locator("[data-effect]")).toHaveAttribute("data-effect", "foil");
  });

  test("custom frame colors show the color picker", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/you");
    await page.getByRole("button", { name: "Edit card" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "Comet" })).toBeVisible();
    await expect(sheet.getByText("Frame color")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Comet" }).click();
    await expect(sheet.getByText("Frame color")).toBeVisible();
    await sheet.getByRole("button", { name: "Color #ec4899" }).click();
    await expect(sheet.locator("[data-player-card]")).toHaveAttribute("style", /#ec4899/);
  });

  test("the tagline field doesn't look like a login field", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/you");
    await page.getByRole("button", { name: "Edit card" }).click();
    const field = page.getByRole("dialog").locator("textarea");
    await expect(field).toHaveAttribute("autocomplete", "off");
    await expect(page.getByRole("dialog").locator("input[type=text], input:not([type])")).toHaveCount(0);
  });

  test("themes and fonts apply instantly and stick", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/you");
    await expect(page.locator("html")).toHaveAttribute("data-font", "oxanium");
    await page.getByRole("button", { name: /Theme/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Nord/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-palette", "nord");
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-palette", "nord");
    await expect(page.locator("html")).toHaveClass(/dark/);
    // The body's color as plain rgb (Chromium reports oklch as is), through a canvas.
    const bg = await page.evaluate(() => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    });
    // Reopened from cold, the page is Nord's dark before the stylesheet arrives, never a white flash.
    // Only index.html's own script runs: no stylesheet, no app.
    await page.route(/\.(css|js|tsx?)(\?|$)/, (r) => r.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    const early = await page.evaluate(() => ({ bg: getComputedStyle(document.documentElement).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme }));
    expect(early).toEqual({ bg, scheme: "dark" });
  });

  test("signing out asks first", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.goto("/you");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Stay signed in" }).click();
    await expect(page.getByRole("heading", { name: "You" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in with Discord" })).toBeVisible();
  });

  test("a new deploy reloads the app, but only offers an update inside a game", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me });
    await page.route("**/version.json*", (route) => route.fulfill({ json: { id: "a-newer-build" } }));
    let loads = 0;
    page.on("load", () => loads++);
    await page.goto("/");
    await expect.poll(() => loads, { timeout: 8000 }).toBeGreaterThan(1);
    // It reloads once for a given build, then offers the update instead of looping.
    await expect(page.getByText("A new version is ready")).toBeVisible({ timeout: 8000 });
    expect(loads).toBe(2);
    await page.goto("/chess/k000000000000000000000000000000");
    await expect(page.getByText("A new version is ready")).toBeVisible({ timeout: 8000 });
  });

  for (const path of ["/", "/games", "/crew", "/you"]) {
    test(`no serious accessibility issues on ${path}`, async ({ phones }) => {
      const me = await createPlayer("Shlok");
      await createPlayer("Chris");
      const page = await phones.open({ player: me, notifications: "granted" });
      await page.goto(path);
      await ready(page);
      const results = await new AxeBuilder({ page }).exclude(".pointer-events-none").analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
    });
  }
});
