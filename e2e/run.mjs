// npm run test:e2e: start a throwaway backend, build against it, run Playwright, then clean up.
import { spawnSync } from "node:child_process";
import { startBackend, stopBackend } from "./backend.mjs";

const state = await startBackend();
let code = 1;
try {
  const result = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], { stdio: "inherit", env: { PLAYWRIGHT_BROWSERS_PATH: "0", ...process.env } });
  code = result.status ?? 1;
} finally {
  stopBackend(state.name);
}
process.exit(code);
