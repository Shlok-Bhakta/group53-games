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

  // A few seconds of physics; a busy machine can take several times that.
  test("chaotic games come out the same twice", () => {
    expect(allFingerprints()).toEqual(here);
  }, 60_000);

  // Without Bun this can't run, and a pass here would mean nothing: say so in the test's name and the log.
  if (!bun) console.warn("golf determinism: bun isn't installed, so JavaScriptCore vs V8 is NOT checked (install bun or set BUN=/path/to/bun)");
  test.skipIf(!bun)(`JavaScriptCore (iPhones) agrees with V8 (Android, the server)${bun ? "" : " [SKIPPED: bun not installed]"}`, () => {
    const out = execFileSync(bun!, ["scripts/golf-fingerprints.ts"], { encoding: "utf8", timeout: 120_000 });
    expect(JSON.parse(out.trim().split("\n").pop()!)).toEqual(here);
  }, 150_000);
});
