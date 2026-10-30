import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, test } from "vitest";
import { allFingerprints } from "../../../convex/golf/scenarios";

// Multiplayer golf runs the same physics on every phone and on the server and expects the same world.
// iPhones run JavaScriptCore; Android phones and the server run V8 (which runs these tests). Bun is
// JavaScriptCore, so where it's installed this plays the same chaotic games under both and compares
// every bit.
const bun = [process.env.BUN, `${homedir()}/.bun/bin/bun`, "/usr/local/bin/bun", "/usr/bin/bun"].find((p) => p && existsSync(p));

describe("the same world on every engine", () => {
  const here = allFingerprints();

  test("chaotic games come out the same twice", () => {
    expect(allFingerprints()).toEqual(here);
  });

  test.skipIf(!bun)("JavaScriptCore (iPhones) agrees with V8 (Android, the server)", () => {
    const out = execFileSync(bun!, ["scripts/golf-fingerprints.ts"], { encoding: "utf8", timeout: 120_000 });
    expect(JSON.parse(out.trim().split("\n").pop()!)).toEqual(here);
  }, 150_000);
});
