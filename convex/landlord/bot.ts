// A player for tests and playtests only: never seated in a real game. It plays like a casual human: buys what
// it can afford with a cushion left over, bids up to a rough value, builds once it has a group and spare cash,
// raises money by selling then mortgaging, and now and then offers a trade for the last street of a group.

import { BOARD, BUYABLE, groupOf, houseCostOf, mortgageOf, priceOf, unmortgageOf } from "./board";
import { cantAccept, cantBuild, cantMortgage, cantSell, cantTrade, cantUnmortgage, ownsGroup, type Action, type MonoState, type Rng, type Trade } from "./engine";

const CUSHION = 150;

// What a trade does for `seat`, roughly: positive means take it.
function tradeValue(s: MonoState, seat: number, t: Trade): number {
  const gets = seat === t.to ? t.give : t.get;
  const gives = seat === t.to ? t.get : t.give;
  const value = (props: number[], mine: boolean) =>
    props.reduce((a, i) => {
      // Completing a group is worth a lot more than the price; giving one away that completes theirs too.
      const group = groupOf(i);
      const have = group.filter((j) => s.props[j]!.owner === seat).length + (mine ? 1 : 0);
      const bonus = have === group.length && BOARD[i].kind === "street" ? 2 : 1;
      return a + priceOf(i) * bonus * (s.props[i]!.mortgaged ? 0.5 : 1);
    }, 0);
  return value(gets.props, true) + gets.cash + gets.free.length * 40 - value(gives.props, false) - gives.cash - gives.free.length * 40;
}

// Something to raise cash with: a building off the priciest group, then the cheapest mortgage.
function raise(s: MonoState, seat: number): Action | null {
  const mine = BUYABLE.filter((i) => s.props[i]!.owner === seat);
  const built = mine.filter((i) => !cantSell(s, seat, i)).sort((a, b) => houseCostOf(b) - houseCostOf(a));
  if (built.length) return { k: "sell", pos: built[0] };
  const stuck = mine.find((i) => s.props[i]!.houses === 5 && cantSell(s, seat, i));
  if (stuck !== undefined) return { k: "sellAll", pos: stuck };
  const toMortgage = mine.filter((i) => !cantMortgage(s, seat, i)).sort((a, b) => mortgageOf(a) - mortgageOf(b));
  if (toMortgage.length) return { k: "mortgage", pos: toMortgage[0] };
  return null;
}

// Something to do while it isn't the bot's decision: build, lift a mortgage, or offer a trade.
export function spare(s: MonoState, seat: number, rng: Rng): Action | null {
  const p = s.players[seat];
  const mine = BUYABLE.filter((i) => s.props[i]!.owner === seat);
  const build = mine.filter((i) => !cantBuild(s, seat, i) && p.cash - houseCostOf(i) > CUSHION * 2);
  if (build.length && rng() < 0.8) return { k: "build", pos: build[Math.floor(rng() * build.length)] };
  const lift = mine.find((i) => !cantUnmortgage(s, seat, i) && p.cash - unmortgageOf(i) > CUSHION * 3);
  if (lift !== undefined && rng() < 0.5) return { k: "unmortgage", pos: lift };
  if (rng() < 0.15 && s.trades.filter((t) => t.from === seat).length < 2) {
    // The missing street of a group it has the rest of.
    for (const i of BUYABLE) {
      const owner = s.props[i]!.owner;
      if (owner < 0 || owner === seat || BOARD[i].kind !== "street") continue;
      const group = groupOf(i);
      if (group.filter((j) => s.props[j]!.owner === seat).length !== group.length - 1) continue;
      const cash = Math.min(Math.round(priceOf(i) * (1.2 + rng())), p.cash - CUSHION);
      const offer = { from: seat, to: owner, give: { cash: Math.max(0, cash), props: [], free: [] }, get: { cash: 0, props: [i], free: [] } };
      if (cash > 0 && !cantTrade(s, offer)) return { k: "offer", to: owner, give: offer.give, get: offer.get };
    }
  }
  return null;
}

// The bot's move, or null when there's nothing for it to decide.
export function botMove(s: MonoState, seat: number, rng: Rng): Action | null {
  const ph = s.phase;
  const p = s.players[seat];
  if (!p || p.out || ph.k === "over") return null;
  // Every offer gets an answer: one it can't take any more (they're short of the cash now) is turned down.
  const offer = s.trades.find((t) => t.to === seat);
  if (offer) return !cantAccept(s, offer) && tradeValue(s, seat, offer) > 0 && rng() < 0.9 ? { k: "accept", id: offer.id } : { k: "reject", id: offer.id };
  if (ph.k === "debt" && ph.from === seat) return p.cash >= ph.amount ? { k: "pay" } : (raise(s, seat) ?? { k: "bankrupt" });
  if (ph.k === "auction" && ph.in.includes(seat) && ph.leader !== seat) {
    const value = priceOf(ph.pos) * (0.4 + rng() * 0.9);
    const next = ph.high + (rng() < 0.5 ? 1 : 10);
    return next <= value && next <= p.cash - CUSHION / 3 ? { k: "bid", amount: next } : { k: "fold" };
  }
  if (seat !== s.current) return null;
  if (ph.k === "roll") {
    if (rng() < 0.3) {
      const extra = spare(s, seat, rng);
      if (extra) return extra;
    }
    if (p.jail >= 0) {
      if (p.free.length && rng() < 0.7) return { k: "cardJail" };
      if (p.cash > 400 && rng() < 0.5) return { k: "payJail" };
    }
    return { k: "roll" };
  }
  if (ph.k === "buy") {
    if (p.cash - priceOf(ph.pos) >= CUSHION && rng() < 0.9) return { k: "buy" };
    // Sometimes raise the money for a street that'd complete a group.
    if (p.cash < priceOf(ph.pos) && ownsGroupBut(s, seat, ph.pos)) {
      const r = raise(s, seat);
      if (r && r.k === "mortgage") return r;
    }
    return { k: "decline" };
  }
  if (ph.k === "bus") return { k: "bus", choice: (rng() < 0.6 ? 2 : rng() < 0.5 ? 0 : 1) as 0 | 1 | 2 };
  if (ph.k === "pick") {
    const free = BUYABLE.filter((i) => s.props[i]!.owner < 0);
    return { k: "pick", pos: free.length ? free[Math.floor(rng() * free.length)] : Math.floor(rng() * BOARD.length) };
  }
  return null;
}

const ownsGroupBut = (s: MonoState, seat: number, pos: number) => {
  const group = groupOf(pos);
  return group.filter((j) => j !== pos).every((j) => s.props[j]!.owner === seat) && !ownsGroup(s, seat, pos);
};
