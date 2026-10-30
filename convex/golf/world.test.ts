import { describe, expect, test } from "vitest";
import { compile, DT, groundUnder, ICE_S, rng, type Power } from "./engine";
import { datan, datan2, dcos, dexp, dlog, dpow, dsin, hyp } from "./dmath";
import { SANDBOX } from "./sandbox";
import { advance, applyCmd, BOX_BACK, cmdOrder, fingerprint, MINE_BACK, newWorld, pack, REACH, STORM, TPS, unpack, type Cmd, type Packed, type WorldState } from "./world";

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

// Everyone on open grass on the plaza's north side, in a row, with whatever items they're given.
function crowd(ids: string[], items: Record<string, Power[]> = {}, xs = ids.map((_, i) => 40 + i * 6)) {
  const s = newWorld(SANDBOX);
  ids.forEach((id, i) => {
    applyCmd(s, SANDBOX, { tick: 0, by: id, seq: 0, kind: "join" });
    const b = at(s, id);
    Object.assign(b, { x: xs[i], y: 61, rest: { x: xs[i], y: 61 }, bag: items[id] ?? [] });
  });
  return s;
}
const moved = (s: WorldState, id: string, from: { x: number; y: number }) => hyp(at(s, id).x - from.x, at(s, id).y - from.y);
const evs = (s: WorldState, type: string, id?: string) => s.events.filter((e) => e.ev.type === type && (id === undefined || e.id === id));
let seq = 100;
const cmd = (tick: number, by: string, kind: Cmd["kind"], extra: Partial<Cmd> = {}): Cmd => ({ tick, by, seq: seq++, kind, ...extra });

describe("Super Battle Golf's items, on other players", () => {
  test("a Rocket Launcher homes in on the nearest player and throws them", () => {
    const s = crowd(["a", "b", "c"], { a: ["missile"] }, [40, 50, 70]);
    advance(s, W, TPS * 2, [cmd(5, "a", "use", { i: 0 })]);
    expect(at(s, "a").bag).toEqual([]);
    expect(evs(s, "missile", "a")).toHaveLength(1);
    // b was nearest; c, further off, wasn't the target.
    expect(evs(s, "mine", "b")).toHaveLength(1);
    expect(evs(s, "mine", "c")).toHaveLength(0);
    expect(s.missiles).toEqual([]);
  });

  test("a Rocket Launcher with nobody about stays in the bag", () => {
    const s = crowd(["a"], { a: ["missile"] });
    advance(s, W, 30, [cmd(5, "a", "use", { i: 0 })]);
    expect(at(s, "a").bag).toEqual(["missile"]);
  });

  test("an Electromagnet pops missiles and shrugs off lasers", () => {
    const s = crowd(["a", "b"], { a: ["missile", "laser"], b: ["shield"] });
    const from = { x: at(s, "b").x, y: at(s, "b").y };
    advance(s, W, TPS * 3, [cmd(2, "b", "use", { i: 0 }), cmd(5, "a", "use", { i: 0 }), cmd(8, "a", "fire", { i: 0, x: from.x, y: from.y })]);
    expect(evs(s, "shield", "b")).toHaveLength(1);
    expect(evs(s, "fizzle", "b")).toHaveLength(1);
    expect(moved(s, "b", from)).toBe(0);
  });

  test("an Air Horn rattles everyone close: their next putt overshoots", () => {
    const putt = (horn: boolean) => {
      const s = crowd(["a", "b", "c"], { a: horn ? ["horn"] : [] }, [40, 46, 40 + REACH + 8]);
      advance(s, W, TPS * 6, [cmd(2, "a", "use", { i: 0 }), cmd(10, "b", "shot", { a: 0, p: 0.3 })]);
      return { s, x: at(s, "b").x };
    };
    const quiet = putt(false), loud = putt(true);
    expect(loud.x - 46).toBeGreaterThan((quiet.x - 46) * 1.3);
    expect(at(loud.s, "b").rattled).toBe(false); // used up by the putt
    expect(at(loud.s, "c").rattled).toBe(false); // too far away to hear it
  });

  test("a Flash Camera blinds everyone close for a moment", () => {
    const s = crowd(["a", "b", "c"], { a: ["flash"] }, [40, 46, 40 + REACH + 8]);
    advance(s, W, 10, [cmd(2, "a", "use", { i: 0 })]);
    expect(at(s, "b").blindUntil).toBeGreaterThan(at(s, "b").t + 3);
    expect(at(s, "c").blindUntil).toBe(0);
  });

  test("a Dueling Pistol knocks the first ball on its line and stuns it", () => {
    const s = crowd(["a", "b", "c"], { a: ["pistol"] }, [40, 46, 52]);
    const b0 = { x: 46, y: 61 }, c0 = { x: 52, y: 61 };
    advance(s, W, 30, [cmd(2, "a", "fire", { i: 0, x: 60, y: 61 }), cmd(20, "b", "shot", { a: 3, p: 0.5 })]);
    expect(evs(s, "tracer", "a")).toHaveLength(1);
    expect(moved(s, "b", b0)).toBeGreaterThan(0);
    expect(at(s, "b").stunUntil).toBeGreaterThan(at(s, "b").t);
    // Stunned: the putt it tried didn't happen.
    expect(at(s, "b").strokes).toBe(0);
    // b took the bullet; c behind it didn't.
    expect(moved(s, "c", c0)).toBeLessThan(1);
  });

  test("the Elephant Gun hits harder and kicks the shooter backwards", () => {
    const s = crowd(["a", "b"], { a: ["elephant"] }, [44, 50]);
    advance(s, W, 40, [cmd(2, "a", "fire", { i: 0, x: 60, y: 61 })]);
    expect(at(s, "a").x).toBeLessThan(44);
    expect(at(s, "b").x).toBeGreaterThan(51);
  });

  test("a Freeze Bomb freezes balls where it lands and turns water to ice for a while", () => {
    const s = crowd(["a", "b"], { a: ["freeze"] });
    const b = at(s, "b");
    advance(s, W, 10, [cmd(2, "a", "fire", { i: 0, x: b.x, y: b.y }), cmd(6, "b", "shot", { a: 0, p: 0.5 })]);
    expect(b.frozenUntil).toBeGreaterThan(b.t);
    expect(b.mode).toBe("aim");
    expect(b.strokes).toBe(0);
    // Over the lagoon: ice, then water again.
    const t2 = newWorld(SANDBOX);
    applyCmd(t2, SANDBOX, { tick: 0, by: "a", seq: 0, kind: "join" });
    const a2 = at(t2, "a");
    a2.bag = ["freeze"];
    advance(t2, W, 3, [cmd(1, "a", "fire", { i: 0, x: 42, y: 45 })]);
    const probe = { ...a2, x: 42, y: 45 };
    expect(groundUnder(W, probe, { x: 42, y: 45 })).toBe("ice");
    advance(t2, W, 3 + TPS * (ICE_S + 1), []);
    expect(groundUnder(W, { ...a2, t: a2.t + ICE_S + 2 }, { x: 42, y: 45 })).toBe("water");
    expect(t2.patches).toEqual([]);
  });

  test("a Thunderstorm drops bolts under its cloud, then clears", () => {
    const s = crowd(["a", "b"], { a: ["storm"] });
    advance(s, W, TPS * (STORM.life + 1), [cmd(2, "a", "fire", { i: 0, x: 46, y: 61 })]);
    expect(evs(s, "bolt").length).toBeGreaterThanOrEqual(7);
    for (const e of evs(s, "bolt")) expect(hyp(e.ev.x - 46, e.ev.y - 61)).toBeLessThanOrEqual(STORM.r);
    expect(s.storms).toEqual([]);
  });

  test("Honey slows anything rolling through it", () => {
    const roll = (honey: boolean) => {
      const s = crowd(["a", "b"], { a: honey ? ["honey"] : [] }, [36, 60]);
      advance(s, W, TPS * 6, [cmd(2, "a", "fire", { i: 0, x: 48, y: 61 }), cmd(5, "b", "shot", { a: Math.PI, p: 0.5 })]);
      return at(s, "b").x;
    };
    // b rolls west into it and stops well short of where it would have.
    expect(roll(true)).toBeGreaterThan(roll(false) + 2);
  });

  test("Coffee lets you putt again while still rolling", () => {
    const s = crowd(["a"], { a: ["coffee"] });
    advance(s, W, TPS, [cmd(2, "a", "use", { i: 0 }), cmd(5, "a", "shot", { a: 0, p: 0.4 }), cmd(60, "a", "shot", { a: -1.2, p: 0.4 })]);
    expect(at(s, "a").strokes).toBe(2);
  });
});

describe("the board fights back", () => {
  test("the spinning bar shoves a ball parked in its way", () => {
    const s = crowd(["a"]);
    const spin = SANDBOX.movers.find((m) => m.kind === "spinner")!;
    if (spin.kind !== "spinner") throw new Error();
    Object.assign(at(s, "a"), { x: spin.at.x + 2, y: spin.at.y, rest: { x: spin.at.x + 2, y: spin.at.y } });
    advance(s, W, TPS * 4, []);
    expect(moved(s, "a", { x: spin.at.x + 2, y: spin.at.y })).toBeGreaterThan(0.5);
  });

  test("a ball on the ice rink slides much further than on grass", () => {
    const slide = (y: number, x = 20.5) => {
      const s = crowd(["a"], {}, [x]);
      Object.assign(at(s, "a"), { y, rest: { x, y } });
      advance(s, W, TPS * 3, [cmd(1, "a", "shot", { a: 0, p: 0.18 })]);
      return at(s, "a").x - x;
    };
    expect(slide(35.5)).toBeGreaterThan(slide(61, 40) * 1.5);
  });

  test("snapshots from before these items still load", () => {
    const s = crowd(["a", "b"]);
    const old = pack(s) as Partial<Packed>;
    delete old.patches;
    delete old.missiles;
    delete old.storms;
    for (const b of old.balls! as Record<string, unknown>[]) for (const k of ["shieldUntil", "frozenUntil", "stunUntil", "blindUntil", "coffeeUntil", "rattled"]) delete b[k];
    const back = unpack(JSON.parse(JSON.stringify(old)));
    advance(back, W, TPS * 3, [cmd(1, "a", "shot", { a: 0, p: 0.3 })]);
    expect(at(back, "a").x).toBeGreaterThan(41);
  });
});

// Ticks are whole engine steps.
test("a tick is one engine step", () => expect(TPS * DT).toBe(1));

const PINNED = 3583485931;
