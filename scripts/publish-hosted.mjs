// Puts a built game into Convex file storage and makes it live (see convex/hosted.ts).
//   npm run game:publish -- mereddia dist-mereddia
// It talks to whatever .env.local points at, or CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY if set.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const TYPES = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json",
  bin: "application/octet-stream", png: "image/png", svg: "image/svg+xml", mp3: "audio/mpeg", woff2: "font/woff2", map: "application/json",
};
const COMPRESSIBLE = new Set(["html", "js", "css", "json", "bin", "svg", "map"]);
const AT_ONCE = 8;

const walk = (dir, under = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${under}${e.name}/`) : [`${under}${e.name}`]));

export async function publish({ url, adminKey, game, dir, log = () => {} }) {
  if (!existsSync(path.join(dir, "index.html"))) throw new Error(`${dir} has no index.html`);
  const client = new ConvexHttpClient(url);
  client.setAdminAuth(adminKey);
  const paths = walk(dir).sort();
  // The same files make the same build, so publishing twice uploads the files again but changes nothing.
  const hash = createHash("sha256");
  for (const p of paths) hash.update(p).update(readFileSync(path.join(dir, p)));
  const build = hash.digest("hex").slice(0, 12);

  let next = 0;
  let sent = 0;
  const worker = async () => {
    while (next < paths.length) {
      const p = paths[next++];
      const ext = p.split(".").pop().toLowerCase();
      const raw = readFileSync(path.join(dir, p));
      const packed = COMPRESSIBLE.has(ext) ? gzipSync(raw, { level: 9 }) : raw;
      const gzip = packed.length < raw.length;
      const body = gzip ? packed : raw;
      const type = TYPES[ext] ?? "application/octet-stream";
      const res = await fetch(await client.mutation(anyApi.hosted.uploadUrl, {}), { method: "POST", headers: { "Content-Type": type }, body });
      if (!res.ok) throw new Error(`Uploading ${p}: ${res.status} ${await res.text()}`);
      const { storageId } = await res.json();
      await client.mutation(anyApi.hosted.addFile, { game, build, path: p, storageId, type, gzip });
      sent += body.length;
      log(`${next}/${paths.length} ${p}`);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  await client.mutation(anyApi.hosted.publish, { game, build });
  return { build, files: paths.length, bytes: sent };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [game, dir] = process.argv.slice(2);
  if (!game || !dir) throw new Error("Usage: npm run game:publish -- <game> <dir>");
  const local = existsSync(".env.local") ? Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])) : {};
  const url = process.env.CONVEX_SELF_HOSTED_URL ?? local.CONVEX_SELF_HOSTED_URL;
  const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY ?? local.CONVEX_SELF_HOSTED_ADMIN_KEY;
  const done = await publish({ url, adminKey, game, dir });
  console.log(`Published ${game} build ${done.build}: ${done.files} files, ${(done.bytes / 1e6).toFixed(1)} MB stored`);
}
