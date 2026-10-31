// Poker's rules as plain functions on plain data, shared by the server and phones. No Convex or browser
// imports. The server keeps the deck, the muck and everyone's cards in `secrets` and the rest (stacks, bets,
// the board, the last hand's showdown) in matches.state, which everyone can read.
//
// A game is a run of hands. Everyone starts with the same stack; the blinds double on a schedule; a player
// who runs out of chips is out. It ends when one player has everything, or after the last hand, placing by
// chips (and the knocked-out by how long they lasted).

import { bestHand, shuffle, type Card, type Variant } from "./cards";

export type { Card, Variant } from "./cards";
export type Limit = "nl" | "pl";

type Street = { kind: "bet" | "draw"; deal: number; name: string };
const BOARD: Street[] = [
  { kind: "bet", deal: 0, name: "Pre-flop" },
  { kind: "bet", deal: 3, name: "Flop" },
  { kind: "bet", deal: 1, name: "Turn" },
  { kind: "bet", deal: 1, name: "River" },
];
const DRAW: Street[] = [
  { kind: "bet", deal: 0, name: "First bet" },
  { kind: "draw", deal: 0, name: "Draw" },
  { kind: "bet", deal: 0, name: "Last bet" },
];
export const VARIANTS: Record<Variant, { hole: number; short: boolean; streets: Street[] }> = {
  holdem: { hole: 2, short: false, streets: BOARD },
  omaha: { hole: 4, short: false, streets: BOARD },
  short: { hole: 2, short: true, streets: BOARD },
  draw: { hole: 5, short: false, streets: DRAW },
};

export type LogKind = "blind" | "fold" | "check" | "call" | "bet" | "raise" | "draw";
// `amount`: chips put in for a blind or call, the total bet for a bet or raise, cards swapped for a draw.
// `auto`: the move timer ran out and the game moved for them.
export type LogEntry = { seat: number; kind: LogKind; amount?: number; allIn?: boolean; street: number; auto?: boolean };

export type Pot = { amount: number; eligible: number[]; winners: number[] };
// How a hand ended. `shown` and `names` are per seat, set for everyone who got to the showdown. `won` is
// what each seat took from the pot, `net` that minus what they put in.
export type HandResult = {
  hand: number;
  board: Card[];
  pots: Pot[];
  shown: (Card[] | null)[];
  names: (string | null)[];
  won: number[];
  net: number[];
  showdown: boolean;
};
// Someone leaving the game, in order. `stack` is what they had when the hand began (a bust) or when they left
// (a resignation), to place players knocked out in the same hand.
export type Exit = { seat: number; hand: number; reason: "bust" | "resign"; stack: number };

export type PokerState = {
  kind: "poker";
  variant: Variant;
  limit: Limit;
  hand: number;
  button: number;
  sb: number;
  bb: number;
  // Stacks when this hand was dealt.
  start: number[];
  stacks: number[];
  // Chips in front of each seat on this street, and in the pot from each seat this hand (bets included).
  bets: number[];
  paid: number[];
  dealt: boolean[];
  folded: boolean[];
  // The bet each seat last acted at on this street; null until they act. A raise reopens the action to a
  // seat only if it's a full raise over that.
  acted: (number | null)[];
  current: number;
  minRaise: number;
  street: number;
  board: Card[];
  // The seat to act, or -1 once the hand is over.
  turn: number;
  // Draw poker: how many cards each seat swapped.
  drew: (number | null)[];
  // Moves in a row the game made for each seat because their timer ran out (see convex/poker.ts).
  idle: number[];
  log: LogEntry[];
  last: HandResult | null;
  out: Exit[];
};

export type Hidden = { deck: Card[]; muck: Card[]; holes: Card[][] };
export type Table = { state: PokerState; hidden: Hidden };
export type Action = { kind: "fold" } | { kind: "check" } | { kind: "call" } | { kind: "raise"; to: number } | { kind: "draw"; discard: number[] };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const seatsOf = (s: PokerState) => s.stacks.map((_, i) => i);

export const isOut = (s: PokerState, seat: number) => s.out.some((o) => o.seat === seat);
// Still in the game with chips, between hands.
export const alive = (s: PokerState) => seatsOf(s).filter((i) => !isOut(s, i) && s.stacks[i] > 0);
export const inHand = (s: PokerState, seat: number) => s.dealt[seat] && !s.folded[seat];
export const toCall = (s: PokerState, seat: number) => Math.max(0, s.current - s.bets[seat]);
export const streetOf = (s: PokerState) => VARIANTS[s.variant].streets[s.street];
// The pot already gathered in the middle, not counting this street's bets.
export const potOf = (s: PokerState) => sum(s.paid) - sum(s.bets);
const canAct = (s: PokerState, seat: number) => inHand(s, seat) && s.stacks[seat] > 0;

// Blinds start at 1% and 2% of a starting stack and double every `every` hands (0: never).
export function blindsFor(stack: number, hand: number, every: number) {
  const level = every > 0 ? Math.floor((hand - 1) / every) : 0;
  const sb = Math.max(1, Math.round(stack / 100)) * 2 ** level;
  return { sb, bb: sb * 2 };
}

export function newGame(variant: Variant, limit: Limit, players: number, stack: number): PokerState {
  const zeros = Array.from({ length: players }, () => 0);
  return {
    kind: "poker",
    variant,
    limit,
    hand: 0,
    button: -1,
    sb: 0,
    bb: 0,
    start: zeros.map(() => stack),
    stacks: zeros.map(() => stack),
    bets: [...zeros],
    paid: [...zeros],
    dealt: zeros.map(() => false),
    folded: zeros.map(() => true),
    acted: zeros.map(() => null),
    current: 0,
    minRaise: 0,
    street: 0,
    board: [],
    turn: -1,
    drew: zeros.map(() => null),
    idle: [...zeros],
    log: [],
    last: null,
    out: [],
  };
}

function nextOf(s: PokerState, from: number, ok: (seat: number) => boolean) {
  const n = s.stacks.length;
  for (let i = 1; i <= n; i++) {
    const seat = (((from + i) % n) + n) % n;
    if (ok(seat)) return seat;
  }
  return -1;
}

function pay(s: PokerState, seat: number, amount: number) {
  const x = Math.max(0, Math.min(amount, s.stacks[seat]));
  s.stacks[seat] -= x;
  s.bets[seat] += x;
  s.paid[seat] += x;
  return x;
}

// Cards off the top of the deck. Draw poker can run it dry; then the muck is shuffled back in.
function take(t: Table, k: number, random: () => number) {
  if (t.hidden.deck.length < k) {
    t.hidden.deck.push(...shuffle(t.hidden.muck, random));
    t.hidden.muck = [];
  }
  return t.hidden.deck.splice(0, k);
}

// Deals the next hand from a shuffled deck: moves the button, posts the blinds, deals everyone in.
export function deal(state: PokerState, blinds: { sb: number; bb: number }, deck: Card[], random: () => number = Math.random): Table {
  const s = clone(state);
  const live = alive(s);
  if (live.length < 2) throw new Error("Not enough players left to deal.");
  const n = s.stacks.length;
  s.hand += 1;
  s.button = s.hand === 1 || s.button < 0 ? live[0] : nextOf(s, s.button, (i) => live.includes(i));
  s.sb = blinds.sb;
  s.bb = blinds.bb;
  s.start = [...s.stacks];
  s.bets = Array.from({ length: n }, () => 0);
  s.paid = Array.from({ length: n }, () => 0);
  s.dealt = seatsOf(s).map((i) => live.includes(i));
  s.folded = seatsOf(s).map((i) => !live.includes(i));
  s.acted = Array.from({ length: n }, () => null);
  s.drew = Array.from({ length: n }, () => null);
  s.board = [];
  s.street = 0;
  s.log = [];
  s.current = blinds.bb;
  s.minRaise = blinds.bb;
  s.turn = -1;
  const t: Table = { state: s, hidden: { deck: [...deck], muck: [], holes: seatsOf(s).map(() => []) } };
  // Heads-up the button is the small blind and acts first before the flop.
  const sbSeat = live.length === 2 ? s.button : nextOf(s, s.button, (i) => live.includes(i));
  const bbSeat = nextOf(s, sbSeat, (i) => live.includes(i));
  for (const [seat, amount] of [[sbSeat, blinds.sb], [bbSeat, blinds.bb]]) {
    const put = pay(s, seat, amount);
    s.log.push({ seat, kind: "blind", amount: put, street: 0, ...(s.stacks[seat] === 0 ? { allIn: true } : {}) });
  }
  const hole = VARIANTS[s.variant].hole;
  for (let k = 1; k <= n; k++) {
    const seat = (s.button + k) % n;
    if (s.dealt[seat]) t.hidden.holes[seat] = take(t, hole, random);
  }
  return settle(t, bbSeat, random);
}

// Whether a seat still has to act on this street.
function needs(s: PokerState, seat: number) {
  if (!inHand(s, seat)) return false;
  if (streetOf(s).kind === "draw") return s.acted[seat] === null;
  if (s.stacks[seat] === 0) return false;
  // Everyone else still in is all-in: only a bet bigger than yours needs an answer (a big blind all-in for
  // less than the small blind doesn't).
  const others = seatsOf(s).filter((i) => i !== seat && inHand(s, i));
  if (!others.some((i) => s.stacks[i] > 0)) return s.bets[seat] < Math.max(0, ...others.map((i) => s.bets[i]));
  if (s.bets[seat] < s.current) return true;
  // Nobody left to bet against: everyone else is all-in.
  return s.acted[seat] === null && seatsOf(s).filter((i) => canAct(s, i)).length > 1;
}

// After anything changes: the hand is won, the next seat acts, or the street is done.
function settle(t: Table, from: number, random: () => number): Table {
  const s = t.state;
  if (seatsOf(s).filter((i) => inHand(s, i)).length === 1) return award(t);
  const next = nextOf(s, from, (i) => needs(s, i));
  if (next >= 0) {
    s.turn = next;
    return t;
  }
  return nextStreet(t, random);
}

// Gathers the bets and deals the next street. If nobody can bet any more (everyone all-in), it runs the
// board out to the showdown.
function nextStreet(t: Table, random: () => number): Table {
  const s = t.state;
  const streets = VARIANTS[s.variant].streets;
  for (;;) {
    s.bets = s.bets.map(() => 0);
    s.acted = s.acted.map(() => null);
    s.current = 0;
    s.minRaise = s.bb;
    s.street += 1;
    if (s.street >= streets.length) return showdown(t);
    const street = streets[s.street];
    if (street.deal) s.board.push(...take(t, street.deal, random));
    const first = nextOf(s, s.button, (i) => needs(s, i));
    if (first >= 0) {
      s.turn = first;
      return t;
    }
  }
}

// The smallest and largest a seat may raise to, or null if it can only call or fold. A raise must be at
// least the last raise again, except all-in; pot limit caps it at the pot after calling.
export function raiseBounds(s: PokerState, seat: number): { min: number; max: number } | null {
  if (s.turn !== seat || streetOf(s).kind !== "bet") return null;
  const owe = toCall(s, seat);
  const allIn = s.bets[seat] + s.stacks[seat];
  if (s.stacks[seat] <= owe) return null;
  if (!seatsOf(s).some((i) => i !== seat && canAct(s, i))) return null;
  const acted = s.acted[seat];
  if (acted !== null && s.current - acted < s.minRaise) return null;
  let max = allIn;
  if (s.limit === "pl") max = Math.min(max, s.current + sum(s.paid) + owe);
  const min = Math.min(s.current + s.minRaise, allIn);
  return { min, max: Math.max(min, max) };
}

export function act(table: Table, seat: number, action: Action, random: () => number = Math.random, auto = false): Table {
  const t = clone(table);
  const s = t.state;
  if (s.turn !== seat) throw new Error("It's not your turn.");
  const street = streetOf(s);
  const mark = auto ? { auto: true } : {};
  s.idle = s.stacks.map((_, i) => (i === seat ? (auto ? (s.idle?.[i] ?? 0) + 1 : 0) : (s.idle?.[i] ?? 0)));
  if (street.kind === "draw") {
    if (action.kind !== "draw") throw new Error("Pick the cards to swap first.");
    const hole = t.hidden.holes[seat];
    const picks = [...new Set(action.discard)].filter((i) => Number.isInteger(i) && i >= 0 && i < hole.length);
    // New cards come off the deck before the old ones hit the muck, so you never draw your own back.
    const fresh = take(t, picks.length, random);
    const thrown = picks.map((i) => hole[i]);
    picks.forEach((i, k) => (hole[i] = fresh[k]));
    t.hidden.muck.push(...thrown);
    s.drew[seat] = picks.length;
    s.acted[seat] = 0;
    s.log.push({ seat, kind: "draw", amount: picks.length, street: s.street, ...mark });
    return settle(t, seat, random);
  }
  const owe = toCall(s, seat);
  if (action.kind === "draw") throw new Error("It's a betting round.");
  if (action.kind === "fold") {
    s.folded[seat] = true;
    t.hidden.muck.push(...t.hidden.holes[seat]);
    s.log.push({ seat, kind: "fold", street: s.street, ...mark });
  } else if (action.kind === "check") {
    if (owe > 0) throw new Error(`It's ${owe} to call.`);
    s.acted[seat] = s.current;
    s.log.push({ seat, kind: "check", street: s.street, ...mark });
  } else if (action.kind === "call") {
    if (owe === 0) throw new Error("There's nothing to call.");
    const put = pay(s, seat, owe);
    s.acted[seat] = s.current;
    s.log.push({ seat, kind: "call", amount: put, street: s.street, ...(s.stacks[seat] === 0 ? { allIn: true } : {}) });
  } else {
    const b = raiseBounds(s, seat);
    if (!b) throw new Error("You can't raise here.");
    const to = Math.floor(action.to);
    if (!(to >= b.min && to <= b.max)) throw new Error(b.min === b.max ? `You can only raise to ${b.min}.` : `Raise to between ${b.min} and ${b.max}.`);
    const bet = s.current === 0;
    const size = to - s.current;
    pay(s, seat, to - s.bets[seat]);
    if (size >= s.minRaise) s.minRaise = size;
    s.current = to;
    s.acted[seat] = to;
    s.log.push({ seat, kind: bet ? "bet" : "raise", amount: to, street: s.street, ...(s.stacks[seat] === 0 ? { allIn: true } : {}) });
  }
  return settle(t, seat, random);
}

// What the game does for someone whose move timer ran out: check if it's free, otherwise fold; keep every
// card in a draw.
export function autoAction(s: PokerState, seat: number): Action {
  if (streetOf(s).kind === "draw") return { kind: "draw", discard: [] };
  return toCall(s, seat) === 0 ? { kind: "check" } : { kind: "fold" };
}

// A player resigns: they fold if they're in the hand, and their chips leave the table with them.
export function leave(table: Table, seat: number, random: () => number = Math.random): Table {
  const t = clone(table);
  const s = t.state;
  if (isOut(s, seat)) return t;
  const playing = s.turn !== -1 && inHand(s, seat);
  if (playing) {
    s.folded[seat] = true;
    s.log.push({ seat, kind: "fold", street: s.street });
  }
  s.out.push({ seat, hand: s.hand, reason: "resign", stack: s.stacks[seat] });
  s.stacks[seat] = 0;
  if (s.turn === -1) return t;
  // Carry on from whoever's turn it is (them, if it was theirs: they've folded, so it passes on).
  return settle(t, (s.turn + s.stacks.length - 1) % s.stacks.length, random);
}

// Splits the chips put in into a main pot and side pots, each with the seats still in that can win it.
export function sidePots(s: PokerState): { amount: number; eligible: number[] }[] {
  const left = [...s.paid];
  const pots: { amount: number; eligible: number[] }[] = [];
  for (;;) {
    const live = seatsOf(s).filter((i) => inHand(s, i) && left[i] > 0);
    if (!live.length) break;
    const level = Math.min(...live.map((i) => left[i]));
    let amount = 0;
    for (const i of seatsOf(s)) {
      const x = Math.min(left[i], level);
      amount += x;
      left[i] -= x;
    }
    pots.push({ amount, eligible: live });
  }
  // Chips from folded seats above the last level still belong in the pot.
  const dead = sum(left);
  if (dead && pots.length) pots[pots.length - 1].amount += dead;
  return pots;
}

// A bet nobody matched goes back to whoever made it before the pot is shared out.
function refundUncalled(s: PokerState) {
  const order = seatsOf(s).sort((a, b) => s.paid[b] - s.paid[a]);
  const [top, next] = order;
  const extra = s.paid[top] - (next === undefined ? 0 : s.paid[next]);
  // Chips from someone who's folded (a player who resigned mid-bet) stay in the pot.
  if (extra <= 0 || !inHand(s, top)) return;
  s.paid[top] -= extra;
  s.bets[top] = Math.max(0, s.bets[top] - extra);
  s.stacks[top] += extra;
}

// Everyone else folded: the last one in takes it all without showing.
function award(t: Table): Table {
  const s = t.state;
  refundUncalled(s);
  const winner = seatsOf(s).find((i) => inHand(s, i))!;
  const total = sum(s.paid);
  s.stacks[winner] += total;
  return endHand(t, {
    hand: s.hand,
    board: [...s.board],
    pots: [{ amount: total, eligible: [winner], winners: [winner] }],
    shown: s.stacks.map(() => null),
    names: s.stacks.map(() => null),
    won: s.paid.map((_, i) => (i === winner ? total : 0)),
    net: s.paid.map((p, i) => (i === winner ? total : 0) - p),
    showdown: false,
  });
}

function showdown(t: Table): Table {
  const s = t.state;
  refundUncalled(s);
  const n = s.stacks.length;
  const live = seatsOf(s).filter((i) => inHand(s, i));
  const ranks = seatsOf(s).map((i) => (live.includes(i) ? bestHand(s.variant, t.hidden.holes[i], s.board) : null));
  const won = s.stacks.map(() => 0);
  const pots: Pot[] = sidePots(s).map(({ amount, eligible }) => {
    const top = Math.max(...eligible.map((i) => ranks[i]?.score ?? -1));
    const winners = eligible.filter((i) => (ranks[i]?.score ?? -1) === top);
    // Split evenly; odd chips go to the winners closest to the button's left.
    const share = Math.floor(amount / winners.length);
    let odd = amount - share * winners.length;
    for (let k = 1; k <= n; k++) {
      const seat = (s.button + k) % n;
      if (!winners.includes(seat)) continue;
      won[seat] += share + (odd > 0 ? 1 : 0);
      odd--;
    }
    return { amount, eligible, winners };
  });
  for (const i of seatsOf(s)) s.stacks[i] += won[i];
  return endHand(t, {
    hand: s.hand,
    board: [...s.board],
    pots,
    shown: seatsOf(s).map((i) => (live.includes(i) ? [...t.hidden.holes[i]] : null)),
    names: ranks.map((r) => r?.name ?? null),
    won,
    net: s.paid.map((p, i) => won[i] - p),
    showdown: true,
  });
}

function endHand(t: Table, result: HandResult): Table {
  const s = t.state;
  s.last = result;
  s.turn = -1;
  s.bets = s.bets.map(() => 0);
  s.current = 0;
  // Knocked out this hand, the smaller stacks first so they place lower.
  const busted = seatsOf(s)
    .filter((i) => s.dealt[i] && s.stacks[i] === 0 && !isOut(s, i))
    .sort((a, b) => s.start[a] - s.start[b]);
  for (const seat of busted) s.out.push({ seat, hand: s.hand, reason: "bust", stack: s.start[seat] });
  return t;
}

// Places, best first, ties sharing a place: everyone still in by chips, then everyone out, the last to go
// first. Two knocked out in the same hand with the same stack tie.
export function standings(s: PokerState): number[][] {
  const groups: number[][] = [];
  const left = seatsOf(s)
    .filter((i) => !isOut(s, i))
    .sort((a, b) => s.stacks[b] - s.stacks[a]);
  for (const seat of left) {
    const g = groups.at(-1);
    if (g && s.stacks[g[0]] === s.stacks[seat]) g.push(seat);
    else groups.push([seat]);
  }
  let prev: Exit | null = null;
  for (const e of [...s.out].reverse()) {
    if (prev && prev.reason === "bust" && e.reason === "bust" && prev.hand === e.hand && prev.stack === e.stack) groups.at(-1)!.push(e.seat);
    else groups.push([e.seat]);
    prev = e;
  }
  return groups;
}
