import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STACK = process.env.STACK_DIR ?? "/home/shlok/Services/group53";
const CONVEX_URL = process.env.CONVEX_URL ?? "http://convex:3210";
const KEY_FILE = process.env.ADMIN_KEY_FILE ?? "/run/secrets/admin_key";
const SITE = process.env.SITE_URL ?? "https://group53.shlokbhakta.dev";
const DRY = process.env.DRY_RUN === "1";
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? path.basename(STACK);
const STATUS_FILE = path.join(STACK, "deploy-status.json");
const SERVICES = ["web", "og", "stonks"];
const BUILT_FROM = "/deployer";
const SELF_FILES = ["Dockerfile", "loop.sh"];

const EXCLUDES = [
  "node_modules",
  "dist",
  ".git",
  "secrets",
  ".env*",
  ".convex",
  ".dev",
  "target",
  "e2e/.state",
  "test-results",
  "playwright-report",
  "/deploy-status.json",
];

const sh = (cmd, args, { cwd = ROOT, env, readOnly = false, capture = false } = {}) => {
  console.log(`${DRY && !readOnly ? "[dry run] would run" : "$"} ${[cmd, ...args].join(" ")}${cwd === ROOT ? "" : `  (in ${cwd})`}`);
  if (DRY && !readOnly) return "";
  const result = spawnSync(cmd, args, {
    cwd,
    env: Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([, value]) => value !== undefined)),
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} ${args[0]} exited with ${result.status ?? result.signal}`);
  return capture ? result.stdout.trim() : "";
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const git = (...args) => sh("git", args, { readOnly: true, capture: true });

const status = {
  sha: process.env.DEPLOY_SHA ?? git("rev-parse", "HEAD"),
  subject: git("log", "-1", "--format=%s"),
  dryRun: DRY,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  state: "running",
  step: "start",
  error: null,
  build: null,
  deployerOutdated: [],
};

const save = () => {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
  } catch (error) {
    console.error(`Couldn't write ${STATUS_FILE}: ${error.message}`);
  }
};

const step = (name) => {
  status.step = name;
  save();
  console.log(`\n\x1b[1m==> ${name}\x1b[0m`);
};

const liveBuild = async () => {
  try {
    const res = await fetch(`${SITE}/version.json?t=${Date.now()}`, { cache: "no-store" });
    return res.ok ? ((await res.json()).id ?? null) : null;
  } catch {
    return null;
  }
};

const waitFor = async (what, check, tries, everyMs) => {
  if (DRY) {
    console.log(`[dry run] would wait for ${what}`);
    return true;
  }
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    await sleep(everyMs);
  }
  return false;
};

const compose = (args, opts = {}) => sh("docker", ["compose", ...args], { cwd: STACK, ...opts });

const webImage = () => {
  if (DRY) {
    compose(["ps", "-q", "web"]);
    return null;
  }
  const id = compose(["ps", "-q", "web"], { capture: true });
  return id ? sh("docker", ["inspect", "-f", "{{.Image}}", id], { capture: true }) : null;
};

const outdatedDeployer = () => {
  const changed = SELF_FILES.filter((file) => {
    const running = path.join(BUILT_FROM, file);
    const next = path.join(ROOT, "deploy", file);
    return !fs.existsSync(running) || fs.readFileSync(running, "utf8") !== fs.readFileSync(next, "utf8");
  }).map((file) => `deploy/${file}`);
  try {
    const wanted = compose(["config", "--hash", "deployer"], { readOnly: true, capture: true }).split(/\s+/)[1];
    const id = DRY ? "" : compose(["ps", "-q", "deployer"], { capture: true });
    const running = id
      ? sh("docker", ["inspect", "-f", '{{index .Config.Labels "com.docker.compose.config-hash"}}', id], { capture: true })
      : "";
    if (id && wanted && wanted !== running) changed.push("the deployer service in compose.yaml");
  } catch (error) {
    console.log(`Couldn't compare the deployer's compose config: ${error.message}`);
  }
  return changed;
};

const deploy = async () => {
  for (const file of ["compose.yaml", "package.json", ".git"]) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${ROOT} isn't a checkout of the repo (no ${file})`);
  }
  if (!fs.existsSync(path.join(STACK, "compose.yaml"))) throw new Error(`${STACK} isn't the stack (no compose.yaml)`);

  console.log(`Deploying ${status.sha} (${status.subject}) to ${STACK}${DRY ? ", dry run: nothing is changed" : ""}`);

  step("Waiting for Convex");
  const up = await waitFor(
    `${CONVEX_URL}/version`,
    () =>
      fetch(`${CONVEX_URL}/version`)
        .then((r) => r.ok)
        .catch(() => false),
    30,
    2000,
  );
  if (!up) throw new Error(`Convex isn't answering at ${CONVEX_URL}`);
  const before = DRY ? null : await liveBuild();
  const imageBefore = webImage();

  step("Installing dependencies");
  sh("npm", ["ci", "--no-audit", "--no-fund"]);

  step("Backend: Convex functions");
  const key = DRY ? "<admin key>" : fs.readFileSync(KEY_FILE, "utf8").trim();
  console.log(`CONVEX_SELF_HOSTED_URL=${CONVEX_URL} CONVEX_SELF_HOSTED_ADMIN_KEY=<from ${KEY_FILE}>`);
  sh("npx", ["convex", "deploy", "-y"], {
    env: {
      CONVEX_SELF_HOSTED_URL: CONVEX_URL,
      CONVEX_SELF_HOSTED_ADMIN_KEY: key,
      CONVEX_DEPLOYMENT: undefined,
      CONVEX_DEPLOY_KEY: undefined,
    },
  });

  step(`Copying the checkout to ${STACK}`);
  sh("rsync", ["-a", "--delete", ...EXCLUDES.map((e) => `--exclude=${e}`), `${ROOT}/`, `${STACK}/`]);

  step(`Rebuilding ${SERVICES.join(", ")}`);
  compose(["up", "-d", "--build", ...SERVICES]);

  step("Cleaning up old images");
  sh("docker", ["image", "prune", "-f", "--filter", `label=com.docker.compose.project=${PROJECT}`]);
  sh("docker", ["builder", "prune", "-f", "--filter", "until=168h"]);

  step("Checking the site");
  for (const page of ["/", "/version.json", "/sw.js"]) {
    let code = 0;
    const ok = await waitFor(
      `${SITE}${page} to answer 200`,
      async () => {
        code = await fetch(`${SITE}${page}`, { cache: "no-store" })
          .then((r) => r.status)
          .catch(() => 0);
        return code === 200;
      },
      10,
      2000,
    );
    console.log(`${page} ${DRY ? "(dry run)" : code}`);
    if (!ok) throw new Error(`${SITE}${page} answered ${code}`);
  }

  step("Checking phones will update");
  const imageAfter = webImage();
  if (!DRY && imageAfter === imageBefore) {
    status.build = { before, after: before };
    console.log(`The web image didn't change (nothing it's built from did), so phones keep build ${before ?? "?"}.`);
  } else {
    let after = null;
    const updated = await waitFor(
      "/version.json to name a new build",
      async () => {
        after = await liveBuild();
        return Boolean(after && after !== before);
      },
      30,
      2000,
    );
    status.build = { before, after };
    if (!updated) throw new Error(`Still serving build ${before ?? "?"}: the new web build isn't live, so phones won't update.`);
    console.log(
      `Build ${before ?? "none"} -> ${after ?? "(dry run)"}. Phones show Updating within a minute, or as soon as they're opened.`,
    );
  }

  status.deployerOutdated = outdatedDeployer();
  if (status.deployerOutdated.length) {
    console.log(
      `\n\x1b[33mThe deployer itself changed (${status.deployerOutdated.join(", ")}). It never rebuilds itself mid-deploy; when this ` +
        `status says ok, run on kiwi: cd ~/Services/group53 && docker compose up -d --build deployer\x1b[0m`,
    );
  }
};

try {
  await deploy();
  status.state = "ok";
  status.finishedAt = new Date().toISOString();
  save();
  console.log(`\n\x1b[32m✔ Deployed ${status.sha}${DRY ? " (dry run)" : ""}\x1b[0m`);
} catch (error) {
  status.state = "failed";
  status.error = error.message;
  status.finishedAt = new Date().toISOString();
  save();
  console.error(`\n\x1b[31m✘ Deploy of ${status.sha} failed at "${status.step}": ${error.message}\x1b[0m`);
  process.exit(1);
}
