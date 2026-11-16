import { execFileSync, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import webpush from "web-push";

const IMAGE_DIGEST = "ghcr.io/convex/convex-backend@sha256:01aaebb72d7e9a32c82d183b3a25ffe15278f4dc656ecf30b21777691929d1ab";
// platform: an image re-saved through `docker save | docker load` keeps its ID but loses the registry digest.
const IMAGE_ID = "6549447f0490";

const haveImage = (ref) => spawnSync("docker", ["image", "inspect", ref], { stdio: "ignore" }).status === 0;

export function resolveImage() {
  if (process.env.E2E_CONVEX_IMAGE) return process.env.E2E_CONVEX_IMAGE;
  return [IMAGE_DIGEST, IMAGE_ID].find(haveImage) ?? IMAGE_DIGEST;
}
const COMPILE_EACH_MODULE_ONCE = [
  ["mutation", "testing:reset", {}],
  ["action", "testing:createPlayer", { name: "warmup" }],
];

const ROOT = path.resolve(".");
const slotDir = (slot) => path.resolve(slot === 1 ? "e2e/.state" : `e2e/.state/slot-${slot}`);
export const stateFile = (slot = 1) => path.join(slotDir(slot), "backend.json");
export const hostOf = (slot = 1) => `127.0.0.${slot}`;
export const APP_PORT = 4573;
export const appUrl = (slot = 1) => `http://${hostOf(slot)}:${APP_PORT}`;

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const portFree = (host, port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });

async function waitForPort(host, port) {
  let told = false;
  while (!(await portFree(host, port))) {
    if (!told) console.log(`${host}:${port} is held by another e2e backend; waiting for it to finish...`);
    told = true;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function waitForUrl(url, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const up = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export function generateVars() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const vapid = webpush.generateVAPIDKeys();
  return {
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...publicKey.export({ format: "jwk" }) }] }),
    AUTH_DISCORD_ID: "1234567890",
    AUTH_DISCORD_SECRET: "not-a-secret",
    VAPID_SUBJECT: "https://example.com",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
  };
}

function inBackground(cmd, args, log, opts) {
  const out = openSync(log, "w");
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", out, out] });
    child.on("error", reject);
    child.on("close", (code) => {
      closeSync(out);
      if (code === 0) return resolve();
      process.stderr.write(readFileSync(log));
      reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function adminClient(url, adminKey) {
  const client = new ConvexHttpClient(url, {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("connection", "close");
      return fetch(input, { ...init, headers });
    },
  });
  client.setAdminAuth(adminKey);
  return (kind, name, args) => client[kind](makeFunctionReference(name), args);
}

const running = new Set();

export function buildApp(outDir, convexUrl) {
  mkdirSync(path.resolve("e2e/.state"), { recursive: true });
  return inBackground("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir"], path.resolve("e2e/.state/build.log"), {
    cwd: ROOT,
    env: { ...process.env, VITE_CONVEX_URL: convexUrl },
  });
}

export async function startBackend({ build = true, slot = 1 } = {}) {
  const host = hostOf(slot);
  const apiPort = await freePort();
  // platform: the backend checks session tokens by fetching its own site origin from inside its container, where it always listens on 3211, so the host binds 3211 too and one URL works on both sides. Every 127.0.0.x is loopback inside the container as well, so each slot gets its own address.
  const sitePort = 3211;
  await waitForPort(host, sitePort);
  const name = `group53-e2e-${randomBytes(3).toString("hex")}`;
  const url = `http://${host}:${apiPort}`;
  const siteUrl = `http://${host}:${sitePort}`;
  running.add(name);
  const dir = slotDir(slot);
  mkdirSync(dir, { recursive: true });
  const built = build ? buildApp("e2e/.state/dist", url) : Promise.resolve();
  built.catch(() => {});
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-p",
      `${host}:${apiPort}:3210`,
      "-p",
      `${host}:${sitePort}:3211`,
      "-e",
      `INSTANCE_SECRET=${randomBytes(32).toString("hex")}`,
      "-e",
      "INSTANCE_NAME=group53-e2e",
      "-e",
      `CONVEX_CLOUD_ORIGIN=${url}`,
      "-e",
      `CONVEX_SITE_ORIGIN=${siteUrl}`,
      "-e",
      "DO_NOT_REQUIRE_SSL=true",
      "-e",
      "DISABLE_BEACON=true",
      resolveImage(),
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  try {
    await waitForUrl(`${url}/version`);
    const adminKey = execFileSync("docker", ["exec", name, "./generate_admin_key.sh"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .split("\n")
      .pop();

    const env = { ...process.env, CONVEX_SELF_HOSTED_URL: url, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey, CONVEX_DEPLOYMENT: "" };
    const vars = { ...generateVars(), SITE_URL: appUrl(slot), ALLOW_TEST_HELPERS: "1" };
    // platform: `convex env set` needs a deployment that's been deployed to.
    await inBackground("npx", ["convex", "deploy", "-y", "--typecheck", "disable", "--codegen", "disable"], path.join(dir, "deploy.log"), {
      cwd: ROOT,
      env,
    });
    const envFile = path.join(dir, "convex.env");
    writeFileSync(
      envFile,
      Object.entries(vars)
        .map(([k, v]) => `${k}='${v}'\n`)
        .join(""),
    );
    execFileSync("npx", ["convex", "env", "set", "--from-file", envFile], { cwd: ROOT, env, stdio: "ignore" });

    const call = adminClient(url, adminKey);
    for (const [kind, fn, args] of COMPILE_EACH_MODULE_ONCE) await call(kind, fn, args).catch(() => {});
    while (!(await call("mutation", "testing:reset", {})).done);
    await built;

    const state = { name, url, siteUrl, adminKey, slot, appUrl: appUrl(slot), stateFile: stateFile(slot) };
    writeFileSync(state.stateFile, JSON.stringify(state));
    return state;
  } catch (err) {
    stopBackend(name);
    throw err;
  }
}

export function stopRunning() {
  for (const name of running) stopBackend(name);
}

export function stopBackend(name) {
  running.delete(name);
  // platform: rootless Docker spends 10s on `rm -f` asking the backend to stop; a kill is instant and --rm still cleans up.
  if (spawnSync("docker", ["kill", name], { stdio: "ignore" }).status !== 0)
    spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
}
