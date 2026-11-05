import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createPlayer, expect, phone, test } from "./fixtures";
import { publish } from "../scripts/publish-hosted.mjs";

const backend = () => JSON.parse(readFileSync(path.resolve("e2e/.state/backend.json"), "utf8")) as { url: string; adminKey: string };

async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}

// A little stand-in for a real build: it reads a gzipped file by a relative path, keeps something in its own
// storage, shows what the app told it, and goes back through the app.
function fixture(version: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "hosted-"));
  mkdirSync(path.join(dir, "data"));
  writeFileSync(path.join(dir, "data", "big file.json"), JSON.stringify({ word: "from-storage", pad: "x".repeat(5000) }));
  writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><title>t</title><h1>Hosted ${version}</h1><p id="hash"></p><p id="data"></p><p id="visits"></p><button id="b">Leave</button>
<script>
  document.getElementById("hash").textContent = location.hash;
  fetch("./data/big%20file.json").then((r) => r.json()).then((j) => (document.getElementById("data").textContent = j.word));
  const n = Number(localStorage.getItem("visits") || 0) + 1;
  localStorage.setItem("visits", n);
  document.getElementById("visits").textContent = "visits " + n;
  document.getElementById("b").onclick = () => parent.postMessage({ type: "back" }, "*");
  parent.postMessage({ type: "ready" }, "*");
</script>`,
  );
  return dir;
}

test("a hosted game: its card, the iframe, its files and its saves, and back again", async ({ context }) => {
  test.setTimeout(120_000);
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  await enablePush(page);

  // Nothing published yet: the page says so and can still go back.
  await page.goto("/mereddia");
  await expect(page.getByText("It isn't up yet.")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByText("It isn't up yet.")).toHaveCount(0);

  const { url, adminKey } = backend();
  const first = await publish({ url, adminKey, game: "mereddia", dir: fixture("one") });
  expect(first.files).toBe(2);

  // Opening the game page downloads nothing of it until Play.
  const asked: string[] = [];
  page.on("request", (r) => void (r.url().includes("/games/mereddia/") && asked.push(r.url())));
  await page.goto("/games");
  await page.getByRole("link", { name: "Play Journey Across Mereddia" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: "Journey Across Mereddia" })).toBeVisible();
  expect(asked).toEqual([]);
  await page.getByRole("link", { name: "Play Journey Across Mereddia" }).click();
  await expect(page).toHaveURL(/\/mereddia$/);

  const game = page.frameLocator('iframe[title="Journey Across Mereddia"]');
  await expect(game.getByRole("heading", { name: "Hosted one" })).toBeVisible();
  // A relative path, with a space, served gzipped.
  await expect(game.locator("#data")).toHaveText("from-storage");
  expect(asked.some((u) => u.includes("/data/big%20file.json"))).toBe(true);
  // The phone's settings came through, and the app's bar made way.
  await expect(game.locator("#hash")).toContainText("palette=");
  await expect(game.locator("#hash")).toContainText("sfx=");
  await expect(page.getByRole("heading", { name: "Journey Across Mereddia" })).toHaveCount(0);
  await expect(game.locator("#visits")).toHaveText("visits 1");
  // Its own origin, so it can't read the app's storage.
  expect(new URL(asked[0]).origin).not.toBe(new URL(page.url()).origin);
  // The app's music stands aside while it plays.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __music?: string }).__music)).toBe("off");

  // Its saves survive a reload.
  await page.reload();
  await expect(game.locator("#visits")).toHaveText("visits 2");

  // A new build goes live without touching the app, and the one before still answers.
  const second = await publish({ url, adminKey, game: "mereddia", dir: fixture("two") });
  expect(second.build).not.toBe(first.build);
  await expect(game.getByRole("heading", { name: "Hosted one" })).toBeVisible();
  await page.reload();
  await expect(game.getByRole("heading", { name: "Hosted two" })).toBeVisible();

  await game.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/games$|\/$/);
  await expect(page.locator('iframe[title="Journey Across Mereddia"]')).toHaveCount(0);
});

// The real game through the real page: MEREDDIA_DIST=<its dist-mereddia> npm run test:e2e -- e2e/hosted -g "real build".
test("the real build plays in the iframe", async ({ context }) => {
  test.skip(!process.env.MEREDDIA_DIST, "Set MEREDDIA_DIST to a built dist-mereddia");
  test.setTimeout(300_000);
  const { url, adminKey } = backend();
  const started = Date.now();
  const done = await publish({ url, adminKey, game: "mereddia", dir: process.env.MEREDDIA_DIST! });
  console.log(`published ${done.files} files, ${(done.bytes / 1e6).toFixed(1)} MB stored, in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  const page = await phone(context, { player: await createPlayer("Shlok"), notifications: "granted" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text().slice(0, 200))));
  let files = 0;
  let bytes = 0;
  const slow: number[] = [];
  const at = new Map<string, number>();
  page.on("request", (r) => void (r.url().includes("/games/mereddia/") && at.set(r.url(), Date.now())));
  page.on("response", async (r) => {
    if (!r.url().includes("/games/mereddia/")) return;
    files++;
    slow.push(Date.now() - (at.get(r.url()) ?? Date.now()));
    bytes += Number(r.headers()["content-length"] ?? 0);
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await enablePush(page);
  await page.goto("/games");
  const tapped = Date.now();
  await page.getByRole("link", { name: "Play Journey Across Mereddia" }).click();
  const game = page.frameLocator('iframe[title="Journey Across Mereddia"]');
  await expect(game.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 60_000 });
  console.log(`interactive after ${Date.now() - tapped}ms, ${files} files`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "e2e/.state/screens/mereddia-iframe-1.png" });
  const skip = game.getByRole("button", { name: /skip/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  for (let i = 0; i < 6; i++) {
    const next = game.getByRole("button", { name: /^(Next|Done|Continue)/ }).first();
    if (await next.isVisible().catch(() => false)) await next.click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "e2e/.state/screens/mereddia-iframe-2.png" });
  slow.sort((a, b) => a - b);
  console.log(`files ${files}, ${(bytes / 1e6).toFixed(1)} MB on the wire, request p50 ${slow[slow.length >> 1]}ms p95 ${slow[Math.floor(slow.length * 0.95)]}ms max ${slow.at(-1)}ms`);
  console.log("errors", JSON.stringify(errors.slice(0, 8)));
  // Saves survive: the game comes back to where it was.
  await page.reload();
  await expect(game.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 60_000 });
  await game.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/games$|\/$/);
  expect(errors).toEqual([]);
});
