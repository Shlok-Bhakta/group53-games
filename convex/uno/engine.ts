import {
  COLORS,
  colorOf,
  deckOf,
  drawOf,
  faceOf,
  isNumber,
  isWild,
  pointsOf,
  shuffle,
  type Card,
  type Color,
  type DeckKind,
} from "./cards";

export type { Card, Color, DeckKind } from "./cards";

export type Stacking = 0 | 1 | 2;
export type Rules = {
  deck: DeckKind;
  decks: number;
  hand: number;
  stack: Stacking;
  drawUntil: boolean;
  sevenZero: boolean;
  jumpIn: boolean;
  unoCall: boolean;
  challenge: boolean;
  forcePlay: boolean;
  powerFinish: boolean;
  mercy: number;
  goal: number;
};

export const UNO_PENALTY = 2;
export const CHALLENGE_PENALTY = 2;
export const KNOCKOUT_POINTS = 250;
const LOG_KEPT = 40;
const RECENT_KEPT = 5;

export type Pending = { kind: "draw"; amount: number; level: number; by: number; challenge: boolean } | { kind: "roulette"; by: number };

export type LogKind =
  "play" | "jump" | "draw" | "pass" | "take" | "challenge" | "roulette" | "catch" | "uno" | "swap" | "rotate" | "mercy" | "leave";
export type LogEntry = {
  seq: number;
  hand: number;
  seat: number;
  kind: LogKind;
  card?: Card;
  color?: Color;
  n?: number;
  target?: number;
  guilty?: boolean;
  auto?: boolean;
};

export type Out = { seat: number; hand: number; reason: "mercy" | "resign" | "idle" };
export type HandResult = { hand: number; winner: number; points: number; cards: number[]; left: number[]; knockouts: number };

export type UnoState = {
  kind: "uno";
  rules: Rules;
  hand: number;
  seq: number;
  turn: number;
  dir: 1 | -1;
  top: Card;
  color: Color;
  recent: Card[];
  counts: number[];
  left: number;
  pending: Pending | null;
  drew: boolean;
  called: boolean[];
  forgot: number | null;
  out: Out[];
  scores: number[];
  log: LogEntry[];
  last: HandResult | null;
  idle: number[];
  first: number;
  over: boolean;
};

export type Hidden = { deck: Card[]; discard: Card[]; hands: Card[][]; drawn: Card | null; bluff: boolean };
export type Table = { state: UnoState; hidden: Hidden };

export type Action =
  | { kind: "play"; card: Card; color?: Color; target?: number; uno?: boolean }
  | { kind: "draw" }
  | { kind: "pass" }
  | { kind: "take" }
  | { kind: "challenge" }
  | { kind: "roulette"; color: Color }
  | { kind: "catch"; seat: number }
  | { kind: "uno" };

type Rng = () => number;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const seatsOf = (s: UnoState) => s.counts.map((_, i) => i);

export const isGone = (s: UnoState, seat: number) => s.out.some((o) => o.seat === seat && o.reason !== "mercy");
export const isOutOfHand = (s: UnoState, seat: number) => s.out.some((o) => o.seat === seat && (o.reason !== "mercy" || o.hand === s.hand));
export const alive = (s: UnoState) => seatsOf(s).filter((i) => !isGone(s, i));
export const inHand = (s: UnoState) => seatsOf(s).filter((i) => !isOutOfHand(s, i));

export function next(s: UnoState, from: number, steps = 1) {
  const n = s.counts.length;
  let at = from;
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < n; i++) {
      at = (((at + s.dir) % n) + n) % n;
      if (!isOutOfHand(s, at)) break;
    }
  }
  return at;
}

const matches = (s: UnoState, card: Card) =>
  isWild(card) || colorOf(card) === s.color || (!isWild(s.top) && faceOf(card) === faceOf(s.top));

export function stackable(s: UnoState, card: Card) {
  const p = s.pending;
  const d = drawOf(card);
  if (!p || p.kind !== "draw" || !d || s.rules.stack === 0) return false;
  if (s.rules.stack === 1) return faceOf(card) === faceOf(s.top);
  return d >= p.level;
}

const goesOut = (hand: Card[], card: Card) =>
  hand.length === 1 || (faceOf(card) === "DA" && hand.every((c) => !isWild(c) && colorOf(c) === colorOf(card)));

export function cantPlay(s: UnoState, seat: number, card: Card, hand: Card[], drawn: Card | null): string | null {
  if (s.over) return "The game's over.";
  if (isOutOfHand(s, seat)) return "You're out of this hand.";
  if (!hand.includes(card)) return "You don't have that card.";
  const finish = !s.rules.powerFinish && !isNumber(card) && goesOut(hand, card) ? "You can't go out on a power card." : null;
  if (seat !== s.turn) {
    if (!s.rules.jumpIn) return "It's not your turn.";
    if (s.pending || isWild(card) || card !== s.top) return "Not your turn: only the exact same card can jump in.";
    return finish;
  }
  if (s.pending?.kind === "roulette") return "Pick a color for the roulette first.";
  if (s.pending?.kind === "draw") {
    if (stackable(s, card)) return finish;
    return s.rules.stack ? "Stack a draw card or take them." : "Take the cards first.";
  }
  if (s.drew && card !== drawn) return "You can only play the card you just drew.";
  if (!matches(s, card)) return "That doesn't match.";
  return finish;
}

export const playable = (s: UnoState, seat: number, hand: Card[], drawn: Card | null) =>
  hand.filter((c) => cantPlay(s, seat, c, hand, drawn) === null);

export function cantDraw(s: UnoState, seat: number, hand: Card[]): string | null {
  if (s.over) return "The game's over.";
  if (seat !== s.turn) return "It's not your turn.";
  if (s.pending) return s.pending.kind === "draw" ? "Take the cards or stack on them." : "Pick a color for the roulette first.";
  if (s.drew) return "You already drew this turn.";
  if (s.rules.forcePlay && playable(s, seat, hand, null).length) return "You have to play when you can.";
  return null;
}

export const canPass = (s: UnoState, seat: number) => s.turn === seat && s.drew && !s.rules.drawUntil && !s.rules.forcePlay;

function pull(t: Table, rng: Rng): Card | null {
  if (!t.hidden.deck.length) {
    const under = t.hidden.discard.slice(0, -1);
    t.hidden.discard = t.hidden.discard.slice(-1);
    t.hidden.deck = shuffle(under, rng);
  }
  return t.hidden.deck.pop() ?? null;
}

function knockOut(t: Table, seat: number, reason: Out["reason"]) {
  const s = t.state;
  s.out.push({ seat, hand: s.hand, reason });
  t.hidden.discard = [...t.hidden.hands[seat], ...t.hidden.discard];
  t.hidden.hands[seat] = [];
  s.counts[seat] = 0;
  s.called[seat] = false;
  if (s.forgot === seat) s.forgot = null;
}

function checkMercy(t: Table, seat: number) {
  const s = t.state;
  if (!s.rules.mercy || isOutOfHand(s, seat) || t.hidden.hands[seat].length < s.rules.mercy) return;
  log(s, { seat, kind: "mercy", n: t.hidden.hands[seat].length });
  knockOut(t, seat, "mercy");
}

const full = (t: Table, seat: number) => t.state.rules.mercy > 0 && t.hidden.hands[seat].length >= t.state.rules.mercy;

function spin(t: Table, seat: number, color: Color, rng: Rng) {
  const s = t.state;
  let n = 0;
  while (!full(t, seat)) {
    const c = pull(t, rng);
    if (!c) break;
    t.hidden.hands[seat].push(c);
    n++;
    if (!isWild(c) && colorOf(c) === color) break;
  }
  s.counts[seat] = t.hidden.hands[seat].length;
  s.color = color;
  log(s, { seat, kind: "roulette", color, n });
  checkMercy(t, seat);
}

function give(t: Table, seat: number, n: number, rng: Rng) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    const c = pull(t, rng);
    if (!c) break;
    t.hidden.hands[seat].push(c);
    got++;
  }
  t.state.counts[seat] = t.hidden.hands[seat].length;
  checkMercy(t, seat);
  return got;
}

function log(s: UnoState, e: Omit<LogEntry, "seq" | "hand">) {
  s.log = [...s.log, { seq: s.seq, hand: s.hand, ...e }].slice(-LOG_KEPT);
}

function deal(t: Table, first: number, rng: Rng) {
  const s = t.state;
  const deck = shuffle(deckOf(s.rules.deck, s.rules.decks), rng);
  t.hidden.hands = seatsOf(s).map((i) => (isGone(s, i) ? [] : deck.splice(-s.rules.hand)));
  let top = deck.pop()!;
  for (let guard = 0; !isNumber(top) && guard < deck.length; guard++) {
    deck.unshift(top);
    top = deck.pop()!;
  }
  t.hidden.deck = deck;
  t.hidden.discard = [top];
  t.hidden.drawn = null;
  t.hidden.bluff = false;
  Object.assign(s, {
    top,
    color: colorOf(top) as Color,
    recent: [top],
    dir: 1,
    turn: first,
    first,
    pending: null,
    drew: false,
    forgot: null,
    called: s.counts.map(() => false),
    counts: t.hidden.hands.map((h) => h.length),
    left: deck.length,
  });
}

export function newGame(players: number, rules: Rules, rng: Rng, first = 0): Table {
  const state: UnoState = {
    kind: "uno",
    rules,
    hand: 1,
    seq: 0,
    turn: first,
    dir: 1,
    top: "r0",
    color: "r",
    recent: [],
    counts: Array<number>(players).fill(0),
    left: 0,
    pending: null,
    drew: false,
    called: Array<boolean>(players).fill(false),
    forgot: null,
    out: [],
    scores: Array<number>(players).fill(0),
    log: [],
    last: null,
    idle: Array<number>(players).fill(0),
    first,
    over: false,
  };
  const t: Table = { state, hidden: { deck: [], discard: [], hands: [], drawn: null, bluff: false } };
  deal(t, first, rng);
  return t;
}

function endHand(t: Table, winner: number, rng: Rng) {
  const s = t.state;
  const knockouts = s.out.filter((o) => o.reason === "mercy" && o.hand === s.hand).length;
  const left = t.hidden.hands.map((h) => h.reduce((a, c) => a + pointsOf(c), 0));
  const points = left.reduce((a, b, i) => (i === winner ? a : a + b), 0) + knockouts * KNOCKOUT_POINTS;
  s.scores[winner] += points;
  s.last = { hand: s.hand, winner, points, cards: [...s.counts], left, knockouts };
  s.pending = null;
  s.drew = false;
  s.forgot = null;
  const players = alive(s);
  if (s.rules.goal === 0 || s.scores[winner] >= s.rules.goal || players.length < 2) {
    s.over = true;
    s.turn = -1;
    return;
  }
  s.hand += 1;
  const first = next({ ...s, out: s.out.filter((o) => o.reason !== "mercy") }, s.first);
  deal(t, first, rng);
}

function settle(t: Table, rng: Rng) {
  const s = t.state;
  s.counts = t.hidden.hands.map((h) => h.length);
  s.called = s.called.map((c, i) => c && s.counts[i] === 1);
  if (s.forgot !== null && s.counts[s.forgot] !== 1) s.forgot = null;
  if (!s.over && isOutOfHand(s, s.turn)) {
    s.pending = null;
    s.drew = false;
    s.turn = next(s, s.turn);
  }
  const players = inHand(s);
  const winner = players.find((i) => s.counts[i] === 0) ?? (players.length === 1 ? players[0] : undefined);
  if (winner !== undefined) {
    if (s.pending?.kind === "draw" && s.turn !== winner) give(t, s.turn, s.pending.amount, rng);
    if (s.pending?.kind === "roulette" && s.turn !== winner) spin(t, s.turn, favorite(t.hidden.hands[s.turn]), rng);
    endHand(t, winner, rng);
  }
  s.left = t.hidden.deck.length;
}

function sevenZero(t: Table, seat: number, card: Card, target: number | undefined) {
  const s = t.state;
  const face = faceOf(card);
  if (!s.rules.sevenZero || !t.hidden.hands[seat].length) return;
  if (face === "7") {
    const other = target!;
    [t.hidden.hands[seat], t.hidden.hands[other]] = [t.hidden.hands[other], t.hidden.hands[seat]];
    s.called[seat] = s.called[other] = false;
    log(s, { seat, kind: "swap", target: other });
  } else if (face === "0") {
    const order = inHand(s);
    const was = t.hidden.hands.map((h) => h);
    for (const i of order) t.hidden.hands[next(s, i)] = was[i];
    s.called = s.called.map(() => false);
    log(s, { seat, kind: "rotate" });
  }
}

const wantsTarget = (s: UnoState, card: Card, hand: Card[]) => s.rules.sevenZero && faceOf(card) === "7" && hand.length > 1;

function play(t: Table, seat: number, a: Extract<Action, { kind: "play" }>, rng: Rng) {
  const s = t.state;
  const hand = t.hidden.hands[seat];
  const why = cantPlay(s, seat, a.card, hand, t.hidden.drawn);
  if (why) throw new Error(why);
  const face = faceOf(a.card);
  if (isWild(a.card) && face !== "WC" && !a.color) throw new Error("Pick a color.");
  if (wantsTarget(s, a.card, hand)) {
    const ok = a.target !== undefined && a.target !== seat && inHand(s).includes(a.target);
    if (!ok) throw new Error("Pick who to swap hands with.");
  }
  const jump = seat !== s.turn;
  const stacked = s.pending?.kind === "draw";
  if (face === "W4") t.hidden.bluff = hand.some((c) => c !== a.card && !isWild(c) && colorOf(c) === s.color);
  hand.splice(hand.indexOf(a.card), 1);
  if (face === "DA") {
    const same = hand.filter((c) => !isWild(c) && colorOf(c) === colorOf(a.card));
    t.hidden.hands[seat] = hand.filter((c) => !same.includes(c));
    t.hidden.discard.push(...same);
  }
  const mine = t.hidden.hands[seat];
  t.hidden.discard.push(a.card);
  t.hidden.drawn = null;
  s.drew = false;
  s.top = a.card;
  s.color = isWild(a.card) ? (a.color ?? s.color) : (colorOf(a.card) as Color);
  s.recent = [...s.recent, a.card].slice(-RECENT_KEPT);
  s.turn = seat;
  log(s, { seat, kind: jump ? "jump" : "play", card: a.card, ...(isWild(a.card) && a.color ? { color: a.color } : {}) });
  if (s.rules.unoCall && mine.length === 1) {
    if (a.uno) s.called[seat] = true;
    else s.forgot = seat;
  }
  sevenZero(t, seat, a.card, a.target);
  const players = inHand(s).length;
  const d = drawOf(a.card);
  if (face === "R" || face === "WR4") s.dir = s.dir === 1 ? -1 : 1;
  if (d) {
    const victim = next(s, seat);
    const holds = s.rules.stack > 0 || (s.rules.challenge && face === "W4");
    if (holds) {
      s.pending = {
        kind: "draw",
        amount: (stacked && s.pending?.kind === "draw" ? s.pending.amount : 0) + d,
        level: d,
        by: seat,
        challenge: s.rules.challenge && face === "W4" && !stacked,
      };
      s.turn = victim;
    } else {
      s.pending = null;
      log(s, { seat: victim, kind: "take", n: give(t, victim, d, rng) });
      s.turn = next(s, victim);
    }
    return;
  }
  s.pending = null;
  if (face === "WC") {
    s.pending = { kind: "roulette", by: seat };
    s.turn = next(s, seat);
  } else if (face === "S") s.turn = next(s, seat, 2);
  else if (face === "SA") s.turn = seat;
  else if (face === "R") s.turn = players === 2 ? seat : next(s, seat);
  else s.turn = next(s, seat);
}

function drawTurn(t: Table, seat: number, rng: Rng) {
  const s = t.state;
  const why = cantDraw(s, seat, t.hidden.hands[seat]);
  if (why) throw new Error(why);
  let last: Card | null = null;
  let n = 0;
  for (;;) {
    last = pull(t, rng);
    if (!last) break;
    t.hidden.hands[seat].push(last);
    n++;
    if (!s.rules.drawUntil || full(t, seat) || cantPlay(s, seat, last, t.hidden.hands[seat], null) === null) break;
  }
  s.counts[seat] = t.hidden.hands[seat].length;
  log(s, { seat, kind: "draw", n });
  checkMercy(t, seat);
  if (isOutOfHand(s, seat)) return;
  if (last && cantPlay(s, seat, last, t.hidden.hands[seat], null) === null) {
    s.drew = true;
    t.hidden.drawn = last;
    return;
  }
  s.turn = next(s, seat);
}

function onTurn(s: UnoState, seat: number) {
  if (seat !== s.turn) throw new Error("It's not your turn.");
}

function turnAction(t: Table, seat: number, a: Exclude<Action, { kind: "play" | "catch" | "uno" }>, rng: Rng) {
  const s = t.state;
  onTurn(s, seat);
  const p = s.pending;
  switch (a.kind) {
    case "draw":
      return drawTurn(t, seat, rng);
    case "pass":
      if (!canPass(s, seat)) throw new Error(s.drew ? "Play the card you drew." : "Draw first.");
      s.drew = false;
      t.hidden.drawn = null;
      log(s, { seat, kind: "pass" });
      s.turn = next(s, seat);
      return;
    case "take": {
      if (p?.kind !== "draw") throw new Error("There's nothing to take.");
      s.pending = null;
      const n = give(t, seat, p.amount, rng);
      log(s, { seat, kind: "take", n });
      s.turn = next(s, seat);
      return;
    }
    case "challenge": {
      if (p?.kind !== "draw" || !p.challenge) throw new Error("There's nothing to challenge.");
      s.pending = null;
      const guilty = t.hidden.bluff;
      if (guilty) {
        const n = give(t, p.by, p.amount, rng);
        log(s, { seat, kind: "challenge", target: p.by, guilty, n });
        return;
      }
      const n = give(t, seat, p.amount + CHALLENGE_PENALTY, rng);
      log(s, { seat, kind: "challenge", target: p.by, guilty, n });
      s.turn = next(s, seat);
      return;
    }
    case "roulette": {
      if (p?.kind !== "roulette") throw new Error("There's no roulette to spin.");
      if (!(COLORS as readonly string[]).includes(a.color)) throw new Error("Pick a color.");
      s.pending = null;
      spin(t, seat, a.color, rng);
      s.turn = next(s, seat);
      return;
    }
  }
}

export function act(t0: Table, seat: number, a: Action, rng: Rng, auto = false): Table {
  const t = clone(t0);
  const s = t.state;
  if (s.over) throw new Error("The game's over.");
  if (isOutOfHand(s, seat)) throw new Error("You're out of this hand.");
  if (a.kind === "catch") {
    if (!s.rules.unoCall || s.forgot !== a.seat || a.seat === seat) throw new Error("Too late, nobody to catch.");
    s.seq++;
    s.forgot = null;
    const n = give(t, a.seat, UNO_PENALTY, rng);
    log(s, { seat, kind: "catch", target: a.seat, n });
  } else if (a.kind === "uno") {
    if (s.forgot !== seat) throw new Error("No need to call it now.");
    s.seq++;
    s.forgot = null;
    s.called[seat] = true;
    log(s, { seat, kind: "uno" });
  } else {
    s.seq++;
    s.forgot = null;
    if (a.kind === "play") play(t, seat, a, rng);
    else turnAction(t, seat, a, rng);
    s.idle[seat] = auto ? s.idle[seat] + 1 : 0;
    if (auto) s.log = s.log.map((e) => (e.seq === s.seq && e.seat === seat ? { ...e, auto: true } : e));
  }
  settle(t, rng);
  return t;
}

export function leave(t0: Table, seat: number, reason: "resign" | "idle", rng: Rng): Table {
  const t = clone(t0);
  const s = t.state;
  if (s.over || isGone(s, seat)) return t;
  s.seq++;
  const wasTurn = s.turn === seat;
  knockOut(t, seat, reason);
  log(s, { seat, kind: "leave" });
  if (alive(s).length < 2) {
    s.over = true;
    s.turn = -1;
    s.pending = null;
    s.left = t.hidden.deck.length;
    return t;
  }
  if (s.pending?.kind === "draw" && s.pending.by === seat) s.pending = { ...s.pending, challenge: false };
  if (wasTurn) {
    s.pending = null;
    s.drew = false;
    t.hidden.drawn = null;
    s.turn = next(s, seat);
  }
  settle(t, rng);
  return t;
}

function favorite(hand: Card[]): Color {
  const n = COLORS.map((c) => hand.filter((x) => colorOf(x) === c).length);
  return COLORS[n.indexOf(Math.max(...n))];
}

export function autoAction(t: Table, seat: number): Action {
  const s = t.state;
  const hand = t.hidden.hands[seat];
  if (s.pending?.kind === "draw") return { kind: "take" };
  if (s.pending?.kind === "roulette") return { kind: "roulette", color: favorite(hand) };
  const others = inHand(s).filter((i) => i !== seat);
  const playOf = (card: Card): Action => ({ kind: "play", card, color: favorite(hand), target: others[0], uno: true });
  if (s.drew) return canPass(s, seat) ? { kind: "pass" } : playOf(t.hidden.drawn!);
  if (cantDraw(s, seat, hand)) return playOf(playable(s, seat, hand, null)[0]);
  return { kind: "draw" };
}

export function autoTurn(t: Table, seat: number, rng: Rng): Table {
  let x = act(t, seat, autoAction(t, seat), rng, true);
  if (!x.state.over && x.state.turn === seat && x.state.drew) x = act(x, seat, autoAction(x, seat), rng, true);
  x.state.idle[seat] = t.state.idle[seat] + 1;
  return x;
}

function grouped(seats: number[], key: (i: number) => number): number[][] {
  const sorted = [...seats].sort((a, b) => key(a) - key(b));
  const out: number[][] = [];
  for (const i of sorted) {
    const g = out.at(-1);
    if (g && key(g[0]) === key(i)) g.push(i);
    else out.push([i]);
  }
  return out;
}

export function standings(s: UnoState): number[][] {
  const gone = s.out.filter((o) => o.reason !== "mercy");
  const live = alive(s);
  const last = s.last && s.last.hand === s.hand ? s.last : null;
  let groups: number[][];
  if (last && s.rules.goal === 0) {
    const knocked = s.out.filter((o) => o.reason === "mercy" && o.hand === s.hand && !isGone(s, o.seat)).map((o) => o.seat);
    const rest = live.filter((i) => i !== last.winner && !knocked.includes(i));
    groups = [[last.winner], ...grouped(rest, (i) => last.left[i]), ...[...knocked].reverse().map((i) => [i])];
  } else groups = grouped(live, (i) => -s.scores[i]);
  return [...groups, ...[...gone].reverse().map((o) => [o.seat])];
}
