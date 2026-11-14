import { describe, expect, test } from "vitest";
import { BOARD, BUYABLE, HOTELS, HOUSES, groupOf } from "./board";
import { DECKS } from "./cards";
import { DEFAULT_RULES, POT, act, actor, alive, newGame, type Game, type MonoState, type Rules } from "./engine";
import { botMove, spare } from "./bot";

// Bots play whole games under every mix of rules, and after every action the state has to make sense.

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function check(g: Game, before: MonoState) {
  const s = g.s;
  const fail = (why: string) => {
    throw new Error(`${why} (after ${JSON.stringify(g.events.slice(-4))})`);
  };
  for (const p of s.players) if (p.cash < 0 || !Number.isFinite(p.cash)) fail("Negative cash");
  if (s.pot < 0) fail("Negative pot");
  // Every payment event accounts for every change in cash.
  const cash = before.players.map((p) => p.cash);
  let pot = before.pot;
  for (const e of g.events) {
    if (e.t !== "pay") continue;
    if (e.from >= 0) cash[e.from] -= e.amount;
    if (e.to >= 0) cash[e.to] += e.amount;
    if (e.from === POT) pot -= e.amount;
    if (e.to === POT) pot += e.amount;
    if (e.from === e.to) fail("Paid themselves");
    if (JSON.stringify(e.cash) !== JSON.stringify(cash) || e.pot !== pot) fail("A payment's cash doesn't add up");
  }
  if (JSON.stringify(cash) !== JSON.stringify(s.players.map((p) => p.cash)) || pot !== s.pot) fail("Cash changed without a payment");
  if (s.rules.limited) {
    const houses = BUYABLE.reduce((a, i) => a + (s.props[i]!.houses < 5 ? s.props[i]!.houses : 0), 0);
    const hotels = BUYABLE.filter((i) => s.props[i]!.houses === 5).length;
    if (houses + s.bank.houses !== HOUSES || hotels + s.bank.hotels !== HOTELS) fail("Buildings went missing");
    if (s.bank.houses < 0 || s.bank.hotels < 0) fail("The bank's short of buildings");
  }
  for (const i of BUYABLE) {
    const prop = s.props[i]!;
    if (prop.owner >= 0 && s.players[prop.owner].out) fail("An out player owns something");
    if (prop.houses > 0) {
      const group = groupOf(i);
      if (BOARD[i].kind !== "street") fail("Buildings off a street");
      if (group.some((j) => s.props[j]!.owner !== prop.owner)) fail("Buildings without the whole group");
      if (group.some((j) => s.props[j]!.mortgaged)) fail("Buildings on a mortgaged group");
      const hs = group.map((j) => s.props[j]!.houses);
      if (Math.max(...hs) - Math.min(...hs) > 1 && !(s.rules.short && Math.max(...hs) === 5 && Math.min(...hs) === 3)) fail(`Uneven buildings ${hs}`);
    }
    if (prop.owner < 0 && (prop.mortgaged || prop.houses)) fail("The bank's property is mortgaged or built on");
  }
  for (const d of ["chance", "chest"] as const) {
    const held = s.players.filter((p) => !p.out).reduce((a, p) => a + p.free.filter((x) => x === d).length, 0);
    if (g.decks[d].length + held !== DECKS[d].length) fail(`The ${d} deck lost a card`);
  }
  if (s.phase.k === "idle") fail("Left idle");
  if (s.phase.k !== "over") {
    const who = actor(s);
    if (who < 0 || s.players[who].out) fail("Waiting on nobody");
    // A bankrupt player's turn only lasts while their properties are auctioned or their creditor pays the
    // interest on what they got.
    if (s.players[s.current].out && s.phase.k !== "auction" && s.phase.k !== "debt") fail("An out player's turn");
    if (s.phase.k === "auction" && s.phase.leader >= 0 && !s.phase.in.includes(s.phase.leader)) fail("Auction leader dropped");
    if (s.phase.k === "debt" && s.phase.from >= 0 && s.players[s.phase.from].cash >= s.phase.amount) fail("A debt left unpaid that could be paid");
    if (alive(s).length < 2) fail("One left and not over");
  }
  for (const t of s.trades) if (s.players[t.from].out || s.players[t.to].out) fail("A trade with someone out");
  if (s.todo.length > 60) fail("Runaway steps");
}

const RULE_MIXES: Partial<Rules>[] = [
  {},
  { speed: true },
  { pot: 1, goDouble: true },
  { pot: 2, jailRent: false, firstLap: true },
  { auctions: false, limited: false },
  { short: true },
  { rounds: 15, speed: true },
  { cash: 1000, speed: true, pot: 2 },
];

function playOut(seed: number, n: number, rules: Partial<Rules>, maxActions = 6000) {
  const rng = mulberry(seed);
  let g = newGame(n, { ...DEFAULT_RULES, ...rules }, rng);
  let actions = 0;
  for (; actions < maxActions && g.s.phase.k !== "over"; actions++) {
    // Mostly whoever the game's waiting on; sometimes someone else doing what they can any time, answering
    // an offer, or bidding out of turn.
    const s = g.s;
    let seat = alive(s)[Math.floor(rng() * alive(s).length)];
    let a = rng() < 0.15 ? spare(s, seat, rng) : null;
    if (!a) {
      const could = [actor(s), ...s.trades.map((t) => t.to), ...(s.phase.k === "auction" ? s.phase.in : [])];
      seat = could[Math.floor(rng() * could.length)];
      a = botMove(s, seat, rng);
      if (!a) {
        seat = actor(s);
        a = botMove(s, seat, rng);
      }
    }
    if (!a) throw new Error(`Seed ${seed}: stuck in ${JSON.stringify(g.s.phase)} waiting on ${actor(g.s)}`);
    const before = g.s;
    try {
      g = act(g, seat, a, rng);
    } catch (e) {
      throw new Error(`Seed ${seed}: ${seat} ${JSON.stringify(a)} in ${JSON.stringify(before.phase)}: ${(e as Error).message}`);
    }
    try {
      check(g, before);
    } catch (e) {
      throw new Error(`Seed ${seed}, action ${actions} by ${seat} ${JSON.stringify(a)}: ${(e as Error).message}`);
    }
  }
  return { g, actions };
}

describe("bots playing whole games", () => {
  for (const [i, rules] of RULE_MIXES.entries()) {
    test(`rules ${JSON.stringify(rules)}`, () => {
      let finished = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const n = 2 + (seed % 7);
        const { g } = playOut(seed * 1000 + i, n, rules);
        if (g.s.phase.k === "over") finished++;
      }
      // Bots build and trade, so most games end in the cap.
      expect(finished).toBeGreaterThan(30);
    }, 120_000);
  }
});
