import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { SIZE } from "../../../convex/landlord/board";
import { DECKS, type Deck } from "../../../convex/landlord/cards";
import type { Ev, MonoState } from "../../../convex/landlord/engine";
import { say } from "../../../convex/landlord/text";
import { sfx } from "@/sound";

// The screen draws a show, not the state: everything that happened plays out in order (the dice, the piece
// hopping square by square, money changing hands, the card drawn), from where this phone last looked
// (`landlord-seen:<match>`, an event number) up to now, and then whatever lands while you watch. Once it's
// caught up the screen is the real state again, and only then can you act. Each move's events carry what they
// changed outright (engine.ts `Ev`), so playing them back needs no rules.

export type Float = { key: number; seat: number; amount: number };
export type Shown = {
  state: MonoState;
  // Still playing something back: the dock waits.
  busy: boolean;
  // Playing back what happened while you were away, with a Skip.
  catching: boolean;
  skip: () => void;
  // What's happening now, in words.
  line: string | null;
  dice: { key: number; dice: number[]; speed?: number } | null;
  card: { key: number; deck: Deck; text: string; seat: number } | null;
  floats: Float[];
  highlight: number | null;
  // Every sentence so far this visit, newest last.
  feed: { key: number; text: string }[];
};

const seenKey = (id: string) => `landlord-seen:${id}`;
const readSeen = (id: string) => {
  const v = Number(localStorage.getItem(seenKey(id)));
  return Number.isFinite(v) && localStorage.getItem(seenKey(id)) !== null ? v : undefined;
};

type Item = { ev: Ev; end?: number; by: number };

const clone = (s: MonoState): MonoState => ({ ...s, players: s.players.map((p) => ({ ...p, free: [...p.free] })), props: s.props.map((p) => (p ? { ...p } : p)), bank: { ...s.bank }, trades: [...s.trades] });

// What an event changes on screen, outright.
function apply(s0: MonoState, e: Ev): MonoState {
  const s = clone(s0);
  switch (e.t) {
    case "turn":
      s.current = e.seat;
      break;
    case "roll":
      if (!e.util) s.dice = e.speed ? [...e.dice, e.speed] : e.dice;
      break;
    case "move":
      s.players[e.seat].pos = e.to;
      break;
    case "pay":
      e.cash.forEach((c, i) => (s.players[i].cash = c));
      s.pot = e.pot;
      break;
    case "card":
      if (DECKS[e.deck][e.card].effect.k === "free") s.players[e.seat].free.push(e.deck);
      break;
    case "jail":
      s.players[e.seat].jail = e.in ? 0 : -1;
      if (!e.in && e.how === "card") s.players[e.seat].free.shift();
      break;
    case "own":
      s.props[e.pos] = { owner: e.owner, mortgaged: e.mortgaged, houses: e.houses };
      break;
    case "build":
      s.props[e.pos] = { ...s.props[e.pos]!, houses: e.houses };
      s.bank = { ...e.bank };
      break;
    case "offer":
      s.trades.push(e.trade);
      break;
    case "traded":
      s.trades = s.trades.filter((t) => t.id !== e.trade.id);
      break;
    case "untrade":
      s.trades = s.trades.filter((t) => t.id !== e.trade.id);
      break;
    case "out":
      s.players[e.seat].out = true;
      break;
    default:
      break;
  }
  return s;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useShow({
  id,
  real,
  mySeat,
  nameOf,
  onLook,
}: {
  id: Id<"matches">;
  real: MonoState;
  mySeat: number;
  nameOf: (seat: number) => string;
  // The camera: look at this square (`fresh`: something new to show, so take the camera back from the hand).
  onLook: (pos: number, fresh: boolean) => void;
}): Shown {
  // Where to play back from: where this phone last looked, or, never having looked, wherever the server
  // starts us (since our own last move), pinned there once it's said, since that moves with every move we make.
  const [from, setFrom] = useState(() => readSeen(id));
  const log = useQuery(api.landlord.log, { id, from });
  const [view, setView] = useState<MonoState | null>(null);
  const viewRef = useRef<MonoState | null>(null);
  const realRef = useRef(real);
  realRef.current = real;
  const queue = useRef<Item[]>([]);
  const queuedTo = useRef<number | null>(null);
  const playedTo = useRef<number | null>(null);
  const running = useRef(false);
  const skipping = useRef(false);
  const [busy, setBusy] = useState(true);
  const [catching, setCatching] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [dice, setDice] = useState<Shown["dice"]>(null);
  const [card, setCard] = useState<Shown["card"]>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [feed, setFeed] = useState<Shown["feed"]>([]);
  const keys = useRef(0);
  const nameRef = useRef(nameOf);
  nameRef.current = nameOf;
  const lookRef = useRef(onLook);
  lookRef.current = onLook;

  const show = (s: MonoState) => {
    viewRef.current = s;
    setView(s);
  };
  const say_ = (e: Ev) => {
    const text = say(e, (seat) => (seat === mySeat ? "you" : nameRef.current(seat)));
    if (!text) return;
    const t = text.replace(/^./, (c) => c.toUpperCase());
    setLine(t);
    setFeed((f) => [...f.slice(-80), { key: ++keys.current, text: t }]);
  };

  // Plays one event: its sound, where the camera looks, and how long it holds the screen.
  const play = useCallback(
    async (item: Item, catchingUp: boolean) => {
      const e = item.ev;
      const fast = skipping.current || document.hidden;
      // Quicker the more there is still to show: a backlog plays through fast, one move at its own pace.
      const backlog = queue.current.length;
      const pace = (catchingUp ? 0.65 : 1) * (backlog > 60 ? 0.35 : backlog > 20 ? 0.6 : 1);
      const hold = async (ms: number) => {
        if (!fast) await wait(ms * pace);
      };
      const s = viewRef.current!;
      const live = !catchingUp;
      switch (e.t) {
        case "move": {
          lookRef.current(e.from, true);
          setHighlight(null);
          const steps = e.how === "walk" ? (e.to - e.from + SIZE) % SIZE : e.how === "back" ? (e.from - e.to + SIZE) % SIZE : 0;
          if (steps > 0 && !fast) {
            let at = e.from;
            for (let i = 0; i < steps; i++) {
              at = (at + (e.how === "back" ? SIZE - 1 : 1)) % SIZE;
              const next = clone(viewRef.current!);
              next.players[e.seat].pos = at;
              show(next);
              lookRef.current(at, false);
              sfx("tick", { live });
              await wait(150 * pace);
            }
          } else {
            show(apply(s, e));
            lookRef.current(e.to, false);
            if (e.how === "jail") sfx("invalid", { live });
            await hold(e.how === "jail" ? 700 : 450);
          }
          show(apply(viewRef.current!, e));
          setHighlight(e.how === "jail" ? null : e.to);
          sfx("land", { count: 1, live });
          await hold(250);
          return;
        }
        case "roll":
          show(apply(s, e));
          setDice({ key: ++keys.current, dice: e.dice, speed: e.speed });
          sfx("shuffle", { live });
          say_(e);
          await hold(850);
          return;
        case "card":
          show(apply(s, e));
          setCard({ key: ++keys.current, deck: e.deck, text: DECKS[e.deck][e.card].text, seat: e.seat });
          sfx("flip", { live });
          say_(e);
          await hold(2400);
          setCard(null);
          return;
        case "pay": {
          show(apply(s, e));
          const f: Float[] = [];
          if (e.from >= 0) f.push({ key: ++keys.current, seat: e.from, amount: -e.amount });
          if (e.to >= 0) f.push({ key: ++keys.current, seat: e.to, amount: e.amount });
          if (f.length && !fast) {
            setFloats((x) => [...x, ...f]);
            setTimeout(() => setFloats((x) => x.filter((y) => !f.includes(y))), 1600);
          }
          if (e.why === "pot") sfx("payout", { live });
          else if (e.why === "rent" || e.why === "buy" || e.why === "auction" || e.why === "card" || e.why === "tax") sfx("chips", { live });
          say_(e);
          await hold(e.why === "go" ? 450 : e.why === "build" || e.why === "sell" ? 150 : 650);
          return;
        }
        case "turn":
          show(apply(s, e));
          setHighlight(null);
          setDice(null);
          lookRef.current(s.players[e.seat].pos, true);
          setLine(e.seat === mySeat ? (e.again ? "Doubles: roll again" : "Your turn") : `${nameRef.current(e.seat)}'s ${e.again ? "roll again" : "turn"}`);
          if (e.seat === mySeat && live) sfx("turn", { live: true });
          await hold(e.again ? 400 : 300);
          return;
        case "build":
          show(apply(s, e));
          lookRef.current(e.pos, true);
          sfx("place", { live });
          say_(e);
          await hold(300);
          return;
        case "own":
          show(apply(s, e));
          await hold(150);
          return;
        case "auction":
          lookRef.current(e.pos, true);
          setHighlight(e.pos);
          sfx("knock", { live });
          say_(e);
          await hold(700);
          return;
        case "sold":
        case "unsold":
          sfx("slam", { live });
          say_(e);
          await hold(700);
          return;
        case "out":
          show(apply(s, e));
          sfx("lose", { live });
          say_(e);
          await hold(1200);
          return;
        default:
          show(apply(s, e));
          say_(e);
          await hold(e.t === "bid" || e.t === "fold" ? 300 : 500);
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mySeat],
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    while (queue.current.length) {
      const item = queue.current.shift()!;
      try {
        await play(item, catchingRef.current);
      } catch (e) {
        // Never wedge the screen on one bad event: drop the rest and settle on the real state.
        console.error(e);
        queue.current = [];
        playedTo.current = queuedTo.current;
        break;
      }
      if (item.end !== undefined) {
        playedTo.current = item.end;
        localStorage.setItem(seenKey(id), String(item.end));
      }
    }
    running.current = false;
    settle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, id]);
  const catchingRef = useRef(false);

  // Caught up with what the log holds: the screen is the real state again, if the log's reached it.
  const settle = () => {
    if (running.current || queue.current.length) return;
    const r = realRef.current;
    if (playedTo.current === null || r.seq <= playedTo.current) {
      // Anyone standing somewhere else than the show left them (no log for it, or skipped): look at whoever's up.
      const was = viewRef.current;
      if (was && r.players.some((p, i) => p.pos !== was.players[i]?.pos)) lookRef.current(r.players[r.current]?.pos ?? 0, false);
      show(r);
      setBusy(false);
      // Caught up: Skip and catching up are over (Skip means up to now, whatever lands while it runs).
      skipping.current = false;
      catchingRef.current = false;
      setCatching(false);
      if (playedTo.current !== null) localStorage.setItem(seenKey(id), String(Math.max(r.seq, playedTo.current)));
    }
  };

  useEffect(() => {
    if (log === undefined) return;
    if (log === null) {
      show(realRef.current);
      setBusy(false);
      return;
    }
    if (queuedTo.current === null) {
      if (from === undefined) setFrom(log.start.seq);
      queuedTo.current = log.start.seq;
      playedTo.current = log.start.seq;
      show(log.start.state);
      lookRef.current(log.start.state.players[log.start.state.current]?.pos ?? 0, true);
      // Somebody else's moves to play back: that's catching up.
      const theirs = log.moves.filter((m) => m.by !== mySeat).reduce((a, m) => a + m.events.length, 0);
      if (theirs > 3) {
        catchingRef.current = true;
        setCatching(true);
      }
    }
    for (const m of log.moves) {
      const end = m.seq + m.events.length;
      if (end <= queuedTo.current!) continue;
      m.events.forEach((ev, i) => {
        if (m.seq + i < queuedTo.current!) return;
        queue.current.push({ ev, by: m.by, end: i === m.events.length - 1 ? end : undefined });
      });
      queuedTo.current = end;
    }
    // A pile-up while you watch (the phone was away with the screen still open) is catching up too, with Skip.
    if (queue.current.length > 120 && !catchingRef.current) {
      catchingRef.current = true;
      setCatching(true);
    }
    if (queue.current.length) void pump();
    else settle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);

  // The real state moved on without anything new in the log yet, or with it all played: settle on it.
  useEffect(() => {
    if (log !== undefined) settle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real]);

  // For tests: what's on screen and what's real.
  useEffect(() => {
    (window as unknown as { __landlord?: unknown }).__landlord = { view: () => viewRef.current, real: () => realRef.current, queued: () => queue.current.length, running: () => running.current, playedTo: () => playedTo.current };
  }, []);

  const skip = useCallback(() => {
    skipping.current = true;
    setCard(null);
    setDice(null);
    setFloats([]);
  }, []);

  // The real state can land a moment before the log that explains it: until that's played, it's still busy.
  const behind = playedTo.current !== null && real.seq > playedTo.current && log !== null;
  return { state: view ?? real, busy: busy || behind || log === undefined, catching, skip, line, dice, card, floats, highlight, feed };
}
