import { spawnSync } from "node:child_process";
import { startBackend, stopBackend, stopRunning } from "./backend.mjs";
import { parseShard, writeShardList } from "./shards.mjs";

const LOCK = "/tmp/group53-e2e.lock";
if (!process.env.GROUP53_E2E_LOCKED) {
  console.log("Waiting for any other e2e run on this machine to finish (they share ports 3211 and 4573)...");
  const queued = spawnSync("flock", [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GROUP53_E2E_LOCKED: "1" },
  });
  process.exit(queued.status ?? 1);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopRunning();
    process.exit(1);
  });
}

const args = process.argv.slice(2);
const shardArg = args.find((a) => a.startsWith("--shard="));
const rest = args.filter((a) => a !== shardArg);
const shard = shardArg ? parseShard(shardArg.slice("--shard=".length)) : null;

const started = Date.now();
const listing = shard ? writeShardList(shard, rest) : Promise.resolve(null);
listing.catch(() => {});
const state = await startBackend();
console.log(`Backend and app ready in ${Math.round((Date.now() - started) / 1000)}s.`);

let code = 1;
try {
  const list = await listing;
  if (list) console.log(`Shard ${shard.index}/${shard.total}: ${list.tests} tests, about ${list.seconds}s by e2e/timings.json.`);
  const result = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      "--add-reporter=./e2e/timings.mjs",
      ...(list ? ["--test-list", list.file, "--pass-with-no-tests"] : []),
      ...rest,
    ],
    {
      stdio: "inherit",
      env: { PLAYWRIGHT_BROWSERS_PATH: "0", ...process.env },
    },
  );
  code = result.status ?? 1;
} finally {
  stopBackend(state.name);
}
process.exit(code);
