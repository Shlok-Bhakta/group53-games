import type { HandResult, PokerState } from "../../../convex/poker/engine";

const finishedUpTo = (s: PokerState) => (s.turn === -1 && s.last?.hand === s.hand ? s.hand : s.hand - 1);
const resultsOf = (s: PokerState) => s.recent ?? (s.last ? [s.last] : []);

export const streetFor = (cards: number) => (cards >= 5 ? 3 : cards === 4 ? 2 : cards >= 3 ? 1 : 0);

export function missedHands(from: PokerState, to: PokerState): HandResult[] {
  return resultsOf(to).filter((r) => r.hand > finishedUpTo(from) && r.hand <= to.hand);
}

export function finalHands(s: PokerState): HandResult[] {
  const results = resultsOf(s).filter((r) => r.hand <= s.hand && handAt(s, r));
  const last = results.at(-1);
  if (!last || last.hand !== s.hand || s.turn !== -1) return [];
  let from = results.length - 1;
  while (from > 0 && results[from].forced && results[from - 1].hand === results[from].hand - 1) from--;
  return results.slice(from);
}

export function handAt(to: PokerState, r: HandResult): PokerState | null {
  const { start, button, dealt, blinds } = r;
  if (!start || button === undefined || !dealt || !blinds) return null;
  return {
    ...to,
    hand: r.hand,
    button,
    sb: r.sb ?? to.sb,
    bb: r.bb ?? to.bb,
    start,
    stacks: start.map((st, i) => st - blinds[i]),
    bets: blinds,
    paid: blinds,
    dealt,
    folded: dealt.map((d) => !d),
    acted: dealt.map(() => null),
    drew: dealt.map(() => null),
    current: Math.max(0, ...blinds),
    street: 0,
    board: [],
    turn: -1,
    log: [],
    last: null,
    recent: [],
    out: to.out.filter((o) => o.hand < r.hand),
  };
}

export function stacksAfter(to: PokerState, r: HandResult) {
  if (r.hand === to.hand) return to.stacks;
  return resultsOf(to).find((x) => x.hand === r.hand + 1)?.start ?? to.start;
}
