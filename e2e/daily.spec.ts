import type { Page } from "@playwright/test";
import { anyApi } from "convex/server";
import { localDay } from "../convex/daily/days";
import { admin, createPlayer, expect, ready, test, type Player } from "./fixtures";
import { SAFE_LANDSCAPE, expectFitsScreen, rotate, simulateSafeAreas } from "./landscape";

type Sent = { title: string; body: string; url: string; tag?: string };
const pushesOf = (p: Player): Promise<Sent[]> => admin().query(anyApi.testing.pushesOf, { userId: p.userId });

const SCRANDLE = (right: number) =>
  `${"🟩".repeat(right)}${"🟥".repeat(10 - right)} ${right}/10 | ${localDay(new Date())} | https://scrandle.com`;

async function pasteBySheet(page: Page, text: string) {
  await page.getByRole("button", { name: "Paste result" }).click();
  const sheet = page.getByRole("dialog", { name: "Paste your result" });
  await sheet.getByRole("textbox", { name: "Result" }).fill(text);
  await sheet.getByRole("button", { name: "Post" }).click();
  await expect(sheet).toHaveCount(0);
}

test.describe("dailies", () => {
  test("a pasted result lands live on the other phone's Home, and beating someone pushes them", async ({ phones }) => {
    const [shlok, chris] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
    const [a, b] = await Promise.all([phones.open({ player: shlok, push: "on" }), phones.open({ player: chris, push: "on" })]);

    await b.goto("/");
    await ready(b);
    const strip = b.getByRole("region", { name: "Dailies" });
    await expect(strip.getByRole("button", { name: "Paste" })).toBeVisible();

    await b.goto("/daily");
    await ready(b);
    await pasteBySheet(b, SCRANDLE(6));
    await expect(b.getByRole("list", { name: "Scrandle today" }).getByText("6/10")).toBeVisible();
    await b.goto("/");

    await a.goto("/daily");
    await ready(a);
    await pasteBySheet(a, SCRANDLE(9));
    await expect(a.getByRole("list", { name: "Scrandle today" }).locator("[data-entry=mine]")).toContainText("9/10");

    const card = strip.locator("[data-daily=scrandle]");
    await expect(card).toContainText("2 in");
    await expect(card.locator("[data-entry=theirs]").first()).toContainText("9/10");
    await expect
      .poll(() => pushesOf(chris))
      .toEqual([expect.objectContaining({ title: "Shlok beat your Scrandle", body: "9/10 vs your 6/10", url: "/daily/scrandle" })]);
    expect(await pushesOf(shlok)).toEqual([]);

    await card.click();
    await expect(b.getByRole("heading", { name: "Scrandle", level: 1 })).toBeVisible();
    await expect(b.getByRole("list", { name: "Last 30 days" })).toContainText("Shlok");
  });

  test("the paste button reads the clipboard in one tap, refuses a second result, and removes yours", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/daily");
    await ready(page);
    await page.evaluate((t) => navigator.clipboard.writeText(t), SCRANDLE(7));
    await page.getByRole("button", { name: "Paste result" }).click();
    await expect(page.getByText("Scrandle 7/10 posted")).toBeVisible();
    await expect(page.getByRole("list", { name: "Scrandle today" })).toContainText("7/10");

    await page.evaluate((t) => navigator.clipboard.writeText(t), SCRANDLE(7));
    await page.getByRole("button", { name: "Paste result" }).click();
    await expect(page.getByRole("list", { name: "Scrandle today" }).locator("li")).toHaveCount(1);

    await page.evaluate((t) => navigator.clipboard.writeText(t), "Wordle 1,234 3/6\n🟩🟩🟩🟩🟩");
    await page.getByRole("button", { name: "Paste result" }).click();
    const sheet = page.getByRole("dialog", { name: "Paste your result" });
    await expect(sheet.getByText("Not a result from a daily we know")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Post" })).toBeDisabled();
    await sheet.getByRole("textbox", { name: "Result" }).fill(SCRANDLE(10));
    await sheet.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText("You already posted today's Scrandle.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await page.getByRole("button", { name: "Remove my result" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("list", { name: "Scrandle today" })).toHaveCount(0);
  });

  test("the Dailies page fits a phone on its side", async ({ phones }) => {
    const me = await createPlayer("Shlok");
    const page = await phones.open({ player: me, push: "on" });
    await page.goto("/daily");
    await ready(page);
    await pasteBySheet(page, SCRANDLE(8));
    await simulateSafeAreas(page, SAFE_LANDSCAPE);
    await rotate(page, "landscape");
    await ready(page);
    await expectFitsScreen(page, SAFE_LANDSCAPE);
  });
});
