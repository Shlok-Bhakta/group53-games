// The property-trading game's rules as plain functions on plain data, shared by the server and phones. No
// Convex or browser imports. The official rules throughout, with the common house rules and the speed die as
// settings (`Rules`).
//
// A game is `{ s, decks, events }`: `s` is everything public (matches.state), `decks` the order of the two
// card decks (the game's secret), and `events` what the last move did, in order, for the phones to play back.
// `act` takes one player's action and returns the new game, or throws a sentence saying why not.
//
// A turn is a queue of steps (`todo`: move, land, pay, roll again...) run until one needs someone to decide
// something (`phase`): buy or auction, a bid, a choice of the speed die's bus, raising money for a debt.
// Building, mortgaging and trading don't wait for a turn: any player can do them whenever, as the rules allow.

import {
  BOARD,
  BUYABLE,
  GO_SALARY,
  HOTELS,
  HOUSES,
  JAIL,
  JAIL_FINE,
  SIZE,
  groupOf,
  houseCostOf,
  isBuyable,
  mortgageOf,
  priceOf,
  unmortgageOf,
} from "./board";
import { DECKS, FREE_CARD, type Deck } from "./cards";

export type { Deck } from "./cards";

// Money goes to and from players (seats), the bank, or the Rest Stop jackpot (a house rule).
export const BANK = -1;
export const POT = -2;

export type Rules = {
  cash: number;
  // Turn down a property and it's auctioned (official), or it stays with the bank.
  auctions: boolean;
  // House rule: taxes and fines go in a jackpot on the Rest Stop, and whoever lands there takes it. 2 also
  // puts $500 in at the start and every time it's taken.
  pot: 0 | 1 | 2;
  // House rule: landing right on Start pays double.
  goDouble: boolean;
  // Collect rent while you're in jail (official), or not.
  jailRent: boolean;
  // House rule: nobody can buy until they've been round once.
  firstLap: boolean;
  // The speed die (official, from your second lap).
  speed: boolean;
  // The bank's 32 houses and 12 hotels (official), or as many as anyone wants.
  limited: boolean;
  // The official short game: two properties each to start, hotels after three houses, over at the second
  // bankruptcy and the richest wins.
  short: boolean;
  // Over after this many rounds, the richest winning. 0: no limit.
  rounds: number;
};

export const DEFAULT_RULES: Rules = { cash: 1500, auctions: true, pot: 0, goDouble: false, jailRent: true, firstLap: false, speed: false, limited: true, short: false, rounds: 0 };

export type Player = {
  cash: number;
  pos: number;
  // -1 when free; in jail, how many rolls for doubles have failed so far.
  jail: number;
  // Get-out-of-jail cards held, by the deck they came from.
  free: Deck[];
  // Been past Start at least once (the speed die and the first-lap house rule).
  lapped: boolean;
  out: boolean;
};

// `houses`: 0 to 4, and 5 for a hotel.
export type Prop = { owner: number; houses: number; mortgaged: boolean };

export type Side = { cash: number; props: number[]; free: Deck[] };
// `lift`: of what the offer's maker gets, the mortgages they'll lift at once.
export type Trade = { id: number; from: number; to: number; give: Side; get: Side; lift?: number[] };

export type Phase =
  | { k: "roll" }
  | { k: "buy"; pos: number }
  // `in`: who's still bidding, in turn order from whoever's turn it is. Dropping out is for good.
  | { k: "auction"; pos: number; high: number; leader: number; in: number[] }
  | { k: "debt"; from: number; to: number; amount: number; why: Why }
  // The speed die's bus: move by either die or both.
  | { k: "bus"; dice: [number, number] }
  // Triples on the speed die: go anywhere.
  | { k: "pick" }
  | { k: "idle" }
  | { k: "over" };

type Step =
  | { k: "walk"; n: number }
  // Whoever's turn it is deals with where they stand. `dice` is what a utility's rent is counted from; `mod`
  // is a card's doubled station rent or ten-times utility.
  | { k: "land"; dice: number; mod?: "rail2" | "util10" }
  | { k: "pay"; from: number; to: number; amount: number; why: Why }
  | { k: "mrm" }
  | { k: "auction"; pos: number }
  | { k: "after" }
  | { k: "next" }
  // Back to the roll the game was waiting on, after something came up in between (a bankruptcy's auctions).
  | { k: "resume" };

export type Why = "rent" | "tax" | "go" | "card" | "jail" | "buy" | "build" | "sell" | "mortgage" | "unmortgage" | "interest" | "auction" | "pot" | "seed" | "trade" | "bankrupt";

// What happened, in order. Each carries what it changed outright (everyone's cash after a payment, the new
// owner), so a phone can play them back from any earlier state without the rules.
export type Ev =
  | { t: "turn"; seat: number; again?: boolean }
  | { t: "roll"; seat: number; dice: number[]; speed?: number; jail?: boolean; util?: boolean }
  | { t: "move"; seat: number; from: number; to: number; how: "walk" | "back" | "jump" | "jail" }
  | { t: "pay"; from: number; to: number; amount: number; why: Why; pos?: number; cash: number[]; pot: number }
  | { t: "card"; seat: number; deck: Deck; card: number }
  | { t: "jail"; seat: number; in: boolean; how?: "doubles" | "paid" | "card" | "third" | "three" }
  | { t: "own"; pos: number; owner: number; mortgaged: boolean; houses: number }
  | { t: "build"; pos: number; houses: number; bank: { houses: number; hotels: number } }
  | { t: "auction"; pos: number; in: number[] }
  | { t: "bid"; seat: number; amount: number }
  | { t: "fold"; seat: number }
  | { t: "sold"; pos: number; seat: number; amount: number }
  | { t: "unsold"; pos: number }
  | { t: "debt"; seat: number; to: number; amount: number; why: Why }
  | { t: "offer"; trade: Trade }
  | { t: "traded"; trade: Trade }
  | { t: "untrade"; trade: Trade; by: number; why: "reject" | "withdraw" | "stale" }
  | { t: "out"; seat: number; to: number }
  | { t: "over" };

export type MonoState = {
  kind: "monopoly";
  rules: Rules;
  players: Player[];
  // One per square: null where there's nothing to own.
  props: (Prop | null)[];
  current: number;
  phase: Phase;
  todo: Step[];
  // Doubles rolled this turn, and whether they've earned another roll.
  doubles: number;
  again: boolean;
  dice: number[] | null;
  pot: number;
  bank: { houses: number; hotels: number };
  round: number;
  // Seats in the order they went out.
  out: number[];
  trades: Trade[];
  tradeSeq: number;
  // Events so far, over the whole game.
  seq: number;
};

export type Decks = Record<Deck, number[]>;
export type Game = { s: MonoState; decks: Decks; events: Ev[] };

export type Action =
  | { k: "roll" }
  | { k: "payJail" }
  | { k: "cardJail" }
  | { k: "buy" }
  | { k: "decline" }
  | { k: "bid"; amount: number }
  | { k: "fold" }
  | { k: "bus"; choice: 0 | 1 | 2 }
  | { k: "pick"; pos: number }
  | { k: "pay" }
  | { k: "bankrupt" }
  | { k: "build"; pos: number }
  | { k: "sell"; pos: number }
  | { k: "sellAll"; pos: number }
  | { k: "mortgage"; pos: number }
  | { k: "unmortgage"; pos: number }
  | { k: "offer"; to: number; give: Side; get: Side; lift?: number[] }
  // `lift`: of what you get, the mortgages you lift at once (otherwise you pay 10% now and lift later).
  | { k: "accept"; id: number; lift?: number[] }
  | { k: "reject"; id: number }
  | { k: "withdraw"; id: number }
  | { k: "resign" };

export type Rng = () => number;
const die = (rng: Rng) => 1 + Math.floor(rng() * 6);
export function shuffled(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Reading the state ---

export const alive = (s: MonoState) => s.players.flatMap((p, i) => (p.out ? [] : [i]));
export const hotelAt = (r: Rules) => (r.short ? 3 : 4);
export const fineTo = (s: MonoState) => (s.rules.pot ? POT : BANK);
const owned = (s: MonoState, seat: number) => BUYABLE.filter((i) => s.props[i]!.owner === seat);
export const ownsGroup = (s: MonoState, seat: number, pos: number) => groupOf(pos).every((i) => s.props[i]!.owner === seat);
const buildingsIn = (s: MonoState, pos: number) => groupOf(pos).some((i) => s.props[i]!.houses > 0);

// What a player can spend: a winning bid in a running auction is spoken for.
export function spendable(s: MonoState, seat: number) {
  const ph = s.phase;
  return s.players[seat].cash - (ph.k === "auction" && ph.leader === seat ? ph.high : 0);
}

// The rent for landing on `pos`, rolling `dice` (utilities), with a card's `mod`.
export function rentOf(s: MonoState, pos: number, dice: number, mod?: "rail2" | "util10"): number {
  const sq = BOARD[pos];
  const prop = s.props[pos]!;
  if (prop.owner < 0 || prop.mortgaged) return 0;
  const n = groupOf(pos).filter((i) => s.props[i]!.owner === prop.owner).length;
  if (sq.kind === "street") return prop.houses > 0 ? sq.rent[prop.houses] : sq.rent[0] * (ownsGroup(s, prop.owner, pos) ? 2 : 1);
  if (sq.kind === "rail") return 25 * 2 ** (n - 1) * (mod === "rail2" ? 2 : 1);
  return dice * (mod === "util10" ? 10 : n >= 2 ? 10 : 4);
}

// What everything a player has is worth: cash, properties at their price (half if mortgaged) and buildings at
// what they cost. The short game and the round limit place by it.
export function worth(s: MonoState, seat: number): number {
  let w = s.players[seat].cash;
  for (const i of owned(s, seat)) {
    const prop = s.props[i]!;
    w += prop.mortgaged ? mortgageOf(i) : priceOf(i);
    w += (prop.houses === 5 ? hotelAt(s.rules) + 1 : prop.houses) * houseCostOf(i);
  }
  return w;
}

// Who the game is waiting on: whoever's turn it is, whoever owes money, or in an auction the next bidder
// after the leader. -1 once it's over.
export function actor(s: MonoState): number {
  const ph = s.phase;
  if (ph.k === "over") return -1;
  if (ph.k === "debt") return ph.from;
  if (ph.k === "auction") {
    const others = ph.in.filter((x) => x !== ph.leader);
    if (ph.leader < 0) return others[0] ?? s.current;
    const after = others.find((x) => x > ph.leader);
    return after ?? others[0] ?? ph.leader;
  }
  return s.current;
}

// Why a player can't put a building on `pos` right now, or null if they can.
export function cantBuild(s: MonoState, seat: number, pos: number): string | null {
  const sq = BOARD[pos];
  const prop = s.props[pos];
  if (sq.kind !== "street" || !prop) return "Only streets take houses.";
  if (prop.owner !== seat) return "That isn't yours.";
  if (!ownsGroup(s, seat, pos)) return "You need the whole color group first.";
  const group = groupOf(pos);
  if (group.some((i) => s.props[i]!.mortgaged)) return "Lift the mortgages in this group first.";
  if (prop.houses >= 5) return "It already has a hotel.";
  const top = hotelAt(s.rules);
  if (prop.houses > Math.min(...group.map((i) => Math.min(s.props[i]!.houses, top)))) return "Build evenly: the others in the group need one first.";
  if (prop.houses === top && group.some((i) => s.props[i]!.houses < top)) return "Build evenly: the others in the group need one first.";
  if (spendable(s, seat) < sq.house) return `A ${prop.houses === top ? "hotel" : "house"} costs $${sq.house}.`;
  if (s.rules.limited) {
    if (prop.houses === top && s.bank.hotels === 0) return "The bank's out of hotels.";
    if (prop.houses < top && s.bank.houses === 0) return "The bank's out of houses.";
  }
  return null;
}

// Why a player can't sell a building off `pos`, or null.
export function cantSell(s: MonoState, seat: number, pos: number): string | null {
  const prop = s.props[pos];
  if (!prop || prop.owner !== seat) return "That isn't yours.";
  if (prop.houses === 0) return "There's nothing built there.";
  if (prop.houses < Math.max(...groupOf(pos).map((i) => s.props[i]!.houses))) return "Sell evenly: take one off the others first.";
  if (prop.houses === 5 && s.rules.limited && s.bank.houses < hotelAt(s.rules)) return "The bank hasn't the houses to break the hotel down. Sell the whole group's buildings instead.";
  return null;
}

export function cantMortgage(s: MonoState, seat: number, pos: number): string | null {
  const prop = s.props[pos];
  if (!prop || prop.owner !== seat) return "That isn't yours.";
  if (prop.mortgaged) return "It's already mortgaged.";
  if (buildingsIn(s, pos)) return "Sell the buildings in this group first.";
  return null;
}

export function cantUnmortgage(s: MonoState, seat: number, pos: number): string | null {
  const prop = s.props[pos];
  if (!prop || prop.owner !== seat) return "That isn't yours.";
  if (!prop.mortgaged) return "It isn't mortgaged.";
  if (spendable(s, seat) < unmortgageOf(pos)) return `Lifting it costs $${unmortgageOf(pos)}.`;
  return null;
}

// Everything a player could raise by selling every building and mortgaging everything.
export function raisable(s: MonoState, seat: number): number {
  let r = 0;
  for (const i of owned(s, seat)) {
    const prop = s.props[i]!;
    r += ((prop.houses === 5 ? hotelAt(s.rules) + 1 : prop.houses) * houseCostOf(i)) / 2;
    if (!prop.mortgaged) r += mortgageOf(i);
  }
  return r;
}

// Places, best first: those still in by what they're worth (ties together), then everyone who went out, the
// last to go first.
export function standings(s: MonoState): number[][] {
  const left = alive(s).sort((a, b) => worth(s, b) - worth(s, a));
  const groups: number[][] = [];
  for (const seat of left) {
    const g = groups.at(-1);
    if (g && worth(s, g[0]) === worth(s, seat)) g.push(seat);
    else groups.push([seat]);
  }
  return [...groups, ...[...s.out].reverse().map((seat) => [seat])];
}

const SHORT = "There isn't that much cash.";

// Why a trade can't happen as offered, or null.
export function cantTrade(s: MonoState, t: Pick<Trade, "from" | "to" | "give" | "get">): string | null {
  if (t.from === t.to) return "Trade with someone else.";
  for (const seat of [t.from, t.to]) if (!s.players[seat] || s.players[seat].out) return "They're out of the game.";
  const sides: [number, Side][] = [
    [t.from, t.give],
    [t.to, t.get],
  ];
  if (!t.give.cash && !t.give.props.length && !t.give.free.length && !t.get.cash && !t.get.props.length && !t.get.free.length) return "Put something in the trade.";
  for (const [seat, side] of sides) {
    if (!Number.isInteger(side.cash) || side.cash < 0) return "Cash has to be whole dollars.";
    if (side.cash > spendable(s, seat)) return SHORT;
    if (new Set(side.props).size !== side.props.length) return "Each property only once.";
    for (const pos of side.props) {
      const prop = s.props[pos];
      if (!prop || prop.owner !== seat) return `${BOARD[pos]?.name ?? "That"} has changed hands.`;
      if (buildingsIn(s, pos)) return `Sell the buildings on ${BOARD[pos].name}'s group before trading it.`;
    }
    const held = { chance: 0, chest: 0 };
    for (const d of side.free) held[d]++;
    for (const d of ["chance", "chest"] as const) if (held[d] > s.players[seat].free.filter((x) => x === d).length) return "That get-out-of-jail card isn't there any more.";
  }
  return null;
}

// Why the player an offer's to can't accept it now, or null: it has to still be possible, and both have to be
// able to pay the 10% on any mortgaged property they get.
export function cantAccept(s: MonoState, t: Trade, lift: number[] = []): string | null {
  const why = cantTrade(s, t);
  if (why) return why;
  const owe = [feesOn(s, t.give.props, lift).total, feesOn(s, t.get.props, t.lift ?? []).total];
  if (spendable(s, t.to) - t.get.cash + t.give.cash < owe[0]) return `You'd owe the bank $${owe[0]} on the mortgaged ones.`;
  if (spendable(s, t.from) - t.give.cash + t.get.cash < owe[1]) return `They'd owe the bank $${owe[1]} on the mortgaged ones, and can't pay it.`;
  return null;
}

// What someone given these properties owes the bank: 10% on each mortgaged one, or for those in `lift`, the
// mortgage plus 10% to lift it at once.
export function feesOn(s: MonoState, props: number[], lift: number[]) {
  const mortgaged = props.filter((i) => s.props[i]!.mortgaged);
  const interest = interestOn(s, mortgaged.filter((i) => !lift.includes(i)));
  const lifting = mortgaged.filter((i) => lift.includes(i)).reduce((a, i) => a + unmortgageOf(i), 0);
  return { interest, total: interest + lifting };
}

// The 10% a player pays on each mortgaged property they're given.
export const interestOn = (s: MonoState, props: number[]) => props.filter((i) => s.props[i]!.mortgaged).reduce((a, i) => a + Math.ceil(mortgageOf(i) / 10), 0);

// --- Setting up ---

export function newGame(n: number, rules: Rules, rng: Rng = Math.random): Game {
  const s: MonoState = {
    kind: "monopoly",
    rules,
    // The speed die comes with an extra $1,000 each (its official setup).
    players: Array.from({ length: n }, () => ({ cash: rules.cash + (rules.speed ? 1000 : 0), pos: 0, jail: -1, free: [], lapped: false, out: false })),
    props: BOARD.map((sq) => (isBuyable(sq) ? { owner: -1, houses: 0, mortgaged: false } : null)),
    current: 0,
    phase: { k: "roll" },
    todo: [],
    doubles: 0,
    again: false,
    dice: null,
    pot: rules.pot === 2 ? 500 : 0,
    bank: { houses: HOUSES, hotels: HOTELS },
    round: 1,
    out: [],
    trades: [],
    tradeSeq: 0,
    seq: 0,
  };
  const g: Game = { s, decks: { chance: shuffled(DECKS.chance.length, rng), chest: shuffled(DECKS.chest.length, rng) }, events: [] };
  // The short game deals everyone two properties from the shuffled deeds, paid for at their price.
  if (rules.short) {
    const deeds = shuffled(BUYABLE.length, rng).map((i) => BUYABLE[i]);
    for (let seat = 0; seat < n; seat++) {
      for (const pos of deeds.splice(0, 2)) {
        s.props[pos]!.owner = seat;
        pay(g, seat, BANK, priceOf(pos), "buy", pos);
        ownEv(g, pos);
      }
    }
  }
  emit(g, { t: "turn", seat: 0 });
  return g;
}

// --- Taking actions ---

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function act(g0: Game, seat: number, a: Action, rng: Rng = Math.random): Game {
  const g: Game = { s: clone(g0.s), decks: clone(g0.decks), events: [] };
  const s = g.s;
  const ph = s.phase;
  const p = s.players[seat];
  if (ph.k === "over") throw new Error("This game is over.");
  if (!p || p.out) throw new Error("You're out of this game.");
  const mine = seat === s.current;
  switch (a.k) {
    case "roll": {
      if (ph.k !== "roll" || !mine) throw new Error("It's not your roll.");
      roll(g, rng);
      break;
    }
    case "payJail": {
      if (ph.k !== "roll" || !mine || p.jail < 0) throw new Error("You're not in jail.");
      if (p.cash < JAIL_FINE) throw new Error(`Getting out costs $${JAIL_FINE}.`);
      pay(g, seat, fineTo(s), JAIL_FINE, "jail");
      p.jail = -1;
      emit(g, { t: "jail", seat, in: false, how: "paid" });
      break;
    }
    case "cardJail": {
      if (ph.k !== "roll" || !mine || p.jail < 0) throw new Error("You're not in jail.");
      const deck = p.free.shift();
      if (!deck) throw new Error("You don't have a get-out-of-jail card.");
      g.decks[deck].push(FREE_CARD[deck]);
      p.jail = -1;
      emit(g, { t: "jail", seat, in: false, how: "card" });
      break;
    }
    case "buy": {
      if (ph.k !== "buy" || !mine) throw new Error("There's nothing to buy.");
      if (p.cash < priceOf(ph.pos)) throw new Error(`It costs $${priceOf(ph.pos)}. Mortgage something or sell a building to raise it.`);
      pay(g, seat, BANK, priceOf(ph.pos), "buy", ph.pos);
      s.props[ph.pos]!.owner = seat;
      ownEv(g, ph.pos);
      s.phase = { k: "idle" };
      break;
    }
    case "decline": {
      if (ph.k !== "buy" || !mine) throw new Error("There's nothing to buy.");
      s.phase = { k: "idle" };
      if (s.rules.auctions) s.todo.unshift({ k: "auction", pos: ph.pos });
      break;
    }
    case "bid": {
      if (ph.k !== "auction" || !ph.in.includes(seat)) throw new Error("You're not in this auction.");
      if (!Number.isInteger(a.amount) || a.amount <= ph.high) throw new Error(`Bid more than $${ph.high}.`);
      if (a.amount > p.cash) throw new Error(`You only have $${p.cash}.`);
      ph.high = a.amount;
      ph.leader = seat;
      emit(g, { t: "bid", seat, amount: a.amount });
      settle(g);
      break;
    }
    case "fold": {
      if (ph.k !== "auction" || !ph.in.includes(seat)) throw new Error("You're not in this auction.");
      if (ph.leader === seat) throw new Error("You're the top bid.");
      ph.in = ph.in.filter((x) => x !== seat);
      emit(g, { t: "fold", seat });
      settle(g);
      break;
    }
    case "bus": {
      if (ph.k !== "bus" || !mine) throw new Error("There's no bus to take.");
      const [d1, d2] = ph.dice;
      const n = a.choice === 0 ? d1 : a.choice === 1 ? d2 : d1 + d2;
      s.phase = { k: "idle" };
      // A utility counts both white dice whichever you moved by (the bus is worth 0).
      s.todo = [{ k: "walk", n }, { k: "land", dice: d1 + d2 }, { k: "after" }];
      break;
    }
    case "pick": {
      if (ph.k !== "pick" || !mine) throw new Error("There's nowhere to pick.");
      if (!Number.isInteger(a.pos) || a.pos < 0 || a.pos >= SIZE) throw new Error("Pick a square on the board.");
      s.phase = { k: "idle" };
      const d = s.dice ?? [0];
      s.todo = [...(a.pos === p.pos ? [] : [{ k: "walk", n: (a.pos - p.pos + SIZE) % SIZE } as Step]), { k: "land", dice: d.reduce((x, y) => x + y, 0) }, { k: "after" }];
      break;
    }
    case "pay": {
      if (ph.k !== "debt" || ph.from !== seat) throw new Error("You don't owe anything.");
      if (p.cash < ph.amount) throw new Error(`You need $${ph.amount - p.cash} more.`);
      break;
    }
    case "bankrupt": {
      if (ph.k !== "debt" || ph.from !== seat) throw new Error("You don't owe anything.");
      if (p.cash + raisable(s, seat) >= ph.amount) throw new Error("You can still raise this: sell buildings or mortgage.");
      s.phase = { k: "idle" };
      bankrupt(g, seat, ph.to);
      break;
    }
    case "resign": {
      if (ph.k === "debt" && ph.from === seat) {
        s.phase = { k: "idle" };
        bankrupt(g, seat, ph.to);
      } else bankrupt(g, seat, BANK);
      break;
    }
    case "build": {
      const why = cantBuild(s, seat, a.pos);
      if (why) throw new Error(why);
      const prop = s.props[a.pos]!;
      const top = hotelAt(s.rules);
      pay(g, seat, BANK, houseCostOf(a.pos), "build", a.pos);
      if (prop.houses === top) {
        prop.houses = 5;
        if (s.rules.limited) {
          s.bank.hotels--;
          s.bank.houses += top;
        }
      } else {
        prop.houses++;
        if (s.rules.limited) s.bank.houses--;
      }
      emit(g, { t: "build", pos: a.pos, houses: prop.houses, bank: { ...s.bank } });
      break;
    }
    case "sell": {
      const why = cantSell(s, seat, a.pos);
      if (why) throw new Error(why);
      const prop = s.props[a.pos]!;
      const top = hotelAt(s.rules);
      pay(g, BANK, seat, houseCostOf(a.pos) / 2, "sell", a.pos);
      if (prop.houses === 5) {
        prop.houses = top;
        if (s.rules.limited) {
          s.bank.hotels++;
          s.bank.houses -= top;
        }
      } else {
        prop.houses--;
        if (s.rules.limited) s.bank.houses++;
      }
      emit(g, { t: "build", pos: a.pos, houses: prop.houses, bank: { ...s.bank } });
      break;
    }
    case "sellAll": {
      const prop = s.props[a.pos];
      if (!prop || prop.owner !== seat) throw new Error("That isn't yours.");
      if (!buildingsIn(s, a.pos)) throw new Error("There's nothing built in this group.");
      sellGroup(g, seat, a.pos);
      break;
    }
    case "mortgage": {
      const why = cantMortgage(s, seat, a.pos);
      if (why) throw new Error(why);
      s.props[a.pos]!.mortgaged = true;
      pay(g, BANK, seat, mortgageOf(a.pos), "mortgage", a.pos);
      ownEv(g, a.pos);
      break;
    }
    case "unmortgage": {
      const why = cantUnmortgage(s, seat, a.pos);
      if (why) throw new Error(why);
      s.props[a.pos]!.mortgaged = false;
      pay(g, seat, BANK, unmortgageOf(a.pos), "unmortgage", a.pos);
      ownEv(g, a.pos);
      break;
    }
    case "offer": {
      const t = { from: seat, to: a.to, give: cleanSide(a.give), get: cleanSide(a.get) };
      const why = cantTrade(s, t);
      if (why) throw new Error(why);
      const lift = (a.lift ?? []).filter((pos) => t.get.props.includes(pos));
      const trade: Trade = { id: ++s.tradeSeq, ...t, ...(lift.length ? { lift } : {}) };
      s.trades.push(trade);
      emit(g, { t: "offer", trade });
      break;
    }
    case "accept": {
      const trade = s.trades.find((t) => t.id === a.id);
      if (!trade || trade.to !== seat) throw new Error("That offer's gone.");
      const lifts = [(a.lift ?? []).filter((pos) => trade.give.props.includes(pos)), trade.lift ?? []];
      const why = cantAccept(s, trade, lifts[0]);
      if (why) throw new Error(why);
      const owe = [feesOn(s, trade.give.props, lifts[0]), feesOn(s, trade.get.props, lifts[1])];
      s.trades = s.trades.filter((t) => t.id !== trade.id);
      swap(g, trade.from, trade.to, trade.give);
      swap(g, trade.to, trade.from, trade.get);
      emit(g, { t: "traded", trade });
      for (const [seat, fee, lift] of [[trade.to, owe[0], lifts[0]], [trade.from, owe[1], lifts[1]]] as const) {
        if (fee.interest) pay(g, seat, BANK, fee.interest, "interest");
        for (const pos of lift) {
          if (!s.props[pos]!.mortgaged) continue;
          s.props[pos]!.mortgaged = false;
          pay(g, seat, BANK, unmortgageOf(pos), "unmortgage", pos);
          ownEv(g, pos);
        }
      }
      break;
    }
    case "reject":
    case "withdraw": {
      const trade = s.trades.find((t) => t.id === a.id);
      if (!trade || (a.k === "reject" ? trade.to : trade.from) !== seat) throw new Error("That offer's gone.");
      s.trades = s.trades.filter((t) => t.id !== trade.id);
      emit(g, { t: "untrade", trade, by: seat, why: a.k });
      break;
    }
  }
  // Raising enough to cover a debt pays it straight away.
  const debt = s.phase;
  if (debt.k === "debt" && s.players[debt.from].cash >= debt.amount) {
    s.phase = { k: "idle" };
    pay(g, debt.from, debt.to, debt.amount, debt.why);
  }
  run(g, rng);
  prune(g);
  return g;
}

const cleanSide = (side: Side): Side => ({ cash: Math.max(0, Math.floor(side.cash || 0)), props: [...(side.props ?? [])], free: [...(side.free ?? [])] });

function swap(g: Game, from: number, to: number, side: Side) {
  const s = g.s;
  if (side.cash) pay(g, from, to, side.cash, "trade");
  for (const pos of side.props) {
    s.props[pos]!.owner = to;
    ownEv(g, pos);
  }
  for (const d of side.free) {
    s.players[from].free.splice(s.players[from].free.indexOf(d), 1);
    s.players[to].free.push(d);
  }
}

// Offers that can't happen any more (a property changed hands, someone went out) are dropped.
function prune(g: Game) {
  const s = g.s;
  for (const t of [...s.trades]) {
    // Short of cash is only for now; they can raise it before it's accepted.
    const why = cantTrade(s, t);
    if (!why || why === SHORT) continue;
    s.trades = s.trades.filter((x) => x.id !== t.id);
    emit(g, { t: "untrade", trade: t, by: -1, why: "stale" });
  }
}

// --- The turn ---

function emit(g: Game, e: Ev) {
  g.events.push(e);
  g.s.seq++;
}

function ownEv(g: Game, pos: number) {
  const prop = g.s.props[pos]!;
  emit(g, { t: "own", pos, owner: prop.owner, mortgaged: prop.mortgaged, houses: prop.houses });
}

// Moves money now. Callers make sure the payer has it.
function pay(g: Game, from: number, to: number, amount: number, why: Why, pos?: number) {
  const s = g.s;
  if (amount <= 0) return;
  if (from >= 0) s.players[from].cash -= amount;
  else if (from === POT) s.pot -= amount;
  if (to >= 0) s.players[to].cash += amount;
  else if (to === POT) s.pot += amount;
  emit(g, { t: "pay", from, to, amount, why, ...(pos === undefined ? {} : { pos }), cash: s.players.map((p) => p.cash), pot: s.pot });
}

function roll(g: Game, rng: Rng) {
  const s = g.s;
  const seat = s.current;
  const p = s.players[seat];
  const d1 = die(rng);
  const d2 = die(rng);
  if (p.jail >= 0) {
    s.dice = [d1, d2];
    emit(g, { t: "roll", seat, dice: [d1, d2], jail: true });
    s.again = false;
    if (d1 === d2) {
      p.jail = -1;
      emit(g, { t: "jail", seat, in: false, how: "doubles" });
      s.todo = [{ k: "walk", n: d1 + d2 }, { k: "land", dice: d1 + d2 }, { k: "after" }];
    } else if (++p.jail >= 3) {
      // The third miss: pay the fine and move anyway.
      p.jail = -1;
      emit(g, { t: "jail", seat, in: false, how: "third" });
      s.todo = [{ k: "pay", from: seat, to: fineTo(s), amount: JAIL_FINE, why: "jail" }, { k: "walk", n: d1 + d2 }, { k: "land", dice: d1 + d2 }, { k: "after" }];
    } else s.todo = [{ k: "after" }];
    s.phase = { k: "idle" };
    return;
  }
  const speed = s.rules.speed && p.lapped ? die(rng) : 0;
  s.dice = speed ? [d1, d2, speed] : [d1, d2];
  emit(g, { t: "roll", seat, dice: [d1, d2], ...(speed ? { speed } : {}) });
  const doubles = d1 === d2;
  const num = speed >= 1 && speed <= 3 ? speed : 0;
  s.phase = { k: "idle" };
  if (num && doubles && d1 === num) {
    // Triples: anywhere on the board, and the turn ends there.
    s.again = false;
    s.phase = { k: "pick" };
    return;
  }
  if (doubles && ++s.doubles === 3) {
    toJail(g, seat, "three");
    s.todo = [{ k: "after" }];
    return;
  }
  s.again = doubles;
  if (speed === 6) {
    s.phase = { k: "bus", dice: [d1, d2] };
    return;
  }
  const n = d1 + d2 + num;
  s.todo = [{ k: "walk", n }, { k: "land", dice: n }, ...(speed === 4 || speed === 5 ? [{ k: "mrm" } as Step] : []), { k: "after" }];
}

function toJail(g: Game, seat: number, how?: "three") {
  const s = g.s;
  const p = s.players[seat];
  emit(g, { t: "move", seat, from: p.pos, to: JAIL, how: "jail" });
  p.pos = JAIL;
  p.jail = 0;
  emit(g, { t: "jail", seat, in: true, ...(how ? { how } : {}) });
  if (seat === s.current) {
    s.again = false;
    s.doubles = 0;
  }
}

// Forward to `to`, collecting a salary for passing or landing on Start.
function advance(g: Game, seat: number, to: number, how: "walk" | "jump" = "walk") {
  const s = g.s;
  const p = s.players[seat];
  const from = p.pos;
  emit(g, { t: "move", seat, from, to, how });
  p.pos = to;
  if (to < from || (to === 0 && from !== 0)) {
    p.lapped = true;
    pay(g, BANK, seat, to === 0 && s.rules.goDouble ? GO_SALARY * 2 : GO_SALARY, "go");
  }
}

function run(g: Game, rng: Rng) {
  const s = g.s;
  for (let guard = 0; s.phase.k === "idle" && guard < 500; guard++) {
    const step = s.todo.shift() ?? ({ k: "next" } as Step);
    exec(g, step, rng);
  }
}

function exec(g: Game, step: Step, rng: Rng) {
  const s = g.s;
  const seat = s.current;
  const p = s.players[seat];
  switch (step.k) {
    case "walk":
      if (!p.out) advance(g, seat, (p.pos + step.n) % SIZE);
      return;
    case "land":
      if (!p.out) land(g, step, rng);
      return;
    case "mrm":
      // Sent to jail on the way: the turn's over, the speed die with it.
      if (!p.out && p.jail < 0) mrMonopoly(g);
      return;
    case "pay": {
      if (s.players[step.from]?.out) return;
      const to = step.to >= 0 && s.players[step.to].out ? BANK : step.to;
      if (s.players[step.from].cash >= step.amount) pay(g, step.from, to, step.amount, step.why);
      else {
        s.phase = { k: "debt", from: step.from, to, amount: step.amount, why: step.why };
        emit(g, { t: "debt", seat: step.from, to, amount: step.amount, why: step.why });
      }
      return;
    }
    case "auction": {
      if (s.props[step.pos]!.owner >= 0) return;
      const order = [...alive(s).filter((x) => x >= seat), ...alive(s).filter((x) => x < seat)];
      s.phase = { k: "auction", pos: step.pos, high: 0, leader: -1, in: order };
      emit(g, { t: "auction", pos: step.pos, in: order });
      settle(g);
      return;
    }
    case "resume":
      if (p.out) exec(g, { k: "next" }, rng);
      else s.phase = { k: "roll" };
      return;
    case "after":
      if (!p.out && s.again && p.jail < 0) {
        s.again = false;
        s.phase = { k: "roll" };
        emit(g, { t: "turn", seat, again: true });
      } else exec(g, { k: "next" }, rng);
      return;
    case "next": {
      s.doubles = 0;
      s.again = false;
      s.todo = [];
      const left = alive(s);
      if (left.length < 2) return over(g);
      const next = left.find((x) => x > seat) ?? left[0];
      if (next <= seat) s.round++;
      if (s.rules.rounds > 0 && s.round > s.rules.rounds) return over(g);
      s.current = next;
      s.phase = { k: "roll" };
      emit(g, { t: "turn", seat: next });
      return;
    }
  }
}

function over(g: Game) {
  g.s.phase = { k: "over" };
  g.s.todo = [];
  emit(g, { t: "over" });
}

function land(g: Game, step: Extract<Step, { k: "land" }>, rng: Rng) {
  const s = g.s;
  const seat = s.current;
  const p = s.players[seat];
  const pos = p.pos;
  const sq = BOARD[pos];
  switch (sq.kind) {
    case "parking":
      if (s.rules.pot && s.pot > 0) {
        pay(g, POT, seat, s.pot, "pot");
        if (s.rules.pot === 2) pay(g, BANK, POT, 500, "seed");
      }
      return;
    case "gotojail":
      toJail(g, seat);
      return;
    case "tax":
      s.todo.unshift({ k: "pay", from: seat, to: fineTo(s), amount: sq.amount, why: "tax" });
      return;
    case "chance":
    case "chest":
      draw(g, sq.kind, rng);
      return;
    case "street":
    case "rail":
    case "util": {
      const prop = s.props[pos]!;
      if (prop.owner < 0) {
        if (!s.rules.firstLap || p.lapped) s.phase = { k: "buy", pos };
        return;
      }
      if (prop.owner === seat || prop.mortgaged) return;
      if (!s.rules.jailRent && s.players[prop.owner].jail >= 0) return;
      let dice = step.dice;
      if (step.mod === "util10") {
        const d = [die(rng), die(rng)];
        emit(g, { t: "roll", seat, dice: d, util: true });
        dice = d[0] + d[1];
      }
      s.todo.unshift({ k: "pay", from: seat, to: prop.owner, amount: rentOf(s, pos, dice, step.mod), why: "rent" });
      return;
    }
  }
}

function draw(g: Game, deck: Deck, rng: Rng) {
  const s = g.s;
  const seat = s.current;
  const p = s.players[seat];
  const id = g.decks[deck].shift()!;
  emit(g, { t: "card", seat, deck, card: id });
  const e = DECKS[deck][id].effect;
  if (e.k === "free") p.free.push(deck);
  else g.decks[deck].push(id);
  const fine = fineTo(s);
  switch (e.k) {
    case "advance":
      advance(g, seat, e.to, "jump");
      s.todo.unshift({ k: "land", dice: 0 });
      return;
    case "nearest": {
      let to = p.pos;
      do to = (to + 1) % SIZE;
      while (BOARD[to].kind !== e.kind);
      advance(g, seat, to, "jump");
      s.todo.unshift({ k: "land", dice: 0, mod: e.kind === "rail" ? "rail2" : "util10" });
      return;
    }
    case "back": {
      const to = (p.pos - e.n + SIZE) % SIZE;
      emit(g, { t: "move", seat, from: p.pos, to, how: "back" });
      p.pos = to;
      s.todo.unshift({ k: "land", dice: s.dice ? s.dice[0] + s.dice[1] : 0 });
      return;
    }
    case "collect":
      pay(g, BANK, seat, e.amount, "card");
      return;
    case "pay":
      s.todo.unshift({ k: "pay", from: seat, to: fine, amount: e.amount, why: "card" });
      return;
    case "jail":
      toJail(g, seat);
      return;
    case "free":
      return;
    case "repairs": {
      let amount = 0;
      for (const i of owned(s, seat)) {
        const h = s.props[i]!.houses;
        amount += h === 5 ? e.hotel : h * e.house;
      }
      if (amount) s.todo.unshift({ k: "pay", from: seat, to: fine, amount, why: "card" });
      return;
    }
    case "payEach":
      s.todo.unshift(...alive(s).filter((x) => x !== seat).map((x): Step => ({ k: "pay", from: seat, to: x, amount: e.amount, why: "card" })));
      return;
    case "collectEach":
      s.todo.unshift(...alive(s).filter((x) => x !== seat).map((x): Step => ({ k: "pay", from: x, to: seat, amount: e.amount, why: "card" })));
      return;
  }
}

// The speed die's Mr. Monopoly: on to the next property nobody owns, or with none left, the next one where
// you owe someone rent.
function mrMonopoly(g: Game) {
  const s = g.s;
  const seat = s.current;
  const from = s.players[seat].pos;
  const ahead = Array.from({ length: SIZE - 1 }, (_, k) => (from + 1 + k) % SIZE).filter((i) => isBuyable(BOARD[i]));
  const to =
    ahead.find((i) => s.props[i]!.owner < 0) ??
    ahead.find((i) => {
      const prop = s.props[i]!;
      return prop.owner >= 0 && prop.owner !== seat && !prop.mortgaged;
    });
  if (to === undefined) return;
  advance(g, seat, to, "jump");
  s.todo.unshift({ k: "land", dice: s.dice ? s.dice[0] + s.dice[1] : 0 });
}

// An auction ends when everyone but the top bid has dropped out, or everyone has without a bid.
function settle(g: Game) {
  const s = g.s;
  const ph = s.phase;
  if (ph.k !== "auction") return;
  if (ph.leader >= 0 && ph.in.length === 1) {
    pay(g, ph.leader, BANK, ph.high, "auction", ph.pos);
    s.props[ph.pos]!.owner = ph.leader;
    emit(g, { t: "sold", pos: ph.pos, seat: ph.leader, amount: ph.high });
    ownEv(g, ph.pos);
    s.phase = { k: "idle" };
  } else if (ph.in.length === 0) {
    emit(g, { t: "unsold", pos: ph.pos });
    s.phase = { k: "idle" };
  }
}

// Every building in a group back to the bank at half what it cost.
function sellGroup(g: Game, seat: number, pos: number) {
  const s = g.s;
  const top = hotelAt(s.rules);
  for (const i of groupOf(pos)) {
    const prop = s.props[i]!;
    if (prop.houses === 0) continue;
    const n = prop.houses === 5 ? top + 1 : prop.houses;
    pay(g, BANK, seat, (n * houseCostOf(i)) / 2, "sell", i);
    if (s.rules.limited) {
      if (prop.houses === 5) s.bank.hotels++;
      else s.bank.houses += prop.houses;
    }
    prop.houses = 0;
    emit(g, { t: "build", pos: i, houses: 0, bank: { ...s.bank } });
  }
}

// Steps that have to happen now, whatever the game was waiting on: straight away mid-turn, before the next
// roll between turns, or once the decision being waited on is made.
function interject(s: MonoState, steps: Step[]) {
  if (!steps.length) return;
  if (s.phase.k === "idle") s.todo.unshift(...steps);
  else if (s.phase.k === "roll") {
    s.todo = [...steps, { k: "resume" }];
    s.phase = { k: "idle" };
  } else {
    const at = s.todo.findIndex((st) => st.k === "after" || st.k === "next");
    s.todo.splice(at < 0 ? s.todo.length : at, 0, ...steps);
  }
}

// Out of the game, owing `to`. Buildings go back to the bank at half. A player creditor gets the rest (and pays
// 10% on what's mortgaged); the bank auctions the properties off clear of mortgage.
function bankrupt(g: Game, seat: number, to: number) {
  const s = g.s;
  const p = s.players[seat];
  const props = owned(s, seat);
  for (const i of props) if (s.props[i]!.houses > 0) sellGroup(g, seat, i);
  const creditor = to >= 0 && !s.players[to].out ? to : BANK;
  if (p.cash > 0) pay(g, seat, creditor === BANK && to === POT ? POT : creditor, p.cash, "bankrupt");
  p.out = true;
  s.out.push(seat);
  emit(g, { t: "out", seat, to: creditor });
  if (creditor >= 0) {
    for (const i of props) {
      s.props[i]!.owner = creditor;
      ownEv(g, i);
    }
    s.players[creditor].free.push(...p.free);
    const fee = interestOn(s, props);
    if (fee) s.todo.unshift({ k: "pay", from: creditor, to: BANK, amount: fee, why: "interest" });
  } else {
    for (const i of props) {
      s.props[i] = { owner: -1, houses: 0, mortgaged: false };
      ownEv(g, i);
    }
    for (const d of p.free) g.decks[d].push(FREE_CARD[d]);
    if (s.rules.auctions) interject(s, props.map((pos): Step => ({ k: "auction", pos })));
  }
  p.free = [];
  s.todo = s.todo.filter((st) => !(st.k === "pay" && st.from === seat));
  s.trades = s.trades.filter((t) => t.from !== seat && t.to !== seat);
  const ph = s.phase;
  if (ph.k === "auction" && ph.in.includes(seat)) {
    ph.in = ph.in.filter((x) => x !== seat);
    if (ph.leader === seat) {
      ph.leader = -1;
      ph.high = 0;
    }
    settle(g);
  }
  if (ph.k === "debt" && ph.to === seat) ph.to = BANK;
  if (ph.k === "debt" && ph.from === seat) s.phase = { k: "idle" };
  if (seat === s.current && (ph.k === "roll" || ph.k === "buy" || ph.k === "bus" || ph.k === "pick")) s.phase = { k: "idle" };
  if (seat === s.current && !s.todo.some((st) => st.k === "after" || st.k === "next")) s.todo.push({ k: "next" });
  if (alive(s).length < 2 || (s.rules.short && s.out.length >= 2)) over(g);
}
