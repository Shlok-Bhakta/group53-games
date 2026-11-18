import {
  ANY_PORT,
  COSTS,
  DESERT,
  LAYOUTS,
  PIECES,
  RESOURCE_NAMES,
  geometryOf,
  noHand,
  type Hand,
  type LayoutKey,
  type Piece,
} from "./board";

export type Rng = () => number;
export type Dev = "knight" | "roads" | "plenty" | "corner" | "point";
export type Held = { c: Dev; t: number };
export type Spot = { seat: number; town: boolean } | null;
export type Offer = { id: number; from: number; to: number; give: Hand; get: Hand; no: number[] };

export type Rules = { points: number; limit: number; friendly: boolean; balanced: boolean };
export const DEFAULT_RULES: Rules = { points: 10, limit: 7, friendly: false, balanced: true };

export type Phase =
  | { k: "setup"; i: number; at: number }
  | { k: "roll" }
  | { k: "discard"; owe: number[] }
  | { k: "bandit"; then: "roll" | "main" }
  | { k: "main" }
  | { k: "roads"; left: number; then: "roll" | "main" }
  | { k: "over"; winner: number };

export type Player = { res: Hand; knights: number; devs: number; out: boolean; points?: number };

export type HexState = {
  kind: "hexhaven";
  layout: LayoutKey;
  rules: Rules;
  hexes: { r: number; n: number }[];
  ports: { e: number; r: number }[];
  bandit: number;
  spots: Spot[];
  roads: number[];
  players: Player[];
  current: number;
  turn: number;
  phase: Phase;
  dice: number[] | null;
  played: boolean;
  longest: number;
  army: number;
  lengths: number[];
  offers: Offer[];
  nextOffer: number;
  deckLeft: number;
  seq: number;
  log: Ev[];
};

export type EvBody =
  | { t: "build"; seat: number; kind: "road" | "village" | "town"; at: number }
  | { t: "start"; seat: number; got: Hand }
  | { t: "roll"; seat: number; dice: number[] }
  | { t: "gain"; got: Hand[] }
  | { t: "short"; r: number }
  | { t: "discard"; seat: number; res: Hand }
  | { t: "bandit"; seat: number; hex: number }
  | { t: "steal"; seat: number; from: number; r: number }
  | { t: "buy"; seat: number }
  | { t: "play"; seat: number; card: Exclude<Dev, "point">; got?: Hand; r?: number; took?: number }
  | { t: "bank"; seat: number; give: number; n: number; get: number }
  | { t: "offer"; offer: Offer }
  | { t: "traded"; offer: Offer; by: number }
  | { t: "untrade"; offer: Offer; by: number; why: "reject" | "withdraw" }
  | { t: "award"; kind: "road" | "army"; seat: number; from: number }
  | { t: "turn"; seat: number }
  | { t: "out"; seat: number }
  | { t: "win"; seat: number; points: number };
export type Ev = EvBody & { n: number };

export type Game = { s: HexState; deck: Dev[]; held: Held[][]; events: Ev[] };

export type Action =
  | { k: "village" | "road" | "town"; at: number }
  | { k: "roll" | "buy" | "end" | "doneRoads" | "resign" }
  | { k: "knight" }
  | { k: "roads" }
  | { k: "discard"; res: Hand }
  | { k: "bandit"; hex: number; from: number }
  | { k: "plenty"; a: number; b: number }
  | { k: "corner"; r: number }
  | { k: "bank"; give: number; get: number }
  | { k: "offer"; to: number; give: Hand; get: Hand }
  | { k: "accept" | "reject" | "withdraw"; id: number };

const LOG_KEPT = 80;
export const LONGEST_MIN = 5;
export const ARMY_MIN = 3;
export const AWARD_POINTS = 2;
const MAX_OFFERS = 12;
const PLACE_TRIES = 400;

const sum = (h: readonly number[]) => h.reduce((a, b) => a + b, 0);
const covers = (have: readonly number[], need: readonly number[]) => need.every((n, i) => have[i] >= n);
const isHand = (h: unknown): h is Hand => Array.isArray(h) && h.length === 5 && h.every((n) => Number.isInteger(n) && n >= 0 && n <= 99);

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const geo = (s: Pick<HexState, "layout">) => geometryOf(s.layout);
export const layoutFor = (players: number): LayoutKey => (players > 4 ? "big" : "standard");
export const supplyOf = (s: Pick<HexState, "layout">) => LAYOUTS[s.layout].supply;

const isHot = (n: number) => n === 6 || n === 8;

function placeNumbers(layout: LayoutKey, terrain: number[], balanced: boolean, rng: Rng) {
  const g = geometryOf(layout);
  const land = terrain.flatMap((t, i) => (t === DESERT ? [] : [i]));
  const bag = shuffled(LAYOUTS[layout].numbers, rng);
  const numbers: number[] = Array(terrain.length).fill(0);
  if (!balanced) {
    bag.forEach((n, k) => (numbers[land[k]] = n));
    return numbers;
  }
  const hot = bag.filter(isHot);
  let spots: number[] = [];
  for (let tries = 0; tries <= PLACE_TRIES && spots.length < hot.length; tries++) {
    spots = [];
    for (const h of tries < PLACE_TRIES ? shuffled(land, rng) : land)
      if (spots.length < hot.length && !g.hexNear[h].some((j) => spots.includes(j))) spots.push(h);
  }
  hot.forEach((n, k) => (numbers[spots[k]] = n));
  const rest = land.filter((h) => !spots.includes(h));
  bag.filter((n) => !isHot(n)).forEach((n, k) => (numbers[rest[k]] = n));
  return numbers;
}

export function newGame(n: number, rules: Rules, rng: Rng): Game {
  const layout = layoutFor(n);
  const def = LAYOUTS[layout];
  const g = geometryOf(layout);
  const terrainBag = def.terrain.flatMap((count, r) => Array<number>(count).fill(r));
  while (terrainBag.length < g.hexes.length) terrainBag.push(DESERT);
  const terrain = shuffled(terrainBag, rng);
  const numbers = placeNumbers(layout, terrain, rules.balanced, rng);
  const hexes = terrain.map((r, i) => ({ r, n: numbers[i] }));
  const ports = shuffled(def.ports, rng).map((r, i) => ({ e: g.portSlots[i], r }));
  const deck = shuffled(
    (Object.entries(def.deck) as [Dev, number][]).flatMap(([c, count]) => Array<Dev>(count).fill(c)),
    rng,
  );
  const s: HexState = {
    kind: "hexhaven",
    layout,
    rules,
    hexes,
    ports,
    bandit: Math.max(0, terrain.indexOf(DESERT)),
    spots: g.verts.map(() => null),
    roads: g.edges.map(() => -1),
    players: Array.from({ length: n }, () => ({ res: noHand(), knights: 0, devs: 0, out: false })),
    current: 0,
    turn: 0,
    phase: { k: "setup", i: 0, at: -1 },
    dice: null,
    played: false,
    longest: -1,
    army: -1,
    lengths: Array(n).fill(0),
    offers: [],
    nextOffer: 1,
    deckLeft: deck.length,
    seq: 0,
    log: [],
  };
  return { s, deck, held: Array.from({ length: n }, () => []), events: [] };
}

export const setupSeat = (s: HexState, i: number) => {
  const n = s.players.length;
  return i < n ? i : 2 * n - 1 - i;
};

export function actor(s: HexState): number {
  const ph = s.phase;
  if (ph.k === "over") return -1;
  if (ph.k === "setup") return setupSeat(s, ph.i);
  if (ph.k === "discard") {
    const n = s.players.length;
    for (let k = 0; k < n; k++) {
      const seat = (s.current + k) % n;
      if (ph.owe[seat] > 0) return seat;
    }
  }
  return s.current;
}

export const waitingOn = (s: HexState): number[] =>
  s.phase.k === "discard" ? s.phase.owe.flatMap((o, i) => (o > 0 ? [i] : [])) : s.phase.k === "over" ? [] : [actor(s)];

export const alive = (s: HexState) => s.players.flatMap((p, i) => (p.out ? [] : [i]));

export function bankOf(s: HexState): Hand {
  const out = noHand().map(() => supplyOf(s));
  for (const p of s.players) p.res.forEach((n, r) => (out[r] -= n));
  return out;
}

export const villagesOf = (s: HexState, seat: number) => s.spots.filter((x) => x?.seat === seat && !x.town).length;
export const townsOf = (s: HexState, seat: number) => s.spots.filter((x) => x?.seat === seat && x.town).length;
export const roadsOf = (s: HexState, seat: number) => s.roads.filter((x) => x === seat).length;

export function publicPoints(s: HexState, seat: number) {
  return villagesOf(s, seat) + 2 * townsOf(s, seat) + (s.longest === seat ? AWARD_POINTS : 0) + (s.army === seat ? AWARD_POINTS : 0);
}

export const pointCards = (held: Held[]) => held.filter((h) => h.c === "point").length;
export const totalPoints = (g: Game, seat: number) => publicPoints(g.s, seat) + pointCards(g.held[seat] ?? []);

function touchesOwn(s: HexState, seat: number, v: number) {
  const g = geo(s);
  const spot = s.spots[v];
  if (spot?.seat === seat) return true;
  if (spot && spot.seat !== seat) return false;
  return g.verts[v].edges.some((e) => s.roads[e] === seat);
}

export function cantVillage(s: HexState, seat: number, v: number, setup: boolean): string | null {
  const g = geo(s);
  if (!g.verts[v]) return "That's not a spot on the island.";
  if (s.spots[v]) return "Someone's already built there.";
  if (g.verts[v].near.some((w) => s.spots[w])) return "Too close to another settlement.";
  if (!setup && !g.verts[v].edges.some((e) => s.roads[e] === seat)) return "Build next to one of your roads.";
  return null;
}

export function cantRoad(s: HexState, seat: number, e: number, from?: number): string | null {
  const g = geo(s);
  const edge = g.edges[e];
  if (!edge) return "That's not a spot on the island.";
  if (s.roads[e] >= 0) return "There's already a road there.";
  if (from !== undefined) return edge.a === from || edge.b === from ? null : "Build it next to the settlement you just placed.";
  return touchesOwn(s, seat, edge.a) || touchesOwn(s, seat, edge.b) ? null : "Roads have to join your roads or buildings.";
}

export const villageSpots = (s: HexState, seat: number, setup = false) =>
  geo(s).verts.flatMap((_, v) => (cantVillage(s, seat, v, setup) ? [] : [v]));
export const roadSpots = (s: HexState, seat: number, from?: number) =>
  geo(s).edges.flatMap((_, e) => (cantRoad(s, seat, e, from) ? [] : [e]));
export const townSpots = (s: HexState, seat: number) => s.spots.flatMap((x, v) => (x?.seat === seat && !x.town ? [v] : []));

export function cantBuild(s: HexState, seat: number, kind: Piece): string | null {
  if (s.phase.k !== "main" || s.current !== seat) return "Only on your turn, after you roll.";
  const p = s.players[seat];
  if (!covers(p.res, COSTS[kind])) return "You don't have what it costs.";
  if (kind === "road" && roadsOf(s, seat) >= PIECES.road) return "You've built all 15 roads.";
  if (kind === "road" && !roadSpots(s, seat).length) return "Nowhere to build a road.";
  if (kind === "village" && villagesOf(s, seat) >= PIECES.village) return "All 5 settlements are out. Upgrade one to a city.";
  if (kind === "village" && !villageSpots(s, seat).length) return "Nowhere to build a settlement. Build roads first.";
  if (kind === "town" && townsOf(s, seat) >= PIECES.town) return "You've built all 4 cities.";
  if (kind === "town" && !townSpots(s, seat).length) return "Cities replace your own settlements.";
  if (kind === "card" && s.deckLeft <= 0) return "The cards have run out.";
  return null;
}

export function rateFor(s: HexState, seat: number, r: number) {
  const g = geo(s);
  let rate = 4;
  for (const port of s.ports) {
    const edge = g.edges[port.e];
    const mine = [edge.a, edge.b].some((v) => s.spots[v]?.seat === seat);
    if (!mine) continue;
    if (port.r === r) rate = Math.min(rate, 2);
    if (port.r === ANY_PORT) rate = Math.min(rate, 3);
  }
  return rate;
}

function friendlyBlocked(s: HexState, seat: number, other: number) {
  return s.rules.friendly && other !== seat && publicPoints(s, other) <= 2;
}

export function victimsAt(s: HexState, seat: number, hex: number) {
  const out = new Set<number>();
  for (const v of geo(s).hexVerts[hex]) {
    const spot = s.spots[v];
    if (spot && spot.seat !== seat && !s.players[spot.seat].out && sum(s.players[spot.seat].res) > 0) out.add(spot.seat);
  }
  return [...out].filter((o) => !friendlyBlocked(s, seat, o)).sort((a, b) => a - b);
}

export function banditHexes(s: HexState, seat: number) {
  const g = geo(s);
  const all = g.hexes.map((_, i) => i).filter((i) => i !== s.bandit);
  if (!s.rules.friendly) return all;
  const ok = all.filter((i) => !g.hexVerts[i].some((v) => s.spots[v] && friendlyBlocked(s, seat, s.spots[v]!.seat)));
  return ok.length ? ok : all;
}

function edgeBlocked(s: HexState, seat: number, v: number) {
  const spot = s.spots[v];
  return !!spot && spot.seat !== seat;
}

export function roadLength(s: HexState, seat: number) {
  const g = geo(s);
  const mine = s.roads.flatMap((x, e) => (x === seat ? [e] : []));
  if (!mine.length) return 0;
  const used = new Set<number>();
  const walk = (v: number): number => {
    let best = 0;
    for (const e of g.verts[v].edges) {
      if (s.roads[e] !== seat || used.has(e)) continue;
      const edge = g.edges[e];
      const w = edge.a === v ? edge.b : edge.a;
      used.add(e);
      best = Math.max(best, 1 + (edgeBlocked(s, seat, w) ? 0 : walk(w)));
      used.delete(e);
    }
    return best;
  };
  let best = 0;
  const starts = new Set(mine.flatMap((e) => [g.edges[e].a, g.edges[e].b]));
  for (const v of starts) best = Math.max(best, walk(v));
  return best;
}

export function cantDev(g: Game, seat: number, card: Dev): string | null {
  const s = g.s;
  if (s.current !== seat || (s.phase.k !== "roll" && s.phase.k !== "main")) return "Only on your turn.";
  if (card === "point") return "Point cards count by themselves.";
  if (s.played) return "One card a turn.";
  const held = g.held[seat] ?? [];
  if (!held.some((h) => h.c === card)) return "You don't have that card.";
  if (!held.some((h) => h.c === card && h.t < s.turn)) return "Cards you bought this turn wait till your next.";
  return null;
}

export function cantOffer(s: HexState, seat: number, to: number, give: Hand, get: Hand): string | null {
  if (s.phase.k !== "main") return "Trades happen after the roll.";
  if (s.players[seat].out) return "You're out.";
  if (!isHand(give) || !isHand(get)) return "That's not a trade.";
  if (!sum(give) || !sum(get)) return "Both sides have to give something.";
  if (give.some((n, r) => n > 0 && get[r] > 0)) return "Don't trade a resource for itself.";
  if (!covers(s.players[seat].res, give)) return "You don't have all that.";
  if (to === seat) return "That's you.";
  if (to >= 0 && (!s.players[to] || s.players[to].out)) return "They're not playing.";
  if (seat !== s.current && to !== s.current) return "Trade with whoever's turn it is.";
  if (s.offers.length >= MAX_OFFERS) return "Too many offers are open.";
  return null;
}

export function cantAccept(s: HexState, seat: number, o: Offer): string | null {
  if (s.phase.k !== "main") return "Trades happen after the roll.";
  if (o.from === seat) return "That's your own offer.";
  if (o.to >= 0 && o.to !== seat) return "That offer isn't for you.";
  if (o.to < 0 && o.from !== s.current && seat !== s.current) return "Trade with whoever's turn it is.";
  if (s.players[seat].out) return "You're out.";
  if (!covers(s.players[o.from].res, o.give)) return "They don't have all that any more.";
  if (!covers(s.players[seat].res, o.get)) return "You don't have what they want.";
  return null;
}

export function playable(g: Game, seat: number) {
  return (["knight", "roads", "plenty", "corner"] as const).filter((c) => !cantDev(g, seat, c));
}

class Turn {
  constructor(
    public g: Game,
    private rng: Rng,
  ) {}
  get s() {
    return this.g.s;
  }
  emit(e: EvBody) {
    const ev = { ...e, n: this.s.seq++ } as Ev;
    this.g.events.push(ev);
    this.s.log.push(ev);
    if (this.s.log.length > LOG_KEPT) this.s.log.splice(0, this.s.log.length - LOG_KEPT);
  }
  pay(seat: number, cost: readonly number[]) {
    const res = this.s.players[seat].res;
    cost.forEach((n, r) => (res[r] -= n));
  }
  awards() {
    const s = this.s;
    s.lengths = s.players.map((p, i) => (p.out ? 0 : roadLength(s, i)));
    const holder = s.longest;
    const max = Math.max(0, ...s.lengths);
    let next = holder;
    if (holder < 0 || s.lengths[holder] < max || s.lengths[holder] < LONGEST_MIN || s.players[holder].out) {
      const tops = s.lengths.flatMap((l, i) => (l === max && max >= LONGEST_MIN ? [i] : []));
      next = tops.length === 1 ? tops[0] : -1;
    }
    if (next !== holder) {
      s.longest = next;
      this.emit({ t: "award", kind: "road", seat: next, from: holder });
    }
    const armyHolder = s.army;
    let army = armyHolder;
    if (armyHolder >= 0 && s.players[armyHolder].out) {
      const most = Math.max(0, ...s.players.map((p) => (p.out ? 0 : p.knights)));
      const tops = s.players.flatMap((p, i) => (!p.out && p.knights === most && most >= ARMY_MIN ? [i] : []));
      army = tops.length === 1 ? tops[0] : -1;
    }
    for (const [i, p] of s.players.entries()) {
      if (p.out || p.knights < ARMY_MIN) continue;
      if (army < 0 ? s.players.every((o, j) => j === i || o.out || o.knights < p.knights) : p.knights > s.players[army].knights) army = i;
    }
    if (army !== armyHolder) {
      s.army = army;
      this.emit({ t: "award", kind: "army", seat: army, from: armyHolder });
    }
  }
  checkWin() {
    const s = this.s;
    if (s.phase.k === "setup" || s.phase.k === "over") return;
    const seat = s.current;
    const points = totalPoints(this.g, seat);
    if (points < s.rules.points) return;
    this.finish(seat, points);
  }
  finish(seat: number, points: number) {
    const s = this.s;
    s.phase = { k: "over", winner: seat };
    s.offers = [];
    s.players.forEach((p, i) => (p.points = totalPoints(this.g, i)));
    this.emit({ t: "win", seat, points });
  }
  produce(total: number) {
    const s = this.s;
    const g = geo(s);
    const want = s.players.map(() => noHand());
    s.hexes.forEach((h, i) => {
      if (h.n !== total || i === s.bandit || h.r === DESERT) return;
      for (const v of g.hexVerts[i]) {
        const spot = s.spots[v];
        if (spot && !s.players[spot.seat].out) want[spot.seat][h.r] += spot.town ? 2 : 1;
      }
    });
    const bank = bankOf(s);
    const got = s.players.map(() => noHand());
    for (let r = 0; r < 5; r++) {
      const takers = want.flatMap((w, i) => (w[r] ? [i] : []));
      const need = sum(want.map((w) => w[r]));
      if (!need) continue;
      if (need <= bank[r]) for (const i of takers) got[i][r] = want[i][r];
      else if (takers.length === 1) got[takers[0]][r] = bank[r];
      if (need > bank[r]) this.emit({ t: "short", r });
    }
    got.forEach((h, i) => h.forEach((n, r) => (s.players[i].res[r] += n)));
    if (got.some((h) => sum(h))) this.emit({ t: "gain", got });
  }
  nextTurn() {
    const s = this.s;
    s.offers = [];
    const n = s.players.length;
    let seat = s.current;
    for (let k = 0; k < n; k++) {
      seat = (seat + 1) % n;
      if (!s.players[seat].out) break;
    }
    s.current = seat;
    s.turn++;
    s.played = false;
    s.phase = { k: "roll" };
    this.emit({ t: "turn", seat });
    this.checkWin();
  }
  advanceSetup(from: number) {
    const s = this.s;
    const n = s.players.length;
    for (let i = from; i < 2 * n; i++) {
      if (!s.players[setupSeat(s, i)].out) {
        s.phase = { k: "setup", i, at: -1 };
        s.current = setupSeat(s, i);
        return;
      }
    }
    s.current = alive(s)[0];
    s.turn = 1;
    s.played = false;
    s.phase = { k: "roll" };
    this.emit({ t: "turn", seat: s.current });
  }
  steal(seat: number, from: number) {
    const res = this.s.players[from].res;
    const total = sum(res);
    if (!total) return;
    let pick = Math.floor(this.rng() * total);
    let r = 0;
    while (pick >= res[r]) pick -= res[r++];
    res[r]--;
    this.s.players[seat].res[r]++;
    this.emit({ t: "steal", seat, from, r });
  }
  dropOut(seat: number) {
    const s = this.s;
    const p = s.players[seat];
    if (p.out) return;
    p.out = true;
    p.res = noHand();
    s.offers = s.offers.filter((o) => o.from !== seat && o.to !== seat);
    this.emit({ t: "out", seat });
    const left = alive(s);
    if (left.length === 1) {
      this.awards();
      this.finish(left[0], totalPoints(this.g, left[0]));
      return;
    }
    this.awards();
    const ph = s.phase;
    if (ph.k === "setup") {
      if (setupSeat(s, ph.i) === seat) this.advanceSetup(ph.i + 1);
      return;
    }
    if (ph.k === "discard") {
      ph.owe[seat] = 0;
      if (s.current !== seat && ph.owe.every((o) => o === 0)) s.phase = { k: "bandit", then: "main" };
    }
    if (s.current === seat) this.nextTurn();
    else this.checkWin();
  }
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function need(why: string | null) {
  if (why) throw new Error(why);
}

export function act(game: Game, seat: number, a: Action, rng: Rng = Math.random): Game {
  const g: Game = { s: clone(game.s), deck: [...game.deck], held: clone(game.held), events: [] };
  const t = new Turn(g, rng);
  const s = g.s;
  const ph = s.phase;
  const p = s.players[seat];
  if (!p) throw new Error("You're not in this game.");
  if (ph.k === "over") throw new Error("The game's over.");
  if (p.out) throw new Error("You're out of this game.");
  const mine = s.current === seat;
  const geom = geo(s);

  switch (a.k) {
    case "resign":
      t.dropOut(seat);
      return g;
    case "discard": {
      if (ph.k !== "discard" || !(ph.owe[seat] > 0)) throw new Error("You don't need to discard.");
      if (!isHand(a.res) || sum(a.res) !== ph.owe[seat]) throw new Error(`Pick ${ph.owe[seat]} cards to give back.`);
      if (!covers(p.res, a.res)) throw new Error("You don't have those.");
      t.pay(seat, a.res);
      ph.owe[seat] = 0;
      t.emit({ t: "discard", seat, res: a.res });
      if (ph.owe.every((o) => o === 0)) s.phase = { k: "bandit", then: "main" };
      return g;
    }
    case "offer": {
      need(cantOffer(s, seat, a.to, a.give, a.get));
      const offer: Offer = { id: s.nextOffer++, from: seat, to: a.to, give: [...a.give], get: [...a.get], no: [] };
      s.offers.push(offer);
      t.emit({ t: "offer", offer });
      return g;
    }
    case "accept": {
      const o = s.offers.find((x) => x.id === a.id);
      if (!o) throw new Error("That offer's gone.");
      need(cantAccept(s, seat, o));
      t.pay(o.from, o.give);
      t.pay(seat, o.get);
      o.give.forEach((n, r) => (s.players[seat].res[r] += n));
      o.get.forEach((n, r) => (s.players[o.from].res[r] += n));
      s.offers = s.offers.filter((x) => x.id !== o.id);
      t.emit({ t: "traded", offer: o, by: seat });
      return g;
    }
    case "reject":
    case "withdraw": {
      const o = s.offers.find((x) => x.id === a.id);
      if (!o) throw new Error("That offer's gone.");
      if (a.k === "withdraw") {
        if (o.from !== seat) throw new Error("That's not your offer.");
        s.offers = s.offers.filter((x) => x.id !== o.id);
        t.emit({ t: "untrade", offer: o, by: seat, why: "withdraw" });
        return g;
      }
      if (o.from === seat || (o.to >= 0 && o.to !== seat)) throw new Error("That offer isn't for you.");
      if (o.to >= 0) s.offers = s.offers.filter((x) => x.id !== o.id);
      else {
        if (!o.no.includes(seat)) o.no.push(seat);
        const could = alive(s).filter((i) => i !== o.from && (o.from === s.current || i === s.current));
        if (could.every((i) => o.no.includes(i))) s.offers = s.offers.filter((x) => x.id !== o.id);
      }
      t.emit({ t: "untrade", offer: o, by: seat, why: "reject" });
      return g;
    }
  }

  if (!mine && ph.k !== "setup") throw new Error("It's not your turn.");
  if (ph.k === "setup" && setupSeat(s, ph.i) !== seat) throw new Error("It's not your turn.");

  switch (a.k) {
    case "village": {
      if (ph.k === "setup") {
        if (ph.at >= 0) throw new Error("Now place a road next to it.");
        need(cantVillage(s, seat, a.at, true));
        s.spots[a.at] = { seat, town: false };
        ph.at = a.at;
        t.emit({ t: "build", seat, kind: "village", at: a.at });
        if (ph.i >= s.players.length) {
          const got = noHand();
          for (const h of geom.verts[a.at].hexes) if (s.hexes[h].r !== DESERT) got[s.hexes[h].r]++;
          got.forEach((n, r) => (p.res[r] += n));
          t.emit({ t: "start", seat, got });
        }
        t.awards();
        return g;
      }
      need(cantBuild(s, seat, "village"));
      need(cantVillage(s, seat, a.at, false));
      t.pay(seat, COSTS.village);
      s.spots[a.at] = { seat, town: false };
      t.emit({ t: "build", seat, kind: "village", at: a.at });
      t.awards();
      t.checkWin();
      return g;
    }
    case "road": {
      if (ph.k === "setup") {
        if (ph.at < 0) throw new Error("Place your settlement first.");
        need(cantRoad(s, seat, a.at, ph.at));
        s.roads[a.at] = seat;
        t.emit({ t: "build", seat, kind: "road", at: a.at });
        t.awards();
        t.advanceSetup(ph.i + 1);
        return g;
      }
      if (ph.k === "roads") {
        need(cantRoad(s, seat, a.at));
        s.roads[a.at] = seat;
        t.emit({ t: "build", seat, kind: "road", at: a.at });
        ph.left--;
        if (ph.left <= 0 || roadsOf(s, seat) >= PIECES.road || !roadSpots(s, seat).length) s.phase = { k: ph.then };
        t.awards();
        t.checkWin();
        return g;
      }
      need(cantBuild(s, seat, "road"));
      need(cantRoad(s, seat, a.at));
      t.pay(seat, COSTS.road);
      s.roads[a.at] = seat;
      t.emit({ t: "build", seat, kind: "road", at: a.at });
      t.awards();
      t.checkWin();
      return g;
    }
    case "town": {
      need(cantBuild(s, seat, "town"));
      const spot = s.spots[a.at];
      if (!spot || spot.seat !== seat || spot.town) throw new Error("Cities replace your own settlements.");
      t.pay(seat, COSTS.town);
      spot.town = true;
      t.emit({ t: "build", seat, kind: "town", at: a.at });
      t.checkWin();
      return g;
    }
    case "doneRoads": {
      if (ph.k !== "roads") throw new Error("You're not placing free roads.");
      s.phase = { k: ph.then };
      s.seq++;
      return g;
    }
    case "roll": {
      if (ph.k !== "roll") throw new Error("You've rolled already.");
      const dice = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
      s.dice = dice;
      t.emit({ t: "roll", seat, dice });
      const total = dice[0] + dice[1];
      if (total !== 7) {
        t.produce(total);
        s.phase = { k: "main" };
        return g;
      }
      const owe = s.players.map((x) => (!x.out && sum(x.res) > s.rules.limit ? Math.floor(sum(x.res) / 2) : 0));
      s.phase = owe.some((o) => o > 0) ? { k: "discard", owe } : { k: "bandit", then: "main" };
      return g;
    }
    case "bandit": {
      if (ph.k !== "bandit") throw new Error("The robber isn't moving now.");
      if (!banditHexes(s, seat).includes(a.hex)) throw new Error("Move the robber somewhere else.");
      const victims = victimsAt(s, seat, a.hex);
      if (victims.length && !victims.includes(a.from)) throw new Error("Pick someone to steal from.");
      s.bandit = a.hex;
      t.emit({ t: "bandit", seat, hex: a.hex });
      if (victims.length) t.steal(seat, a.from);
      s.phase = { k: ph.then };
      t.checkWin();
      return g;
    }
    case "buy": {
      need(cantBuild(s, seat, "card"));
      t.pay(seat, COSTS.card);
      const c = g.deck.shift()!;
      g.held[seat].push({ c, t: s.turn });
      s.deckLeft = g.deck.length;
      p.devs++;
      t.emit({ t: "buy", seat });
      t.checkWin();
      return g;
    }
    case "knight":
    case "roads":
    case "plenty":
    case "corner": {
      need(cantDev(g, seat, a.k));
      if (a.k === "roads" && (roadsOf(s, seat) >= PIECES.road || !roadSpots(s, seat).length))
        throw new Error("You've nowhere to put a road.");
      if (a.k === "plenty") {
        const bank = bankOf(s);
        const want = noHand();
        if (![a.a, a.b].every((r) => Number.isInteger(r) && r >= 0 && r < 5)) throw new Error("Pick two resources.");
        want[a.a]++;
        want[a.b]++;
        if (!covers(bank, want)) throw new Error("The bank's out of that.");
      }
      if (a.k === "corner" && !(Number.isInteger(a.r) && a.r >= 0 && a.r < 5)) throw new Error("Pick a resource.");
      const held = g.held[seat];
      held.splice(
        held.findIndex((h) => h.c === a.k && h.t < s.turn),
        1,
      );
      p.devs--;
      s.played = true;
      const then = ph.k === "roll" ? "roll" : "main";
      if (a.k === "knight") {
        p.knights++;
        t.emit({ t: "play", seat, card: "knight" });
        t.awards();
        s.phase = { k: "bandit", then };
      } else if (a.k === "roads") {
        t.emit({ t: "play", seat, card: "roads" });
        s.phase = { k: "roads", left: 2, then };
      } else if (a.k === "plenty") {
        const got = noHand();
        got[a.a]++;
        got[a.b]++;
        got.forEach((n, r) => (p.res[r] += n));
        t.emit({ t: "play", seat, card: "plenty", got });
      } else {
        let took = 0;
        for (const [i, o] of s.players.entries()) {
          if (i === seat) continue;
          took += o.res[a.r];
          o.res[a.r] = 0;
        }
        p.res[a.r] += took;
        t.emit({ t: "play", seat, card: "corner", r: a.r, took });
      }
      t.checkWin();
      return g;
    }
    case "bank": {
      if (ph.k !== "main") throw new Error("Trade after you roll.");
      if (![a.give, a.get].every((r) => Number.isInteger(r) && r >= 0 && r < 5) || a.give === a.get)
        throw new Error("Pick two different resources.");
      const n = rateFor(s, seat, a.give);
      if (p.res[a.give] < n) throw new Error(`You need ${n} ${RESOURCE_NAMES[a.give].toLowerCase()}.`);
      if (bankOf(s)[a.get] < 1) throw new Error("The bank's out of that.");
      p.res[a.give] -= n;
      p.res[a.get]++;
      t.emit({ t: "bank", seat, give: a.give, n, get: a.get });
      return g;
    }
    case "end": {
      if (ph.k !== "main") throw new Error(ph.k === "roll" ? "Roll first." : "Finish what you're doing first.");
      t.nextTurn();
      return g;
    }
  }
  throw new Error("That's not a move.");
}

export function standings(g: Game): number[][] {
  const s = g.s;
  const winner = s.phase.k === "over" ? s.phase.winner : -1;
  const rows = s.players.map((p, i) => ({ i, out: p.out, pts: totalPoints(g, i) }));
  const groups: number[][] = winner >= 0 ? [[winner]] : [];
  const rest = rows.filter((r) => r.i !== winner).sort((a, b) => Number(a.out) - Number(b.out) || b.pts - a.pts);
  for (const r of rest) {
    const last = groups.at(-1);
    const prev = last && rows[last[0]];
    if (last && prev && prev.i !== winner && prev.pts === r.pts && prev.out === r.out) last.push(r.i);
    else groups.push([r.i]);
  }
  return groups;
}

export const handSize = (h: readonly number[]) => sum(h);
export const canAfford = (h: readonly number[], kind: Piece) => covers(h, COSTS[kind]);
