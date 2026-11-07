import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  // One retry on CI, where a full run sometimes hits a random failure (see AGENTS.md); Playwright still
  // reports a test that passed on its retry as flaky. None locally, so a failure there is seen at once.
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4573",
    ...devices["iPhone 15 Pro"],
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite preview --outDir e2e/.state/dist --port 4573 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4573",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
