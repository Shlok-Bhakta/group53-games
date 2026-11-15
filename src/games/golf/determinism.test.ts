import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, test } from "vitest";
import { allFingerprints } from "../../../convex/golf/scenarios";

const bun = [process.env.BUN, `${homedir()}/.bun/bin/bun`, "/usr/local/bin/bun", "/usr/bin/bun"].find((p) => p && existsSync(p));

describe("the same world on every engine", () => {
  const here = allFingerprints();

  test("chaotic games come out the same twice", () => {
    expect(allFingerprints()).toEqual(here);
  }, 60_000);

  if (!bun)
    console.warn("golf determinism: bun isn't installed, so JavaScriptCore vs V8 is NOT checked (install bun or set BUN=/path/to/bun)");
  test.skipIf(!bun)(
    `JavaScriptCore (iPhones) agrees with V8 (Android, the server)${bun ? "" : " [SKIPPED: bun not installed]"}`,
    () => {
      const out = execFileSync(bun!, ["scripts/golf-fingerprints.ts"], { encoding: "utf8", timeout: 120_000 });
      expect(JSON.parse(out.trim().split("\n").pop()!)).toEqual(here);
    },
    150_000,
  );
});
