// npm run test:e2e: start a throwaway backend, build against it, run Playwright, then clean up.
import { spawnSync } from "node:child_process";
import { startBackend, stopBackend, stopRunning } from "./backend.mjs";

const LOCK = "/tmp/group53-e2e.lock";
if (!process.env.GROUP53_E2E_LOCKED) {
  console.log("Waiting for any other e2e run on this machine to finish (they share ports 3211 and 4573)...");
  const queued = spawnSync("flock", [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GROUP53_E2E_LOCKED: "1" },
  });
  process.exit(queued.status ?? 1);
}

// Stopping a run mustn't leave the backend holding port 3211.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopRunning();
    process.exit(1);
  });
}

const state = await startBackend();
let code = 1;
try {
  const result = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { PLAYWRIGHT_BROWSERS_PATH: "0", ...process.env },
  });
  code = result.status ?? 1;
} finally {
  stopBackend(state.name);
}
process.exit(code);
