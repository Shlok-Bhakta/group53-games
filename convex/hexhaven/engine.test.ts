import { describe, expect, test } from "vitest";
import { ANY_PORT, COSTS, DESERT, LAYOUTS, geometryOf, noHand } from "./board";
import {
  DEFAULT_RULES,
  act,
  actor,
  bankOf,
  cantAccept,
  newGame,
  publicPoints,
  rateFor,
  roadLength,
  standings,
  totalPoints,
  victimsAt,
  villageSpots,
  type Action,
  type Game,
  type Rules,
} from "./engine";

const fixed = (...xs: number[]) => {
  const q = [...xs];
  return () => (q.length ? q.shift()! : 0.5);
};
const dice = (a: number, b: number) => fixed((a - 1) / 6 + 0.01, (b - 1) / 6 + 0.01);
const game = (n = 3, rules: Partial<Rules> = {}) => newGame(n, { ...DEFAULT_RULES, ...rules }, fixed());
const play = (g: Game, seat: number, a: Action, rng = fixed()) => act(g, seat, a, rng);

function coastPath(g: Game, len: number) {
  const geo = geometryOf(g.s.layout);
  const edges = geo.coast.slice(0, len);
  const first = geo.edges[edges[0]];
  const second = geo.edges[edges[1]];
  const verts = [first.a === second.a || first.a === second.b ? first.b : first.a];
  for (const e of edges) verts.push(geo.edges[e].a === verts.at(-1) ? geo.edges[e].b : geo.edges[e].a);
  return { verts, edges };
}

function setupDone(n = 3, rules: Partial<Rules> = {}) {
  let g = game(n, rules);
  for (let k = 0; k < 2 * n; k++) {
    const seat = actor(g.s);
    const v = villageSpots(g.s, seat, true)[0];
    g = play(g, seat, { k: "village", at: v });
    const geo = geometryOf(g.s.layout);
    g = play(g, seat, { k: "road", at: geo.verts[v].edges[0] });
  }
  return g;
}

const mainPhase = (g: Game, seat = g.s.current) => {
  g.s.current = seat;
  g.s.phase = { k: "main" };
  return g;
};

describe("the island", () => {
  test("the standard island has 19 hexes, 54 corners, 72 edges and 9 harbors on 30 coast edges", () => {
    const geo = geometryOf("standard");
    expect([geo.hexes.length, geo.verts.length, geo.edges.length, geo.coast.length]).toEqual([19, 54, 72, 30]);
    expect(new Set(geo.portSlots).size).toBe(9);
    for (const e of geo.portSlots) expect(geo.edges[e].hexes).toHaveLength(1);
    for (const v of geo.verts) expect(v.hexes.length).toBeGreaterThanOrEqual(1);
  });

  test("the big island for 5 and 6 has 30 hexes and 11 harbors", () => {
    const geo = geometryOf("big");
    expect(geo.hexes).toHaveLength(30);
    expect(new Set(geo.portSlots).size).toBe(11);
    const g = game(5);
    expect(g.s.layout).toBe("big");
    expect(g.s.hexes.filter((h) => h.r === DESERT)).toHaveLength(2);
    expect(g.deck).toHaveLength(34);
  });

  test("terrain, numbers, harbors and the deck match the layout, and the bandit starts on the desert", () => {
    const g = newGame(4, DEFAULT_RULES, Math.random);
    const def = LAYOUTS.standard;
    for (let r = 0; r < 5; r++) expect(g.s.hexes.filter((h) => h.r === r)).toHaveLength(def.terrain[r]);
    expect(
      g.s.hexes
        .map((h) => h.n)
        .filter((n) => n)
        .sort((a, b) => a - b),
    ).toEqual([...def.numbers]);
    expect(g.s.hexes[g.s.bandit].r).toBe(DESERT);
    expect(g.s.ports.filter((p) => p.r === ANY_PORT)).toHaveLength(4);
    expect(g.deck).toHaveLength(25);
    expect(g.s.deckLeft).toBe(25);
  });

  test("balanced numbers never put 6s and 8s side by side, on either island", () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const n of [4, 6])
      for (let k = 0; k < 300; k++) {
        const g = newGame(n, DEFAULT_RULES, rng);
        const geo = geometryOf(g.s.layout);
        const hot = (i: number) => g.s.hexes[i].n === 6 || g.s.hexes[i].n === 8;
        for (const [i] of g.s.hexes.entries()) if (hot(i)) expect(geo.hexNear[i].some(hot)).toBe(false);
      }
  });
});

describe("setup", () => {
  test("goes round and back, second villages pay out, then the first player rolls", () => {
    let g = game(3);
    const order: number[] = [];
    for (let k = 0; k < 6; k++) {
      const seat = actor(g.s);
      order.push(seat);
      const v = villageSpots(g.s, seat, true)[0];
      g = play(g, seat, { k: "village", at: v });
      expect(() => play(g, seat, { k: "village", at: villageSpots(g.s, seat, true)[0] })).toThrow("road");
      g = play(g, seat, { k: "road", at: geometryOf("standard").verts[v].edges[0] });
    }
    expect(order).toEqual([0, 1, 2, 2, 1, 0]);
    expect(g.s.phase).toEqual({ k: "roll" });
    expect(g.s.current).toBe(0);
    expect(g.s.turn).toBe(1);
    const starts = g.s.log.filter((e) => e.t === "start");
    expect(starts).toHaveLength(3);
    for (const e of starts) if (e.t === "start") expect(g.s.players[e.seat].res).toEqual(e.got);
  });

  test("a village can't sit next to another, and only the player up can place", () => {
    let g = game(2);
    const geo = geometryOf("standard");
    g = play(g, 0, { k: "village", at: 0 });
    expect(() => play(g, 1, { k: "road", at: geo.verts[0].edges[0] })).toThrow("not your turn");
    g = play(g, 0, { k: "road", at: geo.verts[0].edges[0] });
    expect(() => play(g, 1, { k: "village", at: geo.verts[0].near[0] })).toThrow("Too close");
  });

  test("the setup road has to touch the village just placed", () => {
    const g = play(game(2), 0, { k: "village", at: 0 });
    const far = geometryOf("standard").edges.findIndex((e) => e.a !== 0 && e.b !== 0);
    expect(() => play(g, 0, { k: "road", at: far })).toThrow("next to the village");
  });
});

describe("rolling", () => {
  test("a number pays villages one and towns two, but not under the bandit", () => {
    const g = setupDone(2);
    const geo = geometryOf(g.s.layout);
    const hex = g.s.hexes.findIndex((h, i) => h.n === 8 && i !== g.s.bandit);
    const [v1, , v3] = geo.hexVerts[hex];
    g.s.spots = g.s.spots.map(() => null);
    g.s.spots[v1] = { seat: 0, town: false };
    g.s.spots[v3] = { seat: 1, town: true };
    g.s.players.forEach((p) => (p.res = noHand()));
    const r = g.s.hexes[hex].r;
    const after = play(g, 0, { k: "roll" }, dice(4, 4));
    expect(after.s.players[0].res[r]).toBe(1);
    expect(after.s.players[1].res[r]).toBe(2);
    expect(after.s.phase).toEqual({ k: "main" });
    g.s.bandit = hex;
    const blocked = play(g, 0, { k: "roll" }, dice(4, 4));
    expect(blocked.s.players.map((p) => p.res[r])).toEqual([0, 0]);
  });

  test("when the bank can't pay everyone a resource, nobody gets it; a single taker gets what's left", () => {
    const g = setupDone(2);
    const geo = geometryOf(g.s.layout);
    const hex = g.s.hexes.findIndex((h, i) => h.n === 6 && i !== g.s.bandit);
    const r = g.s.hexes[hex].r;
    const [v1, , v3] = geo.hexVerts[hex];
    g.s.spots = g.s.spots.map(() => null);
    g.s.spots[v1] = { seat: 0, town: true };
    g.s.spots[v3] = { seat: 1, town: true };
    g.s.players.forEach((p) => (p.res = noHand()));
    g.s.players[0].res[r] = 16;
    const short = play(g, 0, { k: "roll" }, dice(3, 3));
    expect(short.s.players[0].res[r]).toBe(16);
    expect(short.s.players[1].res[r]).toBe(0);
    expect(short.events.some((e) => e.t === "short")).toBe(true);
    g.s.spots[v3] = null;
    g.s.players[0].res[r] = 18;
    const one = play(g, 0, { k: "roll" }, dice(3, 3));
    expect(one.s.players[0].res[r]).toBe(19);
  });

  test("a 7 makes big hands give back half, then the roller moves the bandit and steals", () => {
    let g = setupDone(3);
    g.s.players[1].res = [4, 4, 0, 0, 0];
    g.s.players[2].res = [1, 1, 1, 0, 0];
    g.s.players[0].res = [0, 0, 0, 0, 0];
    g = play(g, 0, { k: "roll" }, dice(3, 4));
    expect(g.s.phase).toEqual({ k: "discard", owe: [0, 4, 0] });
    expect(actor(g.s)).toBe(1);
    expect(() => play(g, 0, { k: "bandit", hex: 0, from: -1 })).toThrow();
    expect(() => play(g, 1, { k: "discard", res: [1, 0, 0, 0, 0] })).toThrow("Pick 4");
    g = play(g, 1, { k: "discard", res: [2, 2, 0, 0, 0] });
    expect(g.s.phase).toEqual({ k: "bandit", then: "main" });
    const geo = geometryOf(g.s.layout);
    const hex = geo.hexes.findIndex((_, h) => h !== g.s.bandit && victimsAt(g.s, 0, h).includes(1));
    if (hex >= 0) {
      const before = g.s.players[1].res.reduce((a, b) => a + b);
      g = play(g, 0, { k: "bandit", hex, from: 1 });
      expect(g.s.players[1].res.reduce((a, b) => a + b)).toBe(before - 1);
      expect(g.s.players[0].res.reduce((a, b) => a + b)).toBe(1);
      expect(g.s.bandit).toBe(hex);
      expect(g.s.phase).toEqual({ k: "main" });
    }
  });

  test("the bandit can't stay put, and has to steal from someone there when it can", () => {
    const g = setupDone(2);
    g.s.phase = { k: "bandit", then: "main" };
    expect(() => play(g, 0, { k: "bandit", hex: g.s.bandit, from: -1 })).toThrow("somewhere else");
    const geo = geometryOf(g.s.layout);
    g.s.players[1].res = [1, 0, 0, 0, 0];
    const hex = geo.hexes.findIndex((_, h) => h !== g.s.bandit && victimsAt(g.s, 0, h).length > 0);
    expect(() => play(g, 0, { k: "bandit", hex, from: -1 })).toThrow("Pick someone");
  });

  test("the friendly bandit leaves players on 2 points alone", () => {
    const g = setupDone(2, { friendly: true });
    g.s.phase = { k: "bandit", then: "main" };
    g.s.players[1].res = [1, 0, 0, 0, 0];
    const geo = geometryOf(g.s.layout);
    for (let h = 0; h < geo.hexes.length; h++) expect(victimsAt(g.s, 0, h)).toEqual([]);
  });
});

describe("building", () => {
  test("costs come out of the hand, and roads must join your network", () => {
    const g = mainPhase(setupDone(2), 0);
    g.s.players[0].res = [1, 1, 0, 0, 0];
    const geo = geometryOf(g.s.layout);
    const mine = g.s.roads.indexOf(0);
    const v = [geo.edges[mine].a, geo.edges[mine].b].find((x) => !g.s.spots[x])!;
    const next = geo.verts[v].edges.find((e) => g.s.roads[e] < 0)!;
    const far = g.s.roads.findIndex(
      (x, e) =>
        x < 0 &&
        ![geo.edges[e].a, geo.edges[e].b].some((w) => geo.verts[w].edges.some((f) => g.s.roads[f] === 0) || g.s.spots[w]?.seat === 0),
    );
    expect(() => play(g, 0, { k: "road", at: far })).toThrow("join");
    const after = play(g, 0, { k: "road", at: next });
    expect(after.s.roads[next]).toBe(0);
    expect(after.s.players[0].res).toEqual(noHand());
    expect(() => play(after, 0, { k: "road", at: far })).toThrow("what it costs");
  });

  test("towns replace your own villages and are worth two", () => {
    const g = mainPhase(setupDone(2), 0);
    g.s.players[0].res = [...COSTS.town];
    const v = g.s.spots.findIndex((x) => x?.seat === 0);
    const before = publicPoints(g.s, 0);
    const other = g.s.spots.findIndex((x) => x?.seat === 1);
    expect(() => play(g, 0, { k: "town", at: other })).toThrow("your villages");
    const after = play(g, 0, { k: "town", at: v });
    expect(after.s.spots[v]).toEqual({ seat: 0, town: true });
    expect(publicPoints(after.s, 0)).toBe(before + 1);
  });

  test("nothing gets built off your turn or before you roll", () => {
    const g = setupDone(2);
    g.s.players[1].res = [5, 5, 5, 5, 5];
    expect(() => play(g, 1, { k: "buy" })).toThrow("not your turn");
    g.s.players[0].res = [5, 5, 5, 5, 5];
    expect(() => play(g, 0, { k: "buy" })).toThrow("after you roll");
  });
});

describe("longest road", () => {
  test("five in a row takes it, a longer one steals it, and a village in the middle cuts it", () => {
    const g = game(2);
    g.s.phase = { k: "main" };
    g.s.turn = 1;
    const a = coastPath(g, 6);
    a.edges.slice(0, 4).forEach((e) => (g.s.roads[e] = 0));
    g.s.spots[a.verts[0]] = { seat: 0, town: false };
    g.s.players[0].res = [5, 5, 0, 0, 0];
    let after = play(g, 0, { k: "road", at: a.edges[4] });
    expect(roadLength(after.s, 0)).toBe(5);
    expect(after.s.longest).toBe(0);
    expect(publicPoints(after.s, 0)).toBe(3);
    after.s.spots[a.verts[2]] = { seat: 1, town: false };
    after.s.players[0].res = [5, 5, 0, 0, 0];
    after = play(after, 0, { k: "road", at: a.edges[5] });
    expect(roadLength(after.s, 0)).toBe(4);
    expect(after.s.longest).toBe(-1);
  });
});

describe("cards", () => {
  test("bought cards wait a turn, then a knight moves the bandit and three make the biggest army", () => {
    let g = mainPhase(setupDone(2), 0);
    g.deck = ["knight", "knight", "knight", ...g.deck.slice(3)];
    g.s.players[0].res = [0, 0, 3, 3, 3];
    for (let k = 0; k < 3; k++) g = play(g, 0, { k: "buy" });
    expect(g.s.players[0].devs).toBe(3);
    expect(g.held[0].map((h) => h.c)).toEqual(["knight", "knight", "knight"]);
    expect(() => play(g, 0, { k: "knight" })).toThrow("next");
    for (let k = 0; k < 3; k++) {
      g.s.turn++;
      g.s.current = 0;
      g.s.played = false;
      g.s.phase = { k: "roll" };
      g = play(g, 0, { k: "knight" });
      expect(g.s.phase).toEqual({ k: "bandit", then: "roll" });
      expect(() => play(g, 0, { k: "roll" })).toThrow();
      const hex = geometryOf(g.s.layout).hexes.findIndex((_, h) => h !== g.s.bandit && victimsAt(g.s, 0, h).length === 0);
      g = play(g, 0, { k: "bandit", hex, from: -1 });
      expect(g.s.phase).toEqual({ k: "roll" });
    }
    expect(g.s.players[0].knights).toBe(3);
    expect(g.s.army).toBe(0);
  });

  test("one card a turn; windfall takes two from the bank and cornering takes everyone's", () => {
    let g = mainPhase(setupDone(3), 0);
    g.held[0] = [
      { c: "plenty", t: 0 },
      { c: "corner", t: 0 },
    ];
    g.s.players[0].devs = 2;
    g.s.players.forEach((p) => (p.res = noHand()));
    g.s.players[1].res = [0, 0, 0, 0, 3];
    g.s.players[2].res = [0, 0, 0, 1, 2];
    g = play(g, 0, { k: "plenty", a: 1, b: 1 });
    expect(g.s.players[0].res).toEqual([0, 2, 0, 0, 0]);
    expect(() => play(g, 0, { k: "corner", r: 4 })).toThrow("One card a turn");
    g.s.played = false;
    g = play(g, 0, { k: "corner", r: 4 });
    expect(g.s.players.map((p) => p.res[4])).toEqual([5, 0, 0]);
    expect(g.s.players[0].devs).toBe(0);
  });

  test("two roads are free, and point cards win on your turn", () => {
    let g = mainPhase(setupDone(2), 0);
    g.held[0] = [{ c: "roads", t: 0 }];
    g.s.players[0].res = noHand();
    g = play(g, 0, { k: "roads" });
    expect(g.s.phase).toEqual({ k: "roads", left: 2, then: "main" });
    for (let k = 0; k < 2; k++) {
      const geo = geometryOf(g.s.layout);
      const at = g.s.roads.findIndex(
        (x, e) =>
          x < 0 &&
          [geo.edges[e].a, geo.edges[e].b].some((v) => g.s.spots[v]?.seat === 0 || geo.verts[v].edges.some((f) => g.s.roads[f] === 0)),
      );
      g = play(g, 0, { k: "road", at });
    }
    expect(g.s.roads.filter((x) => x === 0)).toHaveLength(4);
    expect(g.s.phase).toEqual({ k: "main" });

    const w = mainPhase(setupDone(2, { points: 4 }), 0);
    w.deck = ["point", "point", ...w.deck];
    w.s.players[0].res = [0, 0, 2, 2, 2];
    let won = play(w, 0, { k: "buy" });
    expect(won.s.phase.k).toBe("main");
    won = play(won, 0, { k: "buy" });
    expect(won.s.phase).toEqual({ k: "over", winner: 0 });
    expect(won.s.players[0].points).toBe(4);
    expect(standings(won)).toEqual([[0], [1]]);
  });
});

describe("trading", () => {
  test("harbors lower the bank's rate", () => {
    const g = mainPhase(setupDone(2), 0);
    const geo = geometryOf(g.s.layout);
    expect(rateFor(g.s, 0, 0)).toBeGreaterThanOrEqual(2);
    g.s.spots = g.s.spots.map(() => null);
    const port = g.s.ports.find((p) => p.r === 2)!;
    g.s.spots[geo.edges[port.e].a] = { seat: 0, town: false };
    expect(rateFor(g.s, 0, 2)).toBe(2);
    expect(rateFor(g.s, 0, 3)).toBe(4);
    g.s.players[0].res = [0, 0, 2, 0, 0];
    const after = play(g, 0, { k: "bank", give: 2, get: 4 });
    expect(after.s.players[0].res).toEqual([0, 0, 0, 0, 1]);
    expect(bankOf(after.s)[4]).toBe(LAYOUTS.standard.supply - 1 - g.s.players[1].res[4]);
  });

  test("offers go to or from whoever's turn it is, and accepting swaps the cards", () => {
    let g = mainPhase(setupDone(3), 0);
    g.s.players[0].res = [2, 0, 0, 0, 0];
    g.s.players[1].res = [0, 0, 1, 0, 0];
    g.s.players[2].res = [0, 0, 1, 0, 0];
    expect(() => play(g, 1, { k: "offer", to: 2, give: [0, 0, 1, 0, 0], get: [1, 0, 0, 0, 0] })).toThrow("whoever's turn");
    g = play(g, 0, { k: "offer", to: -1, give: [1, 0, 0, 0, 0], get: [0, 0, 1, 0, 0] });
    const id = g.s.offers[0].id;
    g = play(g, 1, { k: "reject", id });
    expect(g.s.offers).toHaveLength(1);
    g = play(g, 2, { k: "accept", id });
    expect(g.s.players[0].res).toEqual([1, 0, 1, 0, 0]);
    expect(g.s.players[2].res).toEqual([1, 0, 0, 0, 0]);
    expect(g.s.offers).toHaveLength(0);
    g = play(g, 1, { k: "offer", to: 0, give: [0, 0, 1, 0, 0], get: [1, 0, 0, 0, 0] });
    g.s.players[1].res = noHand();
    expect(cantAccept(g.s, 0, g.s.offers[0])).toBe("They don't have all that any more.");
    g = play(g, 0, { k: "end" });
    expect(g.s.offers).toHaveLength(0);
    expect(g.s.current).toBe(1);
  });
});

describe("leaving", () => {
  test("a resigned player's knights don't block the biggest army", () => {
    let g = mainPhase(setupDone(3), 1);
    g.s.players[0].knights = 5;
    g.s.army = 0;
    g.s.players[1].knights = 3;
    g.s.players[2].knights = 3;
    g = play(g, 0, { k: "resign" });
    expect(g.s.army).toBe(-1);
    g.s.players[1].knights = 3;
    g.held[1] = [{ c: "knight", t: 0 }];
    g.s.current = 1;
    g.s.phase = { k: "main" };
    g = play(g, 1, { k: "knight" });
    expect(g.s.army).toBe(1);
  });

  test("resigning skips your turns; the last one left wins", () => {
    let g = mainPhase(setupDone(3), 0);
    g = play(g, 0, { k: "resign" });
    expect(g.s.players[0].out).toBe(true);
    expect(g.s.current).toBe(1);
    expect(g.s.phase).toEqual({ k: "roll" });
    g = play(g, 2, { k: "resign" });
    expect(g.s.phase).toEqual({ k: "over", winner: 1 });
    expect(standings(g)[0]).toEqual([1]);
    expect(standings(g).flat().slice(-2).sort()).toEqual([0, 2]);
  });

  test("a resign during discards clears their share", () => {
    let g = setupDone(3);
    g.s.players[1].res = [8, 0, 0, 0, 0];
    g = play(g, 0, { k: "roll" }, dice(3, 4));
    expect(g.s.phase.k).toBe("discard");
    g = play(g, 1, { k: "resign" });
    expect(g.s.phase).toEqual({ k: "bandit", then: "main" });
  });
});

test("total points count hidden point cards; public ones don't", () => {
  const g = setupDone(2);
  g.held[0] = [{ c: "point", t: 0 }];
  expect(totalPoints(g, 0)).toBe(publicPoints(g.s, 0) + 1);
});
