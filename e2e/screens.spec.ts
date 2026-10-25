// Visual review: SCREENS=1 npm run test:e2e -- screens. Writes PNGs to e2e/.state/screens.
import { createPlayer, expect, phone, test } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

const AVATARS = {
  shlok: "https://cdn.discordapp.com/avatars/719077732042014761/44639fc5bce7c79f99de5625f7fed7a8.png?size=256",
  chris: "https://cdn.discordapp.com/avatars/492431153375084547/f69aa29f75cacbf294c0d465c351d701.png?size=256",
  boiler: "https://cdn.discordapp.com/avatars/254330076894724106/28dbf1f91ecc44249169c396d789731f.png?size=256",
};

for (const scheme of ["dark", "light"] as const) {
  test(`screens ${scheme}`, async ({ browser }) => {
    const me = await createPlayer("WashableBowl700", { username: "washablebowl", image: AVATARS.shlok, frame: "holo", glow: true, badge: "🐐", effect: "foil", tagline: "Certified word guesser" });
    const chris = await createPlayer("chrisis14", { username: "chrisis14", image: AVATARS.chris, frame: "comet", frameColor: "#3b82f6", badge: "🤡", tagline: "Never lost a duel (lie)" });
    await createPlayer("Boiler", { username: "boiler", image: AVATARS.boiler, frame: "fire", effect: "crt", badge: "🔥" });
    await createPlayer("Wes", { frame: "neon", frameColor: "#ec4899", tagline: "Here for the vibes" });

    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await phone(context, { player: me, notifications: scheme === "dark" ? "default" : "granted" });
    const chrisCtx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    const chrisPage = await phone(chrisCtx, { player: chris });
    await chrisPage.goto("/crew");

    const shot = async (name: string, full = false) => {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-${name}.png`, fullPage: full, animations: "allow" });
    };

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Games", exact: true })).toBeVisible();
    await shot("games");
    await page.goto("/crew");
    await expect(page.getByRole("heading", { name: "Crew" })).toBeVisible();
    await chrisPage.mouse.click(250, 520);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `e2e/.state/screens/${scheme}-crew-tap.png` });
    await shot("crew");
    await page.getByRole("button", { name: /chrisis14/ }).click();
    await shot("crew-sheet");
    await page.keyboard.press("Escape");
    await page.goto("/you");
    await shot("you", true);
    await page.getByRole("button", { name: "Edit card" }).click();
    await shot("editor");
    await page.getByRole("dialog").getByRole("button", { name: "Comet" }).click();
    await page.getByRole("dialog").locator(".overflow-y-auto").evaluate((el) => el.scrollTo(0, 420));
    await shot("editor-scrolled");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Theme/ }).click();
    await shot("theme-sheet");
    await context.close();
    await chrisCtx.close();
  });
}
