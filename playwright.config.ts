import { defineConfig, devices } from "@playwright/test";

const app = process.env.E2E_APP_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: app ?? "http://127.0.0.1:4573",
    ...devices["iPhone 15 Pro"],
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: app
    ? undefined
    : {
        command: "npx vite preview --outDir e2e/.state/dist --port 4573 --strictPort --host 127.0.0.1",
        url: "http://127.0.0.1:4573",
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
