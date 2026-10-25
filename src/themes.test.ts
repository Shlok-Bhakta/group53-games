import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parse, wcagContrast } from "culori";
import { PALETTES } from "./themes";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

// Pulls the custom properties out of the light or dark block for a theme.
function tokens(id: string, mode: "light" | "dark") {
  const selector = mode === "light" ? `[data-palette="${id}"]` : `.dark[data-palette="${id}"]`;
  const start = css.indexOf(mode === "light" ? `${selector}${id === "felt" ? ", :root" : ""} {` : `:is(${selector}`);
  expect(start, `${id} ${mode} block`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const REQUIRED = ["background", "foreground", "card", "primary", "primary-foreground", "muted", "muted-foreground", "border", "destructive", "tile-green", "tile-yellow", "tile-gray", "tile-hit", "tile-ink", "tile-yellow-ink", "tile-gray-ink", "tile-hit-ink", "tile-blank", "tile-edge", "board-light", "board-dark"];

const contrast = (a: string, b: string) => wcagContrast(parse(a)!, parse(b)!);

describe.each(PALETTES.map((p) => p.id))("theme %s", (id) => {
  describe.each(["light", "dark"] as const)("%s", (mode) => {
    const t = tokens(id, mode);

    test("defines every token", () => {
      expect(REQUIRED.filter((k) => !t[k])).toEqual([]);
    });

    // WCAG AA for text; tiles are big bold letters, so they only need large-text contrast.
    const checks: [string, string, string, number][] = [
      ["foreground on background", "foreground", "background", 4.5],
      ["foreground on card", "foreground", "card", 4.5],
      ["muted text on card", "muted-foreground", "card", 4.5],
      ["primary button text", "primary-foreground", "primary", 4.5],
      ["destructive text on card", "destructive", "card", 4.5],
      ["green tile letter", "tile-ink", "tile-green", 3],
      ["yellow tile letter", "tile-yellow-ink", "tile-yellow", 3],
      ["gray tile letter", "tile-gray-ink", "tile-gray", 3],
      ["red tile letter", "tile-hit-ink", "tile-hit", 3],
    ];

    test("text and tiles are readable", () => {
      const failures = checks
        .map(([label, fg, bg, min]) => [label, contrast(t[fg], t[bg]), min] as const)
        .filter(([, ratio, min]) => ratio < min)
        .map(([label, ratio, min]) => `${label}: ${ratio.toFixed(2)} < ${min}`);
      expect(failures).toEqual([]);
    });
  });
});
