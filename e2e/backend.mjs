// Starts a throwaway self-hosted Convex backend in Docker (the same image as kiwi), pushes our
// functions, configures auth, and builds the web app against it. Run through e2e/run.mjs.
import { execFileSync, execSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import webpush from "web-push";

// Same backend build as compose.yaml. A re-saved copy (for example `ssh kiwi docker save ... | podman load`)
// keeps the image ID but not the registry digest, so fall back to the ID.
const IMAGE_DIGEST = "ghcr.io/get-convex/convex-backend@sha256:01aaebb72d7e9a32c82d183b3a25ffe15278f4dc656ecf30b21777691929d1ab";
const IMAGE_ID = "6549447f0490";

function resolveImage() {
  if (process.env.E2E_CONVEX_IMAGE) return process.env.E2E_CONVEX_IMAGE;
  for (const ref of [IMAGE_DIGEST, IMAGE_ID]) {
    try {
      execFileSync("docker", ["image", "inspect", ref], { stdio: "ignore" });
      return ref;
    } catch {}
  }
  return IMAGE_DIGEST;
}
export const STATE_FILE = path.resolve("e2e/.state/backend.json");
const ROOT = path.resolve(".");

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function startBackend({ build = true } = {}) {
  const apiPort = await freePort();
  // The backend verifies session tokens by fetching its own site origin from inside the container,
  // where the site proxy always listens on 3211. Binding host port 3211 too makes one URL work on both sides.
  const sitePort = 3211;
  const name = `group53-e2e-${randomBytes(3).toString("hex")}`;
  const url = `http://127.0.0.1:${apiPort}`;
  const siteUrl = `http://127.0.0.1:${sitePort}`;
  execFileSync("docker", [
    "run", "-d", "--rm", "--name", name,
    "-p", `127.0.0.1:${apiPort}:3210`, "-p", `127.0.0.1:${sitePort}:3211`,
    "-e", `INSTANCE_SECRET=${randomBytes(32).toString("hex")}`, "-e", "INSTANCE_NAME=group53-e2e",
    "-e", `CONVEX_CLOUD_ORIGIN=${url}`, "-e", `CONVEX_SITE_ORIGIN=${siteUrl}`,
    "-e", "DO_NOT_REQUIRE_SSL=true", "-e", "DISABLE_BEACON=true",
    resolveImage(),
  ], { stdio: ["ignore", "ignore", "inherit"] });
  await waitFor(`${url}/version`);
  const adminKey = execFileSync("docker", ["exec", name, "./generate_admin_key.sh"]).toString().trim().split("\n").pop();

  const env = { ...process.env, CONVEX_SELF_HOSTED_URL: url, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey, CONVEX_DEPLOYMENT: "" };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...publicKey.export({ format: "jwk" }) }] });
  const vapid = webpush.generateVAPIDKeys();
  const vars = {
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, " "),
    JWKS: jwks,
    SITE_URL: "http://127.0.0.1:4573",
    AUTH_DISCORD_ID: "1234567890",
    AUTH_DISCORD_SECRET: "e2e-not-a-secret",
    VAPID_SUBJECT: "https://example.com",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    ALLOW_TEST_HELPERS: "1",
  };
  // The CLI reads the self-hosted target from the environment; deploy first so env vars apply to a live deployment.
  execSync("npx convex deploy -y", { cwd: ROOT, env, stdio: "inherit" });
  for (const [k, v] of Object.entries(vars)) execFileSync("npx", ["convex", "env", "set", "--", k, v], { cwd: ROOT, env, stdio: "ignore" });
  if (build) execSync("npx vite build --outDir e2e/.state/dist --emptyOutDir", { cwd: ROOT, env: { ...env, VITE_CONVEX_URL: url }, stdio: "inherit" });

  // The backend compiles each module the first time it runs; warm them so the first test isn't slow.
  for (const fn of ["testing:reset", "testing:createPlayer"]) {
    try {
      execFileSync("npx", ["convex", "run", fn, fn === "testing:createPlayer" ? '{"name":"warmup"}' : "{}"], { cwd: ROOT, env, stdio: "ignore" });
    } catch {}
  }
  execFileSync("npx", ["convex", "run", "testing:reset", "{}"], { cwd: ROOT, env, stdio: "ignore" });

  const state = { name, url, siteUrl, adminKey };
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
  return state;
}

export function stopBackend(name) {
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  } catch {}
}
