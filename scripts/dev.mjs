// The steps behind dekit.yaml: a local Convex backend in Docker, our functions on it, and the stonks sidecar.
// Everything it makes is in .dev/ and a Docker volume; `npm run dev:reset` wipes both.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
process.chdir(ROOT);

const CONVEX_URL = "http://127.0.0.1:3210";
// The backend checks session tokens by fetching this from inside its container, where the site is always on 3211.
// Nothing outside needs it without Discord, so it isn't published and `npm run test:e2e` can have host port 3211.
const SITE_URL = "http://127.0.0.1:3211";
const CONVEX = "group53-dev-convex";
const STONKS = "group53-dev-stonks";
const VOLUME = `group53-dev-${createHash("sha256").update(ROOT).digest("hex").slice(0, 8)}`;
const STATE = ".dev/state.json";
const ADMIN_KEY = ".dev/admin_key";

const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};
const run = (cmd, args, options = {}) => {
  const { status } = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (status !== 0) process.exit(status ?? 1);
};
// Runs until stopped, as the dekit task itself.
const serve = (cmd, args, options = {}) => {
  const child = spawn(cmd, args, { stdio: "inherit", ...options });
  child.on("exit", (code) => process.exit(code ?? 1));
};
const quietly = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" });
const state = () => JSON.parse(readFileSync(STATE, "utf8"));

// Always named outright: a checkout with kiwi's keys in .env.local must never push there from here.
function cliEnv() {
  return {
    ...process.env,
    CONVEX_SELF_HOSTED_URL: CONVEX_URL,
    CONVEX_SELF_HOSTED_ADMIN_KEY: readFileSync(ADMIN_KEY, "utf8").trim(),
    CONVEX_DEPLOYMENT: "",
  };
}

function installIfStale(dir) {
  const lock = path.join(dir, "package-lock.json");
  const installed = path.join(dir, "node_modules/.package-lock.json");
  if (existsSync(installed) && statSync(installed).mtimeMs >= statSync(lock).mtimeMs) return;
  console.log(`Installing packages in ${dir}`);
  run("npm", ["ci"], { cwd: dir });
}

// The sidecar builds in a container, so nobody needs Rust, and its build is kept in a volume, so changing it is quick.
function cargo(command) {
  return [
    "-v", `${ROOT}/stonks:/src:ro`, "-v", "group53-dev-cargo:/usr/local/cargo/registry", "-v", "group53-dev-target:/target",
    "-e", "CARGO_TARGET_DIR=/target", "-w", "/src", "docker.io/library/rust:1-alpine",
    "sh", "-c", `apk add --no-cache musl-dev && cargo ${command} --locked`,
  ];
}

const steps = {
  async setup() {
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 22) fail(`This needs Node 22 or newer, and this is ${process.version}.`);
    if (quietly("docker", ["info"]).status !== 0) fail("This needs Docker (or Podman as `docker`), running. `docker info` failed.");
    installIfStale(".");
    installIfStale("og");
    if (existsSync(STATE)) return;
    // No keys means the data in any old volume can't be read.
    quietly("docker", ["volume", "rm", "-f", VOLUME]);
    const { generateVars } = await import("../e2e/backend.mjs");
    mkdirSync(".dev", { recursive: true });
    writeFileSync(
      STATE,
      JSON.stringify({ instanceSecret: randomBytes(32).toString("hex"), vars: { ...generateVars(), SITE_URL: "http://127.0.0.1:5173", DEV_AUTH: "1" } }),
      { mode: 0o600 },
    );
  },

  async convex() {
    const { resolveImage } = await import("../e2e/backend.mjs");
    quietly("docker", ["rm", "-f", CONVEX]);
    serve("docker", [
      "run", "--rm", "--name", CONVEX, "--stop-signal", "SIGINT",
      "-p", "127.0.0.1:3210:3210", "-v", `${VOLUME}:/convex/data`,
      "-e", "INSTANCE_NAME=group53-dev", "-e", `INSTANCE_SECRET=${state().instanceSecret}`,
      "-e", `CONVEX_CLOUD_ORIGIN=${CONVEX_URL}`, "-e", `CONVEX_SITE_ORIGIN=${SITE_URL}`,
      "-e", "DO_NOT_REQUIRE_SSL=true", "-e", "DISABLE_BEACON=true",
      resolveImage(),
    ]);
  },

  functions() {
    const adminKey = execFileSync("docker", ["exec", CONVEX, "./generate_admin_key.sh"]).toString().trim().split("\n").pop();
    writeFileSync(ADMIN_KEY, adminKey, { mode: 0o600 });
    const env = cliEnv();
    const convex = (...args) => run("npx", ["convex", ...args], { env });
    const set = execFileSync("npx", ["convex", "env", "list"], { env }).toString();
    if (!set.includes("DEV_AUTH=")) {
      convex("deploy", "-y");
      for (const [name, value] of Object.entries(state().vars)) convex("env", "set", "--", name, value);
      convex("run", "devAuth:seed");
    }
    serve("npx", ["convex", "dev"], { env });
  },

  // In the backend's own network, so 127.0.0.1:3210 is the backend on Docker and Podman alike, on any OS.
  stonks() {
    quietly("docker", ["rm", "-f", STONKS]);
    serve("docker", ["run", "--rm", "--name", STONKS, "--network", `container:${CONVEX}`, "-e", `CONVEX_URL=${CONVEX_URL}`, "-e", "ADMIN_KEY", ...cargo("run")], {
      env: { ...process.env, ADMIN_KEY: readFileSync(ADMIN_KEY, "utf8").trim() },
    });
  },

  "test-sidecar"() {
    run("docker", ["run", "--rm", ...cargo("test")]);
  },

  reset() {
    quietly("docker", ["rm", "-f", STONKS, CONVEX]);
    quietly("docker", ["volume", "rm", "-f", VOLUME, "group53-dev-cargo", "group53-dev-target"]);
    rmSync(".dev", { recursive: true, force: true });
    console.log("Local data is gone. The next `dekit` starts fresh.");
  },
};

const step = steps[process.argv[2]];
if (!step) fail(`Usage: node scripts/dev.mjs ${Object.keys(steps).join("|")}`);
await step();
