import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { gzipSync, gunzipSync } from "node:zlib";

const modules = import.meta.glob("./**/*.ts");

async function addFile(t: ReturnType<typeof convexTest>, build: string, path: string, body: string | Uint8Array, opts: { type?: string; gzip?: boolean } = {}) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([body as BlobPart])));
  await t.mutation(internal.hosted.addFile, { game: "g", build, path, storageId, type: opts.type ?? "text/html; charset=utf-8", gzip: opts.gzip ?? false });
}

describe("hosted games", () => {
  beforeEach(() => vi.stubEnv("CONVEX_SITE_URL", "https://site.test"));
  afterEach(() => vi.unstubAllEnvs());

  test("nothing's live until a whole build is published", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.hosted.current, { game: "g" })).toBeNull();
    await addFile(t, "b1", "assets/a.js", "x");
    await expect(t.mutation(internal.hosted.publish, { game: "g", build: "b1" })).rejects.toThrow("no index.html");
    expect(await t.query(api.hosted.current, { game: "g" })).toBeNull();
    await addFile(t, "b1", "index.html", "<h1>hi</h1>");
    await t.mutation(internal.hosted.publish, { game: "g", build: "b1" });
    expect(await t.query(api.hosted.current, { game: "g" })).toBe("https://site.test/games/g/b1/index.html");
  });

  test("serves files with their type, forever, and 404s the rest", async () => {
    const t = convexTest(schema, modules);
    await addFile(t, "b1", "index.html", "<h1>hi</h1>");
    await addFile(t, "b1", "3d/a model.json", gzipSync('{"a":1}'), { type: "application/json", gzip: true });
    const page = await t.fetch("/games/g/b1/index.html");
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("Cache-Control")).toContain("immutable");
    expect(page.headers.get("Content-Encoding")).toBeNull();
    expect(await page.text()).toBe("<h1>hi</h1>");
    const packed = await t.fetch("/games/g/b1/3d/a%20model.json");
    expect(packed.headers.get("Content-Encoding")).toBe("gzip");
    expect(gunzipSync(new Uint8Array(await packed.arrayBuffer())).toString()).toBe('{"a":1}');
    expect((await t.fetch("/games/g/b1/nope.js")).status).toBe(404);
    expect((await t.fetch("/games/g/b2/index.html")).status).toBe(404);
    expect((await t.fetch("/games/other/b1/index.html")).status).toBe(404);
  });

  test("keeps the live build and the one before, and frees the rest", async () => {
    const t = convexTest(schema, modules);
    for (const build of ["b1", "b2", "b3"]) {
      await addFile(t, build, "index.html", build);
      await t.mutation(internal.hosted.publish, { game: "g", build });
    }
    expect(await t.query(api.hosted.current, { game: "g" })).toContain("/b3/");
    expect((await t.fetch("/games/g/b3/index.html")).status).toBe(200);
    expect((await t.fetch("/games/g/b2/index.html")).status).toBe(200);
    expect((await t.fetch("/games/g/b1/index.html")).status).toBe(404);
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length)).toBe(2);
  });

  test("publishing the live build again changes nothing", async () => {
    const t = convexTest(schema, modules);
    await addFile(t, "b1", "index.html", "one");
    await t.mutation(internal.hosted.publish, { game: "g", build: "b1" });
    await addFile(t, "b1", "index.html", "one");
    await t.mutation(internal.hosted.publish, { game: "g", build: "b1" });
    expect(await (await t.fetch("/games/g/b1/index.html")).text()).toBe("one");
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length)).toBe(1);
  });
});
