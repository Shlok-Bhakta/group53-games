import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
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
