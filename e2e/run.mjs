import { spawn, spawnSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_PORT, appUrl, buildApp, hostOf, startBackend, stopBackend, stopRunning, waitForUrl } from "./backend.mjs";
import { LAST_TIMINGS, parseShard, planShards, readJson, testsFor, TIMINGS, writeTestList } from "./shards.mjs";

const LOCK = "/tmp/group53-e2e.lock";
if (!process.env.GROUP53_E2E_LOCKED) {
  console.log("Waiting for any other e2e run on this machine to finish (they share ports 3211 and 4573)...");
  const queued = spawnSync("flock", [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GROUP53_E2E_LOCKED: "1" },
  });
  process.exit(queued.status ?? 1);
}

const children = new Set();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    for (const child of children) child.kill("SIGTERM");
    stopRunning();
    process.exit(1);
  });
}

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`));
const shardArg = flag("shard");
const slotsArg = flag("slots");
const rest = args.filter((a) => a !== shardArg && a !== slotsArg);
const shard = shardArg ? parseShard(shardArg.slice("--shard=".length)) : null;
const wanted = slotsArg
  ? Number(slotsArg.slice("--slots=".length))
  : Number(process.env.E2E_SLOTS ?? (process.env.CI ? 1 : Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))));

const STATE = path.resolve("e2e/.state");
const TEMPLATE = path.join(STATE, "dist-template");
const PLACEHOLDER = "http://convex.e2e.invalid:3210";
const VITE = path.resolve("node_modules/vite/bin/vite.js");
const slotDir = (slot) => (slot === 1 ? STATE : path.join(STATE, `slot-${slot}`));
const distOf = (slot) => path.join(slotDir(slot), "dist");

const started = Date.now();
const since = () => `${Math.round((Date.now() - started) / 1000)}s`;
const built = buildApp(TEMPLATE, PLACEHOLDER);
built.catch(() => {});
const keys = await testsFor(shard, rest);
if (keys.length === 0) {
  console.log("No e2e tests match.");
  await built;
  process.exit(0);
}
const plan = planShards(keys, readJson(TIMINGS), Math.max(1, Math.min(wanted, keys.length)));
const parallel = plan.length > 1;
const where = shard ? `Shard ${shard.index}/${shard.total}: ` : "";
console.log(
  `${where}${keys.length} tests over ${plan.length} backend${parallel ? "s" : ""}, about ${Math.round(Math.max(...plan.map((p) => p.seconds)))}s by e2e/timings.json.`,
);

function pointAt(dir, url) {
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) pointAt(file, url);
    else if (/\.(js|html|json|webmanifest)$/.test(entry)) {
      const text = readFileSync(file, "utf8");
      if (text.includes(PLACEHOLDER)) writeFileSync(file, text.replaceAll(PLACEHOLDER, url));
    }
  }
}

function prefixed(stream, label) {
  let partial = "";
  stream.on("data", (chunk) => {
    const lines = (partial + chunk).split("\n");
    partial = lines.pop();
    for (const line of lines) process.stdout.write(`${label}${line}\n`);
  });
  stream.on("end", () => partial && process.stdout.write(`${label}${partial}\n`));
}

function run(cmd, cmdArgs, opts, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { ...opts, stdio: label ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"] });
    children.add(child);
    if (label) {
      prefixed(child.stdout, label);
      prefixed(child.stderr, label);
    }
    child.on("close", (code) => {
      children.delete(child);
      resolve(code ?? 1);
    });
  });
}

async function runSlot(slot, slotKeys) {
  const label = parallel ? `[${slot}] ` : "";
  const state = await startBackend({ build: false, slot });
  try {
    await built;
    rmSync(distOf(slot), { recursive: true, force: true });
    cpSync(TEMPLATE, distOf(slot), { recursive: true });
    pointAt(distOf(slot), state.url);
    const preview = spawn(
      process.execPath,
      [VITE, "preview", "--outDir", distOf(slot), "--port", String(APP_PORT), "--strictPort", "--host", hostOf(slot)],
      { stdio: "ignore" },
    );
    children.add(preview);
    try {
      await waitForUrl(appUrl(slot));
      console.log(`${label}Backend and app ready in ${since()}.`);
      const list = path.join(slotDir(slot), "tests.txt");
      writeTestList(list, slotKeys);
      return await run(
        "npx",
        [
          "playwright",
          "test",
          "--add-reporter=./e2e/timings.mjs",
          "--test-list",
          list,
          "--pass-with-no-tests",
          ...(parallel ? ["--output", `test-results/slot-${slot}`] : []),
          ...rest,
        ],
        {
          env: {
            PLAYWRIGHT_BROWSERS_PATH: "0",
            ...(parallel ? { FORCE_COLOR: "1" } : {}),
            ...process.env,
            E2E_STATE: state.stateFile,
            E2E_APP_URL: appUrl(slot),
            E2E_TIMINGS: path.join(slotDir(slot), "timings.json"),
          },
        },
        label,
      );
    } finally {
      preview.kill("SIGTERM");
      children.delete(preview);
    }
  } finally {
    stopBackend(state.name);
  }
}

const codes = await Promise.all(plan.map((p, i) => runSlot(i + 1, p.keys).catch((err) => (console.error(err), 1))));
writeFileSync(
  LAST_TIMINGS,
  JSON.stringify(Object.assign({}, ...plan.map((_, i) => readJson(path.join(slotDir(i + 1), "timings.json")))), null, 2),
);
const failed = codes.flatMap((code, i) => (code === 0 ? [] : [i + 1]));
if (parallel)
  console.log(
    failed.length ? `\nFailed on backend ${failed.join(", ")} after ${since()}.` : `\nAll ${plan.length} backends passed in ${since()}.`,
  );
process.exit(failed.length ? 1 : 0);
