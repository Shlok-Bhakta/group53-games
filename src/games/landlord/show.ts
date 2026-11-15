import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import { SIZE } from "../../../convex/landlord/board";
import { DECKS, type Deck } from "../../../convex/landlord/cards";
import type { Ev, MonoState, Why } from "../../../convex/landlord/engine";
import { say } from "../../../convex/landlord/text";
import { sfx } from "@/sound";

export type Float = { key: number; seat: number; amount: number };
export type Shown = {
  state: MonoState;
  busy: boolean;
  catching: boolean;
  skip: () => void;
  line: string | null;
  dice: { key: number; dice: number[]; speed?: number } | null;
  card: { key: number; deck: Deck; text: string; seat: number } | null;
  floats: Float[];
  highlight: number | null;
  feed: { key: number; text: string }[];
};

const seenKey = (id: string) => `landlord-seen:${id}`;
const readSeen = (id: string) => {
  const v = Number(localStorage.getItem(seenKey(id)));
  return Number.isFinite(v) && localStorage.getItem(seenKey(id)) !== null ? v : undefined;
};

type Item = { ev: Ev; end?: number; by: number };

const clone = (s: MonoState): MonoState => ({
  ...s,
  players: s.players.map((p) => ({ ...p, free: [...p.free] })),
  props: s.props.map((p) => (p ? { ...p } : p)),
  bank: { ...s.bank },
  trades: [...s.trades],
});

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
const capitalized = (text: string) => text.replace(/^./, (c) => c.toUpperCase());

type LogPage = NonNullable<FunctionReturnType<typeof api.landlord.log>>;
type Inputs = { real: MonoState; mySeat: number; nameOf: (seat: number) => string; onLook: (pos: number, fresh: boolean) => void };
type Snapshot = Omit<Shown, "state" | "skip"> & { view: MonoState | null; from: number | undefined; playedTo: number | null };

const HOP_MS = 150;
const FLOAT_MS = 1600;
const FEED_KEPT = 80;
const CATCH_UP_PACE = 0.65;
const CATCH_UP_EVENTS = 3;
const PILE_UP_EVENTS = 120;
const CHIPS_SOUND = new Set<Why>(["rent", "buy", "auction", "card", "tax"]);
const backlogPace = (backlog: number) => (backlog > 60 ? 0.35 : backlog > 20 ? 0.6 : 1);

class ShowRunner {
  snap: Snapshot;
  inputs: Inputs;
  queue: Item[] = [];
  queuedTo: number | null = null;
  running = false;
  private skipping = false;
  private catchingUp = false;
  private stopped = false;
  private keys = 0;
  private listeners = new Set<() => void>();

  constructor(
    private id: string,
    inputs: Inputs,
  ) {
    this.inputs = inputs;
    this.snap = {
      view: null,
      from: readSeen(id),
      playedTo: null,
      busy: true,
      catching: false,
      line: null,
      dice: null,
      card: null,
      floats: [],
      highlight: null,
      feed: [],
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = () => this.snap;

  private patch(change: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...change };
    for (const listener of this.listeners) listener();
  }
  private show(view: MonoState) {
    this.patch({ view });
  }
  private narrate(e: Ev) {
    const { mySeat, nameOf } = this.inputs;
    const text = say(e, (seat) => (seat === mySeat ? "you" : nameOf(seat)));
    if (!text) return;
    const line = capitalized(text);
    this.patch({ line, feed: [...this.snap.feed.slice(-FEED_KEPT), { key: ++this.keys, text: line }] });
  }
  private startCatchingUp() {
    this.catchingUp = true;
    this.patch({ catching: true });
  }
  private markSeen(seq: number) {
    localStorage.setItem(seenKey(this.id), String(seq));
  }

  use(inputs: Inputs) {
    this.inputs = inputs;
  }

  start() {
    this.stopped = false;
    if (this.queue.length) void this.pump();
  }
  stop() {
    this.stopped = true;
  }

  skip = () => {
    this.skipping = true;
    this.patch({ card: null, dice: null, floats: [] });
  };

  feed(log: LogPage) {
    const { mySeat, onLook } = this.inputs;
    if (this.queuedTo === null) {
      this.queuedTo = log.start.seq;
      this.patch({ playedTo: log.start.seq, ...(this.snap.from === undefined ? { from: log.start.seq } : {}) });
      this.show(log.start.state);
      onLook(log.start.state.players[log.start.state.current]?.pos ?? 0, true);
      const theirs = log.moves.filter((m) => m.by !== mySeat).reduce((a, m) => a + m.events.length, 0);
      if (theirs > CATCH_UP_EVENTS) this.startCatchingUp();
    }
    for (const m of log.moves) {
      const end = m.seq + m.events.length;
      if (end <= this.queuedTo) continue;
      const queuedTo = this.queuedTo;
      m.events.forEach((ev, i) => {
        if (m.seq + i < queuedTo) return;
        this.queue.push({ ev, by: m.by, end: i === m.events.length - 1 ? end : undefined });
      });
      this.queuedTo = end;
    }
    if (this.queue.length > PILE_UP_EVENTS && !this.catchingUp) this.startCatchingUp();
    if (this.queue.length) void this.pump();
    else this.settle();
  }

  settle() {
    if (this.running || this.queue.length) return;
    const { real, onLook } = this.inputs;
    const played = this.snap.playedTo;
    if (played !== null && real.seq > played) return;
    const was = this.snap.view;
    if (was && real.players.some((p, i) => p.pos !== was.players[i]?.pos)) onLook(real.players[real.current]?.pos ?? 0, false);
    this.show(real);
    this.skipping = false;
    this.catchingUp = false;
    this.patch({ busy: false, catching: false });
    if (played !== null) this.markSeen(Math.max(real.seq, played));
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    this.patch({ busy: true });
    while (this.queue.length && !this.stopped) {
      const item = this.queue.shift()!;
      try {
        await this.play(item, this.catchingUp);
      } catch (e) {
        console.error(e);
        this.queue = [];
        this.patch({ playedTo: this.queuedTo });
        break;
      }
      if (item.end !== undefined) {
        this.patch({ playedTo: item.end });
        this.markSeen(item.end);
      }
    }
    this.running = false;
    this.settle();
  }

  private async play(item: Item, catchingUp: boolean) {
    const { mySeat, nameOf, onLook } = this.inputs;
    const e = item.ev;
    const fast = this.skipping || document.hidden;
    const pace = (catchingUp ? CATCH_UP_PACE : 1) * backlogPace(this.queue.length);
    const hold = async (ms: number) => {
      if (!fast) await wait(ms * pace);
    };
    const s = this.snap.view!;
    const live = !catchingUp;
    switch (e.t) {
      case "move": {
        onLook(e.from, true);
        this.patch({ highlight: null });
        const steps = e.how === "walk" ? (e.to - e.from + SIZE) % SIZE : e.how === "back" ? (e.from - e.to + SIZE) % SIZE : 0;
        if (steps > 0 && !fast) {
          let at = e.from;
          for (let i = 0; i < steps; i++) {
            at = (at + (e.how === "back" ? SIZE - 1 : 1)) % SIZE;
            const next = clone(this.snap.view!);
            next.players[e.seat].pos = at;
            this.show(next);
            onLook(at, false);
            sfx("tick", { live });
            await wait(HOP_MS * pace);
          }
        } else {
          this.show(apply(s, e));
          onLook(e.to, false);
          if (e.how === "jail") sfx("invalid", { live });
          await hold(e.how === "jail" ? 700 : 450);
        }
        this.show(apply(this.snap.view!, e));
        this.patch({ highlight: e.how === "jail" ? null : e.to });
        sfx("land", { count: 1, live });
        await hold(250);
        return;
      }
      case "roll":
        this.show(apply(s, e));
        this.patch({ dice: { key: ++this.keys, dice: e.dice, speed: e.speed } });
        sfx("shuffle", { live });
        this.narrate(e);
        await hold(850);
        return;
      case "card":
        this.show(apply(s, e));
        this.patch({ card: { key: ++this.keys, deck: e.deck, text: DECKS[e.deck][e.card].text, seat: e.seat } });
        sfx("flip", { live });
        this.narrate(e);
        await hold(2400);
        this.patch({ card: null });
        return;
      case "pay": {
        this.show(apply(s, e));
        const f: Float[] = [];
        if (e.from >= 0) f.push({ key: ++this.keys, seat: e.from, amount: -e.amount });
        if (e.to >= 0) f.push({ key: ++this.keys, seat: e.to, amount: e.amount });
        if (f.length && !fast) {
          this.patch({ floats: [...this.snap.floats, ...f] });
          setTimeout(() => this.patch({ floats: this.snap.floats.filter((y) => !f.includes(y)) }), FLOAT_MS);
        }
        if (e.why === "pot") sfx("payout", { live });
        else if (CHIPS_SOUND.has(e.why)) sfx("chips", { live });
        this.narrate(e);
        await hold(e.why === "go" ? 450 : e.why === "build" || e.why === "sell" ? 150 : 650);
        return;
      }
      case "turn":
        this.show(apply(s, e));
        this.patch({
          highlight: null,
          dice: null,
          line:
            e.seat === mySeat ? (e.again ? "Doubles: roll again" : "Your turn") : `${nameOf(e.seat)}'s ${e.again ? "roll again" : "turn"}`,
        });
        onLook(s.players[e.seat].pos, true);
        if (e.seat === mySeat && live) sfx("turn", { live: true });
        await hold(e.again ? 400 : 300);
        return;
      case "build":
        this.show(apply(s, e));
        onLook(e.pos, true);
        sfx("place", { live });
        this.narrate(e);
        await hold(300);
        return;
      case "own":
        this.show(apply(s, e));
        await hold(150);
        return;
      case "auction":
        onLook(e.pos, true);
        this.patch({ highlight: e.pos });
        sfx("knock", { live });
        this.narrate(e);
        await hold(700);
        return;
      case "sold":
      case "unsold":
        sfx("slam", { live });
        this.narrate(e);
        await hold(700);
        return;
      case "out":
        this.show(apply(s, e));
        sfx("lose", { live });
        this.narrate(e);
        await hold(1200);
        return;
      default:
        this.show(apply(s, e));
        this.narrate(e);
        await hold(e.t === "bid" || e.t === "fold" ? 300 : 500);
        return;
    }
  }
}

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
  onLook: (pos: number, fresh: boolean) => void;
}): Shown {
  const [runner] = useState(() => new ShowRunner(id, { real, mySeat, nameOf, onLook }));
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const log = useQuery(api.landlord.log, { id, from: snap.from });

  useEffect(() => {
    runner.use({ real, mySeat, nameOf, onLook });
  });
  useEffect(() => {
    runner.start();
    return () => runner.stop();
  }, [runner]);
  useEffect(() => {
    if (log) runner.feed(log);
  }, [log, runner]);
  const settleOnReal = useEffectEvent(() => {
    if (log !== undefined) runner.settle();
  });
  useEffect(() => settleOnReal(), [real]);

  useEffect(() => {
    (window as unknown as { __landlord?: unknown }).__landlord = {
      view: () => runner.snap.view,
      real: () => runner.inputs.real,
      queued: () => runner.queue.length,
      running: () => runner.running,
      playedTo: () => runner.snap.playedTo,
    };
  }, [runner]);

  const { view, playedTo, from: _from, ...shown } = snap;
  if (log === null) return { ...shown, skip: runner.skip, state: real, busy: false };
  const behind = playedTo !== null && real.seq > playedTo;
  return { ...shown, skip: runner.skip, state: view ?? real, busy: shown.busy || behind || log === undefined };
}
