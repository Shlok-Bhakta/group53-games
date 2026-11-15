import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { CATEGORY, bestHand, type Card } from "../../../convex/poker/cards";
import { VARIANTS, isOut, type HandResult, type LogEntry, type PokerState } from "../../../convex/poker/engine";
import { resultText } from "../../../convex/poker/text";
import { sfx } from "@/sound";
import { sum } from "./format";

export const PACE = 1.2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * PACE));

export type Spell = { word: string; tone: "green" | "hit" };
export type Show = {
  state: PokerState;
  board: Card[];
  bets: number[];
  paid: number[];
  stacks: number[];
  folded: boolean[];
  turn: number;
  dealtCards: number;
  faceUp: number;
  sweeping: boolean;
  shown: (Card[] | null)[];
  best: Card[] | null;
  paying: { seat: number; net: number }[] | null;
  banner: string | null;
  spell: Spell | null;
  busy: boolean;
};

export function dealOrder(s: PokerState) {
  const n = s.stacks.length;
  const seats = Array.from({ length: n }, (_, k) => (s.button + 1 + k) % n).filter((i) => s.dealt[i]);
  return Array.from({ length: VARIANTS[s.variant].hole }, () => seats).flat();
}
export function cardsHeld(s: PokerState, seat: number, dealtCards: number) {
  if (dealtCards === Infinity) return VARIANTS[s.variant].hole;
  return dealOrder(s)
    .slice(0, dealtCards)
    .filter((x) => x === seat).length;
}

const blankShown = (s: PokerState) => s.stacks.map(() => null);
const steady = (s: PokerState): Show => ({
  state: s,
  board: s.board,
  bets: s.bets,
  paid: s.paid,
  stacks: s.stacks,
  folded: s.folded,
  turn: s.turn,
  dealtCards: Infinity,
  faceUp: Infinity,
  sweeping: false,
  shown: blankShown(s),
  best: null,
  paying: null,
  banner: null,
  spell: null,
  busy: false,
});
const topWinner = (r: HandResult) => r.won.indexOf(Math.max(...r.won));
const winningHand = (s: PokerState, r: HandResult) => {
  const cards = r.shown[topWinner(r)];
  return r.showdown && cards ? bestHand(s.variant, cards, r.board) : null;
};
function settled(s: PokerState, nameOf: (seat: number) => string): Show {
  const r = s.last;
  if (s.turn !== -1 || !r) return steady(s);
  return { ...steady(s), board: r.board, shown: r.shown, best: winningHand(s, r)?.cards ?? null, banner: resultText(r, nameOf) };
}
const undealt = (s: PokerState): Show => ({
  ...steady(s),
  board: [],
  bets: s.bets.map(() => 0),
  paid: s.paid.map(() => 0),
  stacks: s.start,
  turn: -1,
  dealtCards: 0,
  faceUp: 0,
  busy: true,
});

function bigHand(s: PokerState, r: HandResult): string | null {
  const hand = winningHand(s, r);
  if (!hand || hand.category < 5) return null;
  return (hand.name === "Royal flush" ? hand.name : CATEGORY[hand.category]).toUpperCase();
}

function moveSound(e: LogEntry, bb: number, play: typeof sfx) {
  if (e.kind === "fold") play("recall");
  else if (e.kind === "check") play("knock");
  else if (e.kind === "draw") play("shuffle");
  else play("chips", { count: 1 + Math.floor((e.amount ?? 0) / (bb * 3)) });
}

export function useShow(state: PokerState, opts: { mySeat: number; nameOf: (seat: number) => string; fresh: boolean }) {
  const still = useReducedMotion();
  const o = useRef(opts);
  o.current = opts;
  const [show, setShow] = useState<Show>(() => (opts.fresh && !still ? undealt(state) : settled(state, opts.nameOf)));
  const latest = useRef(state);
  latest.current = state;
  const content = JSON.stringify(state);
  const drawn = useRef<PokerState | null>(opts.fresh && !still ? null : state);
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const patch = (p: Partial<Show>) => {
      if (alive.current) setShow((d) => ({ ...d, ...p }));
    };
    const play: typeof sfx = (name, opts) => {
      if (alive.current) sfx(name, { ...opts, live: true });
    };
    const turnChime = (from: PokerState | null, to: PokerState) => {
      if (to.turn === o.current.mySeat && to.turn >= 0 && from?.turn !== to.turn) setTimeout(() => play("turn"), 200);
    };

    const deal = async (to: PokerState) => {
      setShow(undealt(to));
      play("shuffle");
      await sleep(320);
      const order = dealOrder(to);
      const gap = Math.min(75, 1500 / order.length);
      for (let i = 0; i < order.length && alive.current; i++) {
        patch({ dealtCards: i + 1 });
        play("deal", { count: 1 + (i % VARIANTS[to.variant].hole) });
        await sleep(gap);
      }
      await sleep(380);
      const hole = VARIANTS[to.variant].hole;
      for (let k = 0; k < hole && alive.current; k++) {
        patch({ faceUp: k + 1 });
        if (o.current.mySeat >= 0 && to.dealt[o.current.mySeat]) play("flip", { count: k + 1 });
        await sleep(150);
      }
      await sleep(260);
      if (alive.current) setShow(steady(to));
      if (sum(to.paid)) play("chips");
      turnChime(null, to);
    };

    const sweep = async (from: PokerState, paid: number[], stacks: number[], folded: boolean[]) => {
      const bets = paid.map((p, i) => Math.max(0, p - (from.paid[i] - from.bets[i])));
      patch({ turn: -1, busy: true, paid, stacks, folded, bets });
      if (sum(paid) > sum(from.paid)) play("chips", { count: 2 });
      else if (folded.some((f, i) => f && !from.folded[i])) play("recall");
      else play("knock");
      if (sum(bets) === 0) return;
      await sleep(320);
      patch({ sweeping: true });
      play("sweep");
      await sleep(340 + bets.length * 30);
      patch({ sweeping: false, bets: bets.map(() => 0) });
      await sleep(180);
    };
    const reveal = async (board: Card[], from: number, gap: number) => {
      for (let i = from; i < board.length && alive.current; i++) {
        patch({ board: board.slice(0, i + 1) });
        play("flip", { count: i + 1 });
        await sleep(400 + gap);
      }
    };

    const nextStreet = async (from: PokerState, to: PokerState) => {
      await sweep(from, to.paid, to.stacks, to.folded);
      if (!alive.current) return;
      patch({ state: { ...from, street: to.street } });
      await reveal(to.board, from.board.length, 180);
      if (alive.current) setShow(steady(to));
      for (const e of to.log.slice(from.log.length).filter((x) => x.street === to.street)) moveSound(e, to.bb, play);
      turnChime(null, to);
    };

    const endHand = async (from: PokerState, to: PokerState, r: HandResult) => {
      const paid = r.won.map((w, i) => w - r.net[i]);
      const stacks = from.start.map((st, i) => (isOut(to, i) && to.out.find((x) => x.seat === i)?.reason === "resign" ? 0 : st - paid[i]));
      const folded = from.dealt.map((dealt, i) => !dealt || (r.showdown ? !r.shown[i] : r.won[i] === 0));
      await sweep(from, paid, stacks, folded);
      if (!alive.current) return;
      if (r.showdown) {
        patch({ shown: r.shown });
        play("flip", { count: 3 });
        await sleep(from.board.length < r.board.length ? 700 : 450);
        if (!alive.current) return;
        await reveal(r.board, from.board.length, from.board.length < 3 ? 180 : 500);
        if (!alive.current) return;
        patch({ best: winningHand(from, r)?.cards ?? null });
        await sleep(450);
        const word = bigHand(from, r);
        if (word && alive.current) {
          patch({ spell: { word, tone: "green" } });
          play("play", { count: 5, score: 30 });
          await sleep(1000);
          patch({ spell: null });
          await sleep(160);
        }
      }
      if (!alive.current) return;
      const final = to.hand === from.hand ? to.stacks : to.start;
      patch({
        banner: resultText(r, o.current.nameOf),
        paying: r.won.flatMap((w, seat) => (w > 0 ? [{ seat, net: r.net[seat] }] : [])),
      });
      play("payout", { count: Math.min(5, 1 + Math.floor(Math.max(...r.won) / (from.bb * 6))) });
      await sleep(420);
      patch({ stacks: final });
      await sleep(1500);
    };

    const run = async () => {
      if (running.current) return;
      running.current = true;
      for (let guard = 0; guard < 200 && alive.current; guard++) {
        const to = latest.current;
        const from = drawn.current;
        if (from && JSON.stringify(from) === JSON.stringify(to)) break;
        drawn.current = to;
        const nameOf = o.current.nameOf;
        if (still || document.visibilityState !== "visible") setShow(settled(to, nameOf));
        else if (!from) await deal(to);
        else if (to.last && to.last.hand === from.hand && (to.hand !== from.hand || to.turn === -1)) {
          await endHand(from, to, to.last);
          if (!alive.current) break;
          if (to.turn === -1) setShow(settled(to, nameOf));
          else await deal(to);
        } else if (to.hand !== from.hand) {
          if (to.turn === -1) setShow(settled(to, nameOf));
          else await deal(to);
        } else if (to.street !== from.street) await nextStreet(from, to);
        else {
          setShow(settled(to, nameOf));
          const moves = to.log.slice(from.log.length);
          moves.forEach((e, i) => setTimeout(() => moveSound(e, to.bb, play), i * 130));
          turnChime(from, to);
          const shove = moves.find((e) => e.allIn && (e.kind === "raise" || e.kind === "bet"));
          if (shove) {
            patch({ spell: { word: "ALL IN", tone: "hit" } });
            play("slam");
            setTimeout(() => setShow((d) => (d.spell?.word === "ALL IN" ? { ...d, spell: null } : d)), 1150 * PACE);
          }
        }
      }
      running.current = false;
    };
    void run();
  }, [content, still]);

  return { ...show, behind: !drawn.current || JSON.stringify(drawn.current) !== content };
}
