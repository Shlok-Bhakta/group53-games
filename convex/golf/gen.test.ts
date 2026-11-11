import { describe, expect, test } from "vitest";
import { generateHole, problems } from "./gen";

// The generator: every hole it keeps passes the checks (and the bot sank it to get kept), the same seed
// makes the same hole, and the settings get what they ask for.

describe("generated holes", () => {
  const cases = [
    { seed: 101, n: 0, terrain: 0, style: 0, hazards: 1 },
    { seed: 101, n: 4, terrain: 1, style: 0, hazards: 2 },
    { seed: 202, n: 2, terrain: 0, style: 1, hazards: 1 },
    { seed: 202, n: 7, terrain: 1, style: 1, hazards: 0 },
    { seed: 303, n: 5, terrain: 2, style: 2, hazards: 2 },
  ];
  for (const o of cases)
    test(`seed ${o.seed}, hole ${o.n + 1}, terrain ${o.terrain}, style ${o.style}`, () => {
      const log: string[] = [];
      const c = generateHole(o, (m) => log.push(m));
      expect(log.some((l) => l.startsWith("kept")), log.join("\n")).toBe(true);
      expect(problems(c, c.zones.some((z) => z.kind === "ramp"))).toBeNull();
      expect(c.par).toBeGreaterThanOrEqual(2);
      expect(c.par).toBeLessThanOrEqual(7);
      if (o.terrain === 1) expect(c.theme).toBe("ice");
      if (o.terrain === 0) expect(c.theme).toBe("hills");
      // Fairways have no rail round them; mini golf does.
      if (o.style === 1) expect(c.greens.every((g) => g.rim === false)).toBe(true);
      if (o.style === 0) expect(c.greens.every((g) => g.rim !== false)).toBe(true);
      expect(generateHole(o)).toEqual(c);
    }, 60_000);

  test("a course's holes aren't all the same shape", () => {
    const names = new Set<string>();
    const shapes = new Set<string>();
    for (let n = 0; n < 5; n++) {
      const log: string[] = [];
      const c = generateHole({ seed: 7, n, terrain: 0, style: 0, hazards: 1 }, (m) => log.push(m));
      names.add(c.name);
      shapes.add(log.find((l) => l.startsWith("kept"))!.split(" ")[1]);
    }
    expect(shapes.size).toBeGreaterThanOrEqual(3);
    expect(names.size).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
