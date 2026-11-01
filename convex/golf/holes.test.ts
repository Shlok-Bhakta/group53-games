import { describe, expect, test } from "vitest";
import { groundAt, HAZARDS, inPoly } from "./engine";
import { COURSES, courseOf, HOLES, worldOf } from "./holes";
import { start, takeShot } from "./scenarios";
import { SOLUTIONS } from "./solutions";
import { pack } from "./world";

describe("the eighteen holes", () => {
  test("nine on grass and nine on ice, with stable ids", () => {
    expect(COURSES.map((c) => [c.id, c.holes.length])).toEqual([["plains", 9], ["cold", 9]]);
    expect(new Set(HOLES.map((h) => h.id)).size).toBe(18);
    expect(COURSES[0].holes.every((h) => h.theme === "hills" && (h.surface ?? "green") === "green")).toBe(true);
    expect(COURSES[1].holes.every((h) => h.theme === "ice" && h.surface === "packed")).toBe(true);
    expect(courseOf("cold-3")?.name).toBe("Snowplow");
    expect(courseOf("nope")).toBeNull();
  });

  for (const h of HOLES)
    describe(`${h.id} ${h.name}`, () => {
      test("everything's on the board, and nothing starts in the water", () => {
        const w = worldOf(h);
        const onBoard = (p: { x: number; y: number }) => h.greens.some((g) => inPoly(p, g.poly));
        expect(h.par).toBeGreaterThanOrEqual(2);
        for (const t of [h.tee, ...(h.tees ?? [])]) {
          expect(onBoard(t)).toBe(true);
          expect(HAZARDS).not.toContain(groundAt(w, t));
        }
        expect(onBoard(h.cup)).toBe(true);
        expect(HAZARDS).not.toContain(groundAt(w, h.cup));
        for (const b of h.boxes) expect(HAZARDS, `box at ${b.x},${b.y}`).not.toContain(groundAt(w, b));
        for (const m of h.mines ?? []) expect(onBoard(m), `mine at ${m.x},${m.y}`).toBe(true);
        for (const b of h.bumpers) expect(onBoard(b.at), `bumper at ${b.at.x},${b.at.y}`).toBe(true);
        for (const p of h.portals.flatMap((q) => [q.a, q.b])) expect(onBoard(p)).toBe(true);
        // Room for a few players to start without touching.
        expect(h.tees?.length ?? 0).toBeGreaterThanOrEqual(3);
      });

      test("can be sunk, and within par by someone who hits it exactly", () => {
        const line = SOLUTIONS[h.id];
        expect(line, "run scripts/golf-solve.ts").toBeTruthy();
        expect(line.length).toBeLessThanOrEqual(h.par);
        let state = start(h);
        let sunk = false;
        line.forEach(([a, p]) => {
          const r = takeShot(h, state, a, p);
          sunk = r.sunk;
          state = pack(r.s);
        });
        expect(sunk).toBe(true);
      });
    });
});
