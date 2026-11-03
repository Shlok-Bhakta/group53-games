// `dekit start test/smoke`: is everything dekit started really working? Two tabs of one phone browser sign in
// as two players without Discord and get past the gates, and the link previews and the sidecar answer.
import { devices, chromium } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

const WEB = "http://127.0.0.1:5173";
const OG = "http://127.0.0.1:8788";
const CONVEX = "http://127.0.0.1:3210";

const pass = (what) => console.log(`✔ ${what}`);

const browser = await chromium.launch();
try {
  const context = await browser.newContext(devices["iPhone 15 Pro"]);
  const signIn = async (name) => {
    const page = await context.newPage();
    await page.goto(WEB);
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("link", { name: "Games" }).waitFor();
    pass(`${name} signed in without Discord, past the install gate`);
    return page;
  };
  const ada = await signIn("Ada");
  const grace = await signIn("Grace");

  // Each tab has to still be its own player once the other has signed in.
  for (const [page, name] of [[ada, "Ada"], [grace, "Grace"]]) {
    await page.goto(`${WEB}/you`);
    await page.getByText(name, { exact: true }).first().waitFor();
    pass(`that tab is still ${name}`);
  }

  await ada.goto(`${WEB}/chess`);
  await ada.getByText("Real-time", { exact: true }).first().waitFor();
  pass("games are open, past the notifications gate");

  await ada.goto(`${WEB}/stonks`);
  await ada.getByText("Crew", { exact: true }).first().waitFor();
  pass("Stonks is open");

  const preview = await (await fetch(`${OG}/`)).text();
  if (!preview.includes("og:title")) throw new Error("og didn't answer with a link preview");
  const card = await fetch(`${OG}/og/image/home.png`);
  if (!card.ok) throw new Error(`og couldn't render a card: ${card.status}`);
  pass("og renders link previews");

  // Prices need Yahoo, which isn't ours to promise, so nothing fails over them.
  const convex = new ConvexHttpClient(CONVEX);
  const end = Date.now() + 60_000;
  let quotes = 0;
  while (Date.now() < end && quotes === 0) {
    quotes = (await convex.query("stonks:board", {})).rows.length;
    if (quotes === 0) await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(quotes ? `✔ the sidecar has written ${quotes} prices` : "⚠ no prices yet: is the stonks task still building, or Yahoo unreachable?");
  console.log("\nAll good.");
} catch (err) {
  console.error(`\n✘ ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
