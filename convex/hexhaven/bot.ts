import { PIECES, geometryOf, noHand, pips } from "./board";
import {
  actor,
  banditHexes,
  bankOf,
  cantAccept,
  cantBuild,
  playable,
  rateFor,
  roadSpots,
  roadsOf,
  townSpots,
  victimsAt,
  villageSpots,
  type Action,
  type Game,
  type HexState,
  type Rng,
} from "./engine";

const pick = <T>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)];

function spotValue(s: HexState, v: number) {
  const g = geometryOf(s.layout);
  return g.verts[v].hexes.reduce((a, h) => a + pips(s.hexes[h].n), 0);
}

const best = (s: HexState, spots: number[]) => [...spots].sort((a, b) => spotValue(s, b) - spotValue(s, a))[0];

function roadToward(s: HexState, seat: number, rng: Rng) {
  const spots = roadSpots(s, seat);
  if (!spots.length) return undefined;
  const g = geometryOf(s.layout);
  const open = new Set(villageSpots(s, seat, true));
  const good = spots.filter((e) => open.has(g.edges[e].a) || open.has(g.edges[e].b));
  return pick(good.length ? good : spots, rng);
}

export function nextBotSeat(s: HexState, isHuman: (seat: number) => boolean): number | null {
  if (s.phase.k === "over") return null;
  for (const o of s.offers) {
    const bot = s.players.findIndex((pl, i) => !pl.out && !isHuman(i) && i !== o.from && (o.to === i || (o.to < 0 && !o.no.includes(i))));
    if (bot >= 0) return bot;
  }
  if (s.phase.k === "discard") {
    const seat = s.phase.owe.findIndex((o, i) => o > 0 && !isHuman(i));
    return seat >= 0 ? seat : null;
  }
  const up = actor(s);
  return isHuman(up) ? null : up;
}

export function botMove(g: Game, seat: number, rng: Rng): Action | null {
  const s = g.s;
  const p = s.players[seat];
  const ph = s.phase;
  const offer = s.offers.find((o) => (o.to === seat || (o.to < 0 && o.from !== seat && !o.no.includes(seat))) && o.from !== seat);
  if (offer) return !cantAccept(s, seat, offer) && rng() < 0.6 ? { k: "accept", id: offer.id } : { k: "reject", id: offer.id };
  if (ph.k === "over") return null;
  if (ph.k === "discard") {
    if (!(ph.owe[seat] > 0)) return null;
    const res = noHand();
    const have = [...p.res];
    for (let k = 0; k < ph.owe[seat]; k++) {
      const r = have.indexOf(Math.max(...have));
      have[r]--;
      res[r]++;
    }
    return { k: "discard", res };
  }
  if (actor(s) !== seat) return null;
  if (ph.k === "setup") {
    if (ph.at < 0) return { k: "village", at: best(s, villageSpots(s, seat, true)) };
    return { k: "road", at: pick(roadSpots(s, seat, ph.at), rng) };
  }
  if (ph.k === "bandit") {
    const hexes = banditHexes(s, seat);
    const hurting = hexes.filter((h) => victimsAt(s, seat, h).length);
    const hex = pick(hurting.length ? hurting : hexes, rng);
    const victims = victimsAt(s, seat, hex);
    return { k: "bandit", hex, from: victims.length ? pick(victims, rng) : -1 };
  }
  if (ph.k === "roads") {
    const at = roadToward(s, seat, rng);
    return at === undefined ? { k: "doneRoads" } : { k: "road", at };
  }
  const cards = playable(g, seat);
  if (cards.includes("knight") && rng() < 0.5) return { k: "knight" };
  if (ph.k === "roll") return { k: "roll" };
  if (cards.length && rng() < 0.3) {
    const c = pick(cards, rng);
    if (c === "plenty") {
      const bank = bankOf(s);
      const r = bank.indexOf(Math.max(...bank));
      if (bank[r] >= 2) return { k: "plenty", a: r, b: r };
    }
    if (c === "corner") return { k: "corner", r: Math.floor(rng() * 5) };
    if (c === "roads" && roadsOf(s, seat) < PIECES.road && roadSpots(s, seat).length) return { k: "roads" };
    if (c === "knight") return { k: "knight" };
  }
  if (!cantBuild(s, seat, "town")) return { k: "town", at: best(s, townSpots(s, seat)) };
  if (!cantBuild(s, seat, "village")) return { k: "village", at: best(s, villageSpots(s, seat)) };
  if (!cantBuild(s, seat, "card") && rng() < 0.5) return { k: "buy" };
  if (!cantBuild(s, seat, "road") && (villageSpots(s, seat).length === 0 || rng() < 0.3)) {
    const at = roadToward(s, seat, rng);
    if (at !== undefined) return { k: "road", at };
  }
  const bank = bankOf(s);
  for (let r = 0; r < 5; r++) {
    const rate = rateFor(s, seat, r);
    if (p.res[r] < rate + 1) continue;
    const want = [0, 1, 2, 3, 4].filter((x) => x !== r && bank[x] > 0).sort((a, b) => p.res[a] - p.res[b])[0];
    if (want !== undefined) return { k: "bank", give: r, get: want };
  }
  if (rng() < 0.15 && !s.offers.some((o) => o.from === seat)) {
    const give = p.res.indexOf(Math.max(...p.res));
    const get = p.res.indexOf(Math.min(...p.res));
    if (give !== get && p.res[give] > 0) {
      const others = s.players.flatMap((o, i) => (i !== seat && !o.out ? [i] : []));
      const to = seat === s.current ? (rng() < 0.5 ? -1 : pick(others, rng)) : s.current;
      const giveHand = noHand();
      giveHand[give] = 1;
      const getHand = noHand();
      getHand[get] = 1;
      return { k: "offer", to, give: giveHand, get: getHand };
    }
  }
  return { k: "end" };
}
