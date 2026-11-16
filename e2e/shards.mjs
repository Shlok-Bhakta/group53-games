import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TIMINGS = path.resolve("e2e/timings.json");
export const LAST_TIMINGS = path.resolve("e2e/.state/timings.json");

export const testKey = (file, titles) => [file, ...titles].join(" › ");

export const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});

export function parseShard(arg) {
  const match = /^(\d+)\/(\d+)$/.exec(arg);
  const [index, total] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!(index >= 1 && index <= total)) throw new Error(`--shard takes index/total, like --shard=2/8 (got ${arg})`);
  return { index, total };
}

export function listTests(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["playwright", "test", "--list", "--reporter=json", ...args], {
      stdio: ["ignore", "pipe", "inherit"],
      env: { PLAYWRIGHT_BROWSERS_PATH: "0", ...process.env },
    });
    const out = [];
    child.stdout.on("data", (d) => out.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`listing the e2e tests failed (${code})`));
      const keys = [];
      const walk = (suite, titles) => {
        for (const spec of suite.specs ?? []) keys.push(testKey(spec.file, [...titles, spec.title]));
        for (const inner of suite.suites ?? []) walk(inner, [...titles, inner.title]);
      };
      for (const file of JSON.parse(Buffer.concat(out).toString()).suites) walk(file, []);
      resolve(keys);
    });
  });
}

export function planShards(keys, seconds, total) {
  const known = keys.map((k) => seconds[k]).filter((s) => s !== undefined);
  const guess = known.length ? known.toSorted((a, b) => a - b)[Math.floor(known.length / 2)] : 1;
  const weighed = keys.map((key) => ({ key, s: seconds[key] ?? guess }));
  weighed.sort((a, b) => b.s - a.s || (a.key < b.key ? -1 : 1));
  const shards = Array.from({ length: total }, () => ({ keys: [], seconds: 0 }));
  for (const t of weighed) {
    const lightest = shards.reduce((best, s) => (s.seconds < best.seconds ? s : best));
    lightest.keys.push(t.key);
    lightest.seconds += t.s;
  }
  return shards;
}

export async function testsFor(shard, args) {
  const keys = await listTests(args);
  return shard ? planShards(keys, readJson(TIMINGS), shard.total)[shard.index - 1].keys : keys;
}

export function writeTestList(file, keys) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, keys.map((k) => `${k}\n`).join(""));
}

async function saveTimings(files) {
  const keys = new Set(await listTests());
  const merged = Object.assign(readJson(TIMINGS), ...files.map(readJson));
  const kept = Object.fromEntries(
    Object.entries(merged)
      .filter(([k]) => keys.has(k))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  writeFileSync(TIMINGS, `${JSON.stringify(kept, null, 2)}\n`);
  console.log(`Saved ${Object.keys(kept).length} test timings to ${path.relative(".", TIMINGS)}.`);
}

async function showPlan(total) {
  const shards = planShards(await listTests(), readJson(TIMINGS), total);
  for (const [i, s] of shards.entries()) console.log(`shard ${i + 1}/${total}: ${s.keys.length} tests, ${Math.round(s.seconds)}s`);
}

if (process.argv[1] === import.meta.filename) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "save") await saveTimings(rest.length ? rest : [LAST_TIMINGS]);
  else if (command === "plan") await showPlan(Number(rest[0]));
  else {
    console.error("Usage: node e2e/shards.mjs save [timings.json...] | plan <shards>");
    process.exit(2);
  }
}
