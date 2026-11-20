import { anyApi } from "convex/server";
import { FRAME_COLOR } from "../convex/palette";
import { localDay } from "../convex/daily/days";
import { admin, createPlayer, expect, phone, readyForShot, test, type Player } from "./fixtures";

test.skip(!process.env.SCREENS, "Set SCREENS=1 to capture review screenshots");

const KRILLION_DAY = 128;
const CONNECTIONS_DAY = 1258;
const day = () => localDay(new Date());
const scrandle = (right: number) => `${"🟩".repeat(right)}${"🟥".repeat(10 - right)} ${right}/10 | ${day()} | https://scrandle.com`;
const krillion = (tiers: string) => `Krillion #${KRILLION_DAY} 🦐\n0\n\n${tiers}`;
const connections = (rows: string[]) => `Connections\nPuzzle #${CONNECTIONS_DAY}\n${rows.join("\n")}`;
const post = (p: Player, text: string) => admin().mutation(anyApi.testing.dailyAs, { userId: p.userId, text, day: day() });

for (const scheme of ["dark", "light"] as const) {
  test(`daily screens ${scheme}`, async ({ browser }) => {
    const me = await createPlayer("WashableBowl700", { frame: "holo", glow: true, badge: "🐐" });
    const chris = await createPlayer("chrisis14", { frame: "comet", frameColor: FRAME_COLOR.blue, badge: "🤡" });
    const boiler = await createPlayer("Boiler", { frame: "fire", badge: "🔥" });
    const wes = await createPlayer("Wes", { frame: "neon", frameColor: FRAME_COLOR.pink });
    await post(me, scrandle(8));
    await post(chris, scrandle(9));
    await post(boiler, scrandle(6));
    await post(wes, scrandle(8));
    await post(chris, krillion("🐟🏮🐟🐟🐟🏮🏮"));
    await post(me, krillion("🐟🦑🐟🦑🌟🏮🦑"));
    await post(boiler, connections(["🟪🟪🟪🟪", "🟦🟦🟦🟦", "🟨🟨🟨🟨", "🟩🟩🟩🟩"]));
    await post(wes, connections(["🟨🟨🟨🟨", "🟦🟦🟩🟦", "🟩🟩🟩🟩", "🟦🟦🟦🟦", "🟪🟪🟪🟪"]));

    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
    });
    const pushEndpoint = `https://push.example.com/daily-${scheme}`;
    await admin().mutation(anyApi.testing.seedPush, { userId: me.userId, endpoint: pushEndpoint });
    const page = await phone(context, { player: me, notifications: "granted", pushEndpoint });
    const shot = async (name: string, full = false) => {
      await readyForShot(page);
      await page.screenshot({ path: `e2e/.state/screens/${scheme}-daily-${name}.png`, fullPage: full, animations: "allow" });
    };

    await page.goto("/");
    await expect(page.locator("[data-daily=connections]")).toBeVisible();
    await shot("home");
    await page.goto("/daily");
    await expect(page.getByRole("list", { name: "Scrandle today" })).toBeVisible();
    await shot("page", true);
    await page.getByRole("button", { name: "Paste result" }).click();
    await page.getByRole("dialog", { name: "Paste your result" }).getByRole("textbox").fill(scrandle(7));
    await shot("sheet");
    await page.goto("/daily/scrandle");
    await expect(page.getByRole("list", { name: "Last 30 days" })).toBeVisible();
    await shot("history", true);
    await context.close();
  });
}
