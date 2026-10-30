import { describe, expect, test } from "vitest";
import { compile, DT, rng } from "./engine";
import { datan, datan2, dcos, dexp, dlog, dpow, dsin, hyp } from "./dmath";
import { SANDBOX } from "./sandbox";
import { advance, applyCmd, BOX_BACK, cmdOrder, fingerprint, MINE_BACK, newWorld, pack, TPS, unpack, type Cmd, type WorldState } from "./world";

const W = compile(SANDBOX);
const at = (s: WorldState, id: string) => s.balls.find((b) => b.id === id)!;
const angleTo = (s: WorldState, id: string, x: number, y: number) => datan2(y - at(s, id).y, x - at(s, id).x);

// A game three players play: they join, shoot about, use items. Shots are given as targets so they
// still mean something if the map changes; the angles are worked out with the portable math.
function script(): Cmd[] {
  let seq = 0;
  const c = (tick: number, by: string, kind: Cmd["kind"], extra: Partial<Cmd> = {}): Cmd => ({ tick, by, seq: seq++, kind, ...extra });
  return [
    c(0, "ann", "join"),
    c(5, "bo", "join"),
    c(9, "cy", "join"),
    // Ann straight up the plaza toward the lagoon; Bo across at Ann's tee; Cy into the bumper park.
    c(20, "ann", "shot", { a: -1.5707963267948966, p: 0.62 }),
    c(24, "bo", "shot", { a: 3.0, p: 0.4 }),
    c(30, "cy", "shot", { a: -2.2, p: 0.95 }),
    c(TPS * 6, "ann", "shot", { a: 0.4, p: 0.8 }),
    c(TPS * 6 + 3, "bo", "shot", { a: -1.2, p: 1 }),
    c(TPS * 7, "cy", "shot", { a: -0.3, p: 0.7 }),
  ];
}

function run(to: number, chunks?: number[]) {
  const s = newWorld(SANDBOX);
  const cmds = script().sort(cmdOrder);
  if (!chunks) advance(s, W, to, cmds);
  else {
    let k = 0;
    while (s.tick < to) advance(s, W, Math.min(to, s.tick + chunks[k++ % chunks.length]), cmds);
  }
  return s;
}

describe("portable math", () => {
  test("matches Math to within a hair, everywhere a game goes", () => {
    const r = rng(7);
    for (let i = 0; i < 5000; i++) {
      const x = (r() - 0.5) * 60;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-13);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-13);
      const y = (r() - 0.5) * 40, z = (r() - 0.5) * 40;
      expect(Math.abs(datan2(y, z) - Math.atan2(y, z))).toBeLessThan(1e-13);
      expect(Math.abs(hyp(y, z) - Math.hypot(y, z))).toBeLessThan(1e-12);
      const p = r() * 3;
      expect(Math.abs(dpow(p, 0.6) - p ** 0.6)).toBeLessThan(1e-12);
      expect(Math.abs(dexp(y / 4) - Math.exp(y / 4)) / Math.exp(y / 4)).toBeLessThan(1e-13);
      expect(Math.abs(dlog(p + 0.01) - Math.log(p + 0.01))).toBeLessThan(1e-13);
    }
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(1, 0)).toBeCloseTo(Math.PI / 2, 15);
    expect(datan2(0, -1)).toBeCloseTo(Math.PI, 15);
    expect(Math.abs(datan(1e9) - Math.atan(1e9))).toBeLessThan(1e-15);
  });
});

describe("the world", () => {
  test("a scripted game always ends the same way (pinned)", () => {
    const s = run(TPS * 14);
    expect(s.balls.map((b) => b.id)).toEqual(["ann", "bo", "cy"]);
    // If this changes, the physics changed: every phone must update together, and replays of old
    // games would come out differently. Update it only on purpose.
    expect(fingerprint(s)).toBe(PINNED);
  });

  test("running in one go or in any pieces comes out the same", () => {
    const whole = run(TPS * 14);
    for (const chunks of [[1], [7, 13, 240], [500], [3, 1000, 2]]) expect(fingerprint(run(TPS * 14, chunks))).toBe(fingerprint(whole));
  });

  test("a stored snapshot picks up exactly where it left off", () => {
    const cmds = script().sort(cmdOrder);
    const straight = newWorld(SANDBOX);
    advance(straight, W, TPS * 14, cmds);
    for (const cut of [25, TPS * 2 + 17, TPS * 6 + 1, TPS * 9]) {
      const s = newWorld(SANDBOX);
      advance(s, W, cut, cmds);
      // Through JSON, the way it's stored in Convex and sent to phones.
      const back = unpack(JSON.parse(JSON.stringify(pack(s))));
      advance(back, W, TPS * 14, cmds);
      expect(fingerprint(back)).toBe(fingerprint(straight));
      expect(pack(back)).toEqual(pack(straight));
    }
  });

  test("commands land in the same order however they arrive", () => {
    const shuffled = script().reverse().sort(cmdOrder);
    const s = newWorld(SANDBOX);
    advance(s, W, TPS * 14, shuffled);
    expect(fingerprint(s)).toBe(fingerprint(run(TPS * 14)));
  });

  test("an idle world catches up a day in no time", () => {
    const s = newWorld(SANDBOX);
    const t0 = performance.now();
    advance(s, W, TPS * 60 * 60 * 24, script().sort(cmdOrder));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(s.balls.every((b) => b.mode === "aim")).toBe(true);
  });

  test("everyone starts on their own tee", () => {
    const s = newWorld(SANDBOX);
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) applyCmd(s, SANDBOX, { tick: 0, by: id, seq: 0, kind: "join" });
    applyCmd(s, SANDBOX, { tick: 0, by: "a", seq: 1, kind: "join" });
    expect(s.balls).toHaveLength(8);
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) expect(hyp(s.balls[i].x - s.balls[j].x, s.balls[i].y - s.balls[j].y)).toBeGreaterThan(1.4);
  });
});

describe("players affect each other", () => {
  function two(collide: boolean) {
    const s = newWorld(SANDBOX, { collide });
    applyCmd(s, SANDBOX, { tick: 0, by: "a", seq: 0, kind: "join" });
    applyCmd(s, SANDBOX, { tick: 0, by: "b", seq: 0, kind: "join" });
    const b = at(s, "b");
    const cmds: Cmd[] = [{ tick: 10, by: "a", seq: 1, kind: "shot", a: angleTo(s, "a", b.x, b.y), p: 0.5 }];
    const from = { x: b.x, y: b.y };
    advance(s, W, TPS * 6, cmds);
    return { s, moved: hyp(at(s, "b").x - from.x, at(s, "b").y - from.y) };
  }

  test("a ball knocks into another, and the other one rolls", () => {
    const { s, moved } = two(true);
    expect(moved).toBeGreaterThan(1);
    expect(s.balls.every((b) => b.mode === "aim")).toBe(true);
  });

  test("with ball hits off, balls roll through each other", () => {
    expect(two(false).moved).toBe(0);
  });

  test("an Orbital Laser throws someone else's ball", () => {
    const s = newWorld(SANDBOX);
    applyCmd(s, SANDBOX, { tick: 0, by: "a", seq: 0, kind: "join" });
    applyCmd(s, SANDBOX, { tick: 0, by: "b", seq: 0, kind: "join" });
    at(s, "a").bag.push("laser");
    const b = at(s, "b");
    const from = { x: b.x, y: b.y };
    // Looked at in flight: thrown that hard it usually ends up in the sea, which puts it back.
    advance(s, W, TPS * 1.5, [{ tick: 5, by: "a", seq: 1, kind: "fire", i: 0, x: b.x + 0.5, y: b.y }]);
    expect(hyp(at(s, "b").x - from.x, at(s, "b").y - from.y)).toBeGreaterThan(1);
    expect(at(s, "a").bag).toEqual([]);
  });

  test("a Rail Gun shoves anyone on its line", () => {
    const s = newWorld(SANDBOX);
    applyCmd(s, SANDBOX, { tick: 0, by: "a", seq: 0, kind: "join" });
    applyCmd(s, SANDBOX, { tick: 0, by: "b", seq: 0, kind: "join" });
    at(s, "a").bag.push("railgun");
    const b = at(s, "b");
    const from = { x: b.x, y: b.y };
    advance(s, W, TPS * 0.6, [{ tick: 5, by: "a", seq: 1, kind: "fire", i: 0, x: b.x, y: b.y }]);
    expect(hyp(at(s, "b").x - from.x, at(s, "b").y - from.y)).toBeGreaterThan(1);
  });
});

describe("the map keeps itself going", () => {
  test("an opened box comes back", () => {
    const s = newWorld(SANDBOX);
    applyCmd(s, SANDBOX, { tick: 0, by: "a", seq: 0, kind: "join" });
    // Box 2 sits straight up the plaza from the first tee.
    const box = SANDBOX.boxes[2];
    advance(s, W, TPS * 8, [{ tick: 3, by: "a", seq: 1, kind: "shot", a: angleTo(s, "a", box.x, box.y), p: 0.45 }]);
    expect(s.boxes[2]).toBe(true);
    expect(at(s, "a").bag).toHaveLength(1);
    advance(s, W, s.boxBack[2] + 1, []);
    expect(s.boxes[2]).toBe(false);
    expect(s.boxBack[2]).toBe(-1);
    expect(BOX_BACK).toBe(20 * TPS);
  });

  test("the map's mines re-arm; dropped ones are gone once they go off", () => {
    const s = newWorld(SANDBOX);
    applyCmd(s, SANDBOX, { tick: 0, by: "a", seq: 0, kind: "join" });
    const a = at(s, "a");
    a.bag.push("mine");
    // A mine dropped a little way up from the ball, then a shot through it.
    advance(s, W, TPS * 6, [
      { tick: 2, by: "a", seq: 1, kind: "fire", i: 0, x: a.x, y: a.y - 4 },
      { tick: 4, by: "a", seq: 2, kind: "shot", a: -Math.PI / 2, p: 0.35 },
    ]);
    expect(s.mines).toHaveLength(SANDBOX.mines!.length);
    // One of the map's own: set it off by hand and watch it come back.
    s.mines[0].live = false;
    advance(s, W, s.tick + 2, []);
    expect(s.mines[0].back).toBeGreaterThan(s.tick);
    advance(s, W, s.tick + MINE_BACK, []);
    expect(s.mines[0].live).toBe(true);
  });

  test("sinking one puts you back on a tee and counts it", () => {
    const s = newWorld(SANDBOX);
    applyCmd(s, SANDBOX, { tick: 0, by: "a", seq: 0, kind: "join" });
    const a = at(s, "a");
    // Right next to the beach flag, then a tap in.
    const cup = SANDBOX.cups![2];
    Object.assign(a, { x: cup.x + 1.5, y: cup.y, rest: { x: cup.x + 1.5, y: cup.y } });
    advance(s, W, TPS * 5, [{ tick: 1, by: "a", seq: 1, kind: "shot", a: Math.PI, p: 0.22 }]);
    expect(at(s, "a").holes).toBe(1);
    expect(at(s, "a").mode).toBe("aim");
    expect(hyp(at(s, "a").x - cup.x, at(s, "a").y - cup.y)).toBeGreaterThan(10);
  });
});

// Ticks are whole engine steps.
test("a tick is one engine step", () => expect(TPS * DT).toBe(1));

const PINNED = 2102668566;
