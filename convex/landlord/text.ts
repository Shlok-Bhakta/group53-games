// Events in words, for pushes and the game's feed. `name(seat)` says who a seat is ("You" for the reader).

import { BOARD } from "./board";
import { DECKS } from "./cards";
import { BANK, POT, type Ev, type Side, type Trade } from "./engine";

export const money = (n: number) => `$${n.toLocaleString("en-US")}`;
export const squareName = (pos: number) => BOARD[pos]?.name ?? "somewhere";

type Name = (seat: number) => string;
const party = (seat: number, name: Name) => (seat === BANK ? "the bank" : seat === POT ? "the jackpot" : name(seat));

export function sideText(side: Side): string {
  const parts = [...side.props.map(squareName), ...(side.cash ? [money(side.cash)] : []), ...side.free.map(() => "a get-out-of-jail card")];
  return parts.length ? parts.join(", ") : "nothing";
}

// "Chris's Crown Avenue and $50 for your Kiln Avenue", read by whoever it's offered to.
export const tradeText = (t: Trade, name: Name) => `${name(t.from)} offers ${sideText(t.give)} for ${sideText(t.get)}`;

// A sentence for an event, or null for the ones that only move things along (a turn starting).
export function say(e: Ev, name: Name): string | null {
  switch (e.t) {
    case "roll":
      return e.util ? `${name(e.seat)} rolled ${e.dice[0] + e.dice[1]} for the utility.` : null;
    case "pay": {
      const amt = money(e.amount);
      const where = e.pos === undefined ? "" : ` ${squareName(e.pos)}`;
      switch (e.why) {
        case "rent":
          return `${name(e.from)} paid ${name(e.to)} ${amt} rent.`;
        case "tax":
          return `${name(e.from)} paid ${amt} tax.`;
        case "go":
          return `${name(e.to)} collected ${amt} for passing Start.`;
        case "buy":
          return `${name(e.from)} bought${where} for ${amt}.`;
        case "build":
          return null;
        case "sell":
          return null;
        case "mortgage":
          return `${name(e.to)} mortgaged${where} for ${amt}.`;
        case "unmortgage":
          return `${name(e.from)} lifted the mortgage on${where}.`;
        case "interest":
          return `${name(e.from)} paid ${amt} interest on mortgages.`;
        case "auction":
          return null;
        case "pot":
          return `${name(e.to)} hit the jackpot: ${amt}!`;
        case "seed":
          return null;
        case "jail":
          return `${name(e.from)} paid ${amt} to get out of jail.`;
        case "card":
          return e.from >= 0 && e.to >= 0 ? `${name(e.from)} paid ${name(e.to)} ${amt}.` : e.from >= 0 ? `${name(e.from)} paid ${amt}.` : `${name(e.to)} collected ${amt}.`;
        case "trade":
          return null;
        case "bankrupt":
          return null;
      }
      return null;
    }
    case "card":
      return `${name(e.seat)} drew ${e.deck === "chance" ? "Fortune" : "Treasury"}: ${DECKS[e.deck][e.card].text}`;
    case "jail":
      if (e.in) return e.how === "three" ? `${name(e.seat)} rolled three doubles and went to jail.` : `${name(e.seat)} went to jail.`;
      return e.how === "doubles" ? `${name(e.seat)} rolled doubles out of jail.` : e.how === "card" ? `${name(e.seat)} used a get-out-of-jail card.` : e.how === "third" ? `${name(e.seat)} paid their way out of jail.` : null;
    case "build":
      return e.houses === 5 ? `A hotel went up on ${squareName(e.pos)}.` : null;
    case "auction":
      return `${squareName(e.pos)} is up for auction.`;
    case "bid":
      return `${name(e.seat)} bid ${money(e.amount)} on it.`;
    case "fold":
      return null;
    case "sold":
      return `${name(e.seat)} won ${squareName(e.pos)} for ${money(e.amount)}.`;
    case "unsold":
      return `Nobody bid on ${squareName(e.pos)}.`;
    case "debt":
      return `${name(e.seat)} owes ${party(e.to, name)} ${money(e.amount)} and has to raise it.`;
    case "offer":
      return `${tradeText(e.trade, name)}.`;
    case "traded":
      return `${name(e.trade.to)} took ${name(e.trade.from)}'s trade.`;
    case "untrade":
      return e.why === "reject" ? `${name(e.by)} turned a trade down.` : null;
    case "out":
      return `${name(e.seat)} went bankrupt${e.to >= 0 ? ` to ${name(e.to)}` : ""}.`;
    case "move":
    case "own":
    case "turn":
    case "over":
      return null;
  }
}
