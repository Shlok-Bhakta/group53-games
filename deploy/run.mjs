import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STACK = process.env.STACK_DIR ?? "/home/shlok/Services/group53";
const INTERNAL_CONVEX = process.env.DEPLOY_CONVEX_INTERNAL ?? "http://convex:3210";
const KEY_FILE = process.env.ADMIN_KEY_FILE ?? "/run/secrets/admin_key";
const SITE = process.env.DEPLOY_SITE ?? "https://group53.shlokbhakta.dev";
const DRY = process.env.DRY_RUN === "1";
const STATUS_FILE = path.join(STACK, "deploy-status.json");
const SITE_DIR = path.join(STACK, "site");
const BUILDS = path.join(SITE_DIR, "builds");
const ASSETS = path.join(SITE_DIR, "assets");
const NGINX_DIR = path.join(SITE_DIR, "nginx");
const CURRENT = path.join(SITE_DIR, "current");
const KEEP_BUILDS = 5;
const KEEP_ASSETS_DAYS = 14;
const REBUILT = ["og", "stonks"];
const NEVER_TOUCHED = ["convex", "tunnel", "dashboard"];
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
  "/site",
];

const composeEnv = () => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
});

const sh = (cmd, args, { cwd = ROOT, env, cleanEnv = false, readOnly = false, capture = false } = {}) => {
  console.log(`${DRY && !readOnly ? "[dry run] would run" : "$"} ${[cmd, ...args].join(" ")}${cwd === ROOT ? "" : `  (in ${cwd})`}`);
  if (DRY && !readOnly) return "";
  const base = cleanEnv ? composeEnv() : process.env;
  const result = spawnSync(cmd, args, {
    cwd,
    env: Object.fromEntries(Object.entries({ ...base, ...env }).filter(([, value]) => value !== undefined)),
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} ${args[0]} exited with ${result.status ?? result.signal}`);
  return capture ? result.stdout.trim() : "";
};

const compose = (args, opts = {}) => sh("docker", ["compose", ...args], { cwd: STACK, cleanEnv: true, ...opts });

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
  rolledBack: false,
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

const stackEnv = () => {
  const file = path.join(STACK, ".env");
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
};

const publicConvexUrl = () => {
  const url = stackEnv().CONVEX_URL;
  if (!url || !/^https:\/\//.test(url)) throw new Error(`${STACK}/.env has no public https CONVEX_URL (got ${url ?? "nothing"})`);
  return url;
};

const containerIds = () => {
  if (DRY) return {};
  return Object.fromEntries(NEVER_TOUCHED.map((service) => [service, compose(["ps", "-q", service], { readOnly: true, capture: true })]));
};

const fetchText = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
};

const liveBuild = async () => {
  try {
    return JSON.parse(await fetchText(`${SITE}/version.json?t=${Date.now()}`)).id ?? null;
  } catch {
    return null;
  }
};

const entryScript = (html) => html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1] ?? null;

const bundleTalksTo = (js, url) => js.includes(url) && !js.includes("http://convex:3210");

const currentBuild = () => {
  try {
    return path.basename(fs.readlinkSync(CURRENT));
  } catch {
    return null;
  }
};

const pointCurrentAt = (id) => {
  const next = `${CURRENT}.next`;
  sh("ln", ["-sfn", `builds/${id}`, next]);
  sh("mv", ["-T", next, CURRENT]);
};

const nginxConfig = () => fs.readFileSync(path.join(ROOT, "nginx.conf"), "utf8");

const webRunning = () => !DRY && compose(["ps", "--status", "running", "-q", "web"], { readOnly: true, capture: true }) !== "";

const webConfigChanged = () => {
  if (DRY) return false;
  const wanted = compose(["config", "--hash", "web"], { readOnly: true, capture: true }).split(/\s+/)[1];
  const id = compose(["ps", "-q", "web"], { readOnly: true, capture: true });
  if (!id) return true;
  const running = sh("docker", ["inspect", "-f", '{{index .Config.Labels "com.docker.compose.config-hash"}}', id], {
    readOnly: true,
    capture: true,
  });
  return wanted !== running;
};

const outdatedDeployer = () => {
  const changed = SELF_FILES.filter((file) => {
    const running = path.join(BUILT_FROM, file);
    const next = path.join(ROOT, "deploy", file);
    return !fs.existsSync(running) || fs.readFileSync(running, "utf8") !== fs.readFileSync(next, "utf8");
  }).map((file) => `deploy/${file}`);
  try {
    const wanted = compose(["config", "--hash", "deployer"], { readOnly: true, capture: true }).split(/\s+/)[1];
    const id = DRY ? "" : compose(["ps", "-q", "deployer"], { readOnly: true, capture: true });
    const running = id
      ? sh("docker", ["inspect", "-f", '{{index .Config.Labels "com.docker.compose.config-hash"}}', id], { readOnly: true, capture: true })
      : "";
    if (id && wanted && wanted !== running) changed.push("the deployer service in compose.yaml");
  } catch (error) {
    console.log(`Couldn't compare the deployer's compose config: ${error.message}`);
  }
  return changed;
};

const pruneSite = () => {
  if (DRY || !fs.existsSync(BUILDS)) return;
  const live = currentBuild();
  const builds = fs
    .readdirSync(BUILDS)
    .map((id) => ({ id, at: fs.statSync(path.join(BUILDS, id)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const kept = builds.slice(0, KEEP_BUILDS).map((b) => b.id);
  for (const { id } of builds) if (!kept.includes(id) && id !== live) fs.rmSync(path.join(BUILDS, id), { recursive: true, force: true });
  const referenced = new Set(kept.flatMap((id) => fs.readdirSync(path.join(BUILDS, id, "assets"), { withFileTypes: true }).map((f) => f.name)));
  const cutoff = Date.now() - KEEP_ASSETS_DAYS * 86_400_000;
  for (const name of fs.readdirSync(ASSETS)) {
    const file = path.join(ASSETS, name);
    if (!referenced.has(name) && fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
  }
};

const checkLive = async (id, convexUrl) => {
  const problems = [];
  for (const page of ["/", "/version.json", "/sw.js"]) {
    const ok = await waitFor(
      `${SITE}${page} to answer 200`,
      () =>
        fetch(`${SITE}${page}`, { cache: "no-store" })
          .then((r) => r.status === 200)
          .catch(() => false),
      10,
      2000,
    );
    if (!ok) problems.push(`${page} doesn't answer 200`);
  }
  if (DRY) return problems;
  const served = await waitFor("/version.json to name the new build", async () => (await liveBuild()) === id, 15, 2000);
  if (!served) problems.push(`/version.json still names ${await liveBuild()}, not ${id}`);
  const html = await fetchText(`${SITE}/?t=${Date.now()}`).catch(() => "");
  const script = entryScript(html);
  const js = script ? await fetchText(new URL(script, SITE).href).catch(() => "") : "";
  if (!bundleTalksTo(js, convexUrl)) problems.push(`the live bundle (${script ?? "none"}) doesn't talk to ${convexUrl}`);
  return problems;
};

const deploy = async () => {
  for (const file of ["compose.yaml", "package.json", "nginx.conf", ".git"]) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${ROOT} isn't a checkout of the repo (no ${file})`);
  }
  if (!fs.existsSync(path.join(STACK, "compose.yaml"))) throw new Error(`${STACK} isn't the stack (no compose.yaml)`);

  console.log(`Deploying ${status.sha} (${status.subject}) to ${STACK}${DRY ? ", dry run: nothing is changed" : ""}`);
  const convexUrl = publicConvexUrl();
  const untouched = containerIds();
  const previous = currentBuild();

  step("Waiting for Convex");
  const up = await waitFor(
    `${INTERNAL_CONVEX}/version`,
    () =>
      fetch(`${INTERNAL_CONVEX}/version`)
        .then((r) => r.ok)
        .catch(() => false),
    30,
    2000,
  );
  if (!up) throw new Error(`Convex isn't answering at ${INTERNAL_CONVEX}`);

  step("Installing dependencies");
  sh("npm", ["ci", "--no-audit", "--no-fund"]);

  step("Building the app");
  const id = Date.now().toString(36);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "group53-web-"));
  sh("npx", ["vite", "build", "--outDir", out, "--emptyOutDir"], {
    env: { VITE_CONVEX_URL: convexUrl, BUILD_ID: id, CONVEX_URL: undefined, CONVEX_SITE_URL: undefined },
  });
  if (!DRY) {
    const script = entryScript(fs.readFileSync(path.join(out, "index.html"), "utf8"));
    const js = script ? fs.readFileSync(path.join(out, script), "utf8") : "";
    if (!bundleTalksTo(js, convexUrl)) throw new Error(`the new build doesn't talk to ${convexUrl}; nothing was deployed`);
  }
  console.log(`Build ${id} talks to ${convexUrl}.`);

  step("Backend: Convex functions");
  const key = DRY ? "<admin key>" : fs.readFileSync(KEY_FILE, "utf8").trim();
  sh("npx", ["convex", "deploy", "-y"], {
    env: {
      CONVEX_SELF_HOSTED_URL: INTERNAL_CONVEX,
      CONVEX_SELF_HOSTED_ADMIN_KEY: key,
      CONVEX_URL: undefined,
      CONVEX_DEPLOYMENT: undefined,
      CONVEX_DEPLOY_KEY: undefined,
    },
  });

  step(`Copying the checkout to ${STACK}`);
  sh("rsync", ["-a", "--delete", ...EXCLUDES.map((e) => `--exclude=${e}`), `${ROOT}/`, `${STACK}/`]);

  step("Publishing the app in place");
  sh("mkdir", ["-p", BUILDS, ASSETS, NGINX_DIR]);
  sh("cp", ["-a", out, path.join(BUILDS, id)]);
  sh("cp", ["-a", "-n", ...(DRY ? [`${out}/assets/.`] : [path.join(out, "assets", ".")]), ASSETS]);
  sh("chmod", ["-R", "a+rX", path.join(BUILDS, id), ASSETS]);
  const nginxFile = path.join(NGINX_DIR, "default.conf");
  const nginxChanged = DRY || !fs.existsSync(nginxFile) || fs.readFileSync(nginxFile, "utf8") !== nginxConfig();
  if (nginxChanged && !DRY) fs.writeFileSync(nginxFile, nginxConfig(), { mode: 0o644 });
  if (!previous) pointCurrentAt(id);
  if (!webRunning() || webConfigChanged()) {
    console.log("The web container's setup changed, so it's recreated once (a second or two). Later deploys don't touch it.");
    compose(["up", "-d", "--no-deps", "web"]);
  } else if (nginxChanged) {
    compose(["exec", "-T", "web", "nginx", "-t"]);
    compose(["exec", "-T", "web", "nginx", "-s", "reload"]);
  }
  pointCurrentAt(id);
  console.log(`Serving build ${id} (was ${previous ?? "none"}); nginx kept running.`);

  step("Checking the site");
  const problems = await checkLive(id, convexUrl);
  status.build = { before: previous, after: id };
  if (problems.length) {
    if (previous) {
      pointCurrentAt(previous);
      status.rolledBack = true;
      console.error(`Rolled the site back to build ${previous}.`);
    }
    throw new Error(problems.join("; "));
  }
  console.log(`Build ${previous ?? "none"} -> ${id}. Phones pick it up once they're out of a game.`);

  step(`Rebuilding ${REBUILT.join(" and ")} where their code changed`);
  compose(["up", "-d", "--no-deps", "--build", ...REBUILT]);

  step("Checking nothing else was touched");
  const after = containerIds();
  const touched = NEVER_TOUCHED.filter((service) => untouched[service] !== after[service]);
  if (touched.length) throw new Error(`${touched.join(", ")} restarted during the deploy; it must never be touched`);

  step("Cleaning up");
  fs.rmSync(out, { recursive: true, force: true });
  pruneSite();
  sh("docker", ["image", "prune", "-f", "--filter", `label=com.docker.compose.project=${path.basename(STACK)}`]);
  sh("docker", ["builder", "prune", "-f", "--filter", "until=168h"]);

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
