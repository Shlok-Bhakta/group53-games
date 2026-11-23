import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { formatHex, interpolate, parse, wcagContrast } from "culori";
import { FRAME_COLOR } from "../../../convex/palette";
import { PALETTES } from "../../themes";
import { moveInk, playerColors, swatchesApart, TOO_CLOSE } from "./colors";
import { SERIES } from "./palette";

const css = readFileSync(new URL("../../style.css", import.meta.url), "utf8");

function seriesIn(selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return [...body.matchAll(/--series-(\d):\s*([^;]+);/g)].map((m) => m[2].trim());
}

function block(start: number) {
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function themeTokens(id: string, mode: "light" | "dark") {
  const start =
    mode === "light"
      ? css.indexOf(`[data-palette="${id}"]${id === "felt" ? ", :root" : ""} {`)
      : css.indexOf(`:is(.dark[data-palette="${id}"]`);
  const end = css.indexOf("/* gen-themes.py: end */");
  const own = css.slice(end);
  const modeVars = block(own.indexOf(mode === "light" ? "\n:root {" : "\n.dark {") + end);
  return { ...block(start), ...modeVars };
}

function resolve(value: string, tokens: Record<string, string>): string {
  const v = value.trim();
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) return resolve(tokens[ref[1]], tokens);
  const mix = /^color-mix\(in (oklab|oklch), (.+?)(?: (\S+%|var\(--[\w-]+\)))?, (.+?)(?: (\S+%|var\(--[\w-]+\)))?\)$/.exec(v);
  if (!mix) return formatHex(parse(v)!)!;
  const [, space, a, pa, b, pb] = mix;
  const pct = (p: string) => parseFloat(tokens[/^var\(--([\w-]+)\)$/.exec(p)?.[1] ?? ""] ?? p) / 100;
  const share = pb ? 1 - pct(pb) : pa ? pct(pa) : 0.5;
  return formatHex(interpolate([resolve(a, tokens), resolve(b, tokens)], space as "oklab" | "oklch")(1 - share))!;
}

const swatchOf = (color: string) => {
  const slot = /^var\(--series-(\d)\)$/.exec(color);
  return slot ? ([SERIES.light[+slot[1] - 1], SERIES.dark[+slot[1] - 1]] as const) : ([color, color] as const);
};

function closestPair(crew: Parameters<typeof playerColors>[0]) {
  const colors = [...playerColors(crew).values()].map((c) => swatchOf(c.color));
  let closest = Infinity;
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++) closest = Math.min(closest, swatchesApart(colors[i], colors[j]));
  return closest;
}

const player = (n: number, frame?: string, frameColor?: string) => ({ userId: `u${n}`, joinedAt: n, frame, frameColor });

describe("player colours", () => {
  test("the series mirror style.css", () => {
    expect(seriesIn(":root")).toEqual(SERIES.light);
    expect(seriesIn(".dark")).toEqual(SERIES.dark);
  });

  test("a fire frame and a frameless player never share a red", () => {
    const crew = [player(1, "ice"), player(2, "gold"), player(3, "holo"), player(4, "fire"), player(5)];
    const colors = playerColors(crew);
    expect(colors.get("u4")!.color).toBe(FRAME_COLOR.red);
    expect(colors.get("u5")!.color).not.toBe("var(--series-2)");
    expect(closestPair(crew)).toBeGreaterThanOrEqual(TOO_CLOSE);
  });

  test("eight frameless players get eight series colours, then dashes", () => {
    const crew = Array.from({ length: 10 }, (_, i) => player(i));
    const colors = [...playerColors(crew).values()];
    expect(new Set(colors.slice(0, 8).map((c) => c.color)).size).toBe(8);
    expect(colors.slice(0, 8).every((c) => !c.dash)).toBe(true);
    expect(colors.slice(8).every((c) => c.dash)).toBe(true);
  });

  test("five frameless players are all told apart", () => {
    expect(closestPair(Array.from({ length: 5 }, (_, i) => player(i)))).toBeGreaterThanOrEqual(TOO_CLOSE);
  });

  const frames = Object.values(FRAME_COLOR).filter((c) => c !== FRAME_COLOR.white);
  const trios = frames.flatMap((a, i) => frames.slice(i + 1).flatMap((b, j) => frames.slice(i + j + 2).map((c) => [a, b, c])));
  test.each(trios)("three custom frames %s %s %s and two frameless players are all told apart", (a, b, c) => {
    const crew = [player(1, "solid", a), player(2, "solid", b), player(3, "solid", c), player(4), player(5)];
    expect(closestPair(crew)).toBeGreaterThanOrEqual(TOO_CLOSE);
  });
});

describe.each(PALETTES.map((p) => p.id))("move carets in %s", (id) => {
  test.each(["light", "dark"] as const)("%s keep 3:1 on the card at every size", (mode) => {
    const tokens = themeTokens(id, mode);
    const card = resolve(tokens.card, tokens);
    for (const pct of [0, 0.01, 0.03, 0.07, 0.3, -0.001, -0.01, -0.03, -0.07, -0.3])
      expect(wcagContrast(resolve(moveInk(pct), tokens), card), `${pct}`).toBeGreaterThanOrEqual(3);
  });
});
