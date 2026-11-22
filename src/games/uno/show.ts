import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { faceOf, isNumber } from "../../../convex/uno/cards";
import type { LogEntry, UnoState } from "../../../convex/uno/engine";

type LogPage = NonNullable<FunctionReturnType<typeof api.uno.log>>;
type Row = LogPage["moves"][number];
type Snap = { view: UnoState | null; catching: boolean; jumped: boolean };

export type Shown = { state: UnoState; catching: boolean; jumped: boolean; skip: () => void };

const CATCH_UP_MOVES = 1;
const MINE_MS = 350;

const seenKey = (id: string) => `uno-seen:${id}`;
function readSeen(id: string) {
  try {
    const raw = localStorage.getItem(seenKey(id));
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}
function markSeen(id: string, seq: number) {
  try {
    if ((readSeen(id) ?? -1) < seq) localStorage.setItem(seenKey(id), String(seq));
  } catch {
    return;
  }
}

function entryMs(e: LogEntry) {
  switch (e.kind) {
    case "play":
    case "jump":
      return e.card && isNumber(e.card) ? 750 : faceOf(e.card ?? "r0").startsWith("W") ? 1200 : 1000;
    case "draw":
    case "take":
      return 600 + Math.min(e.n ?? 1, 8) * 90;
    case "swap":
    case "rotate":
      return 1300;
    case "challenge":
    case "catch":
    case "roulette":
      return 1300;
    case "mercy":
      return 1400;
    default:
      return 600;
  }
}

export function holdFor(before: UnoState, after: UnoState) {
  if (after.hand !== before.hand || (after.over && !before.over)) return 2800;
  const fresh = after.log.filter((e) => e.seq > before.seq);
  return fresh.reduce((a, e) => Math.max(a, entryMs(e)), 500);
}

const paceOf = (left: number) => (left > 20 ? 0.4 : left > 6 ? 0.65 : 1);

function withLog(row: UnoState, real: UnoState): UnoState {
  const older = real.log.filter((e) => e.seq <= row.seq && !row.log.some((x) => x.seq === e.seq));
  return { ...row, log: [...older, ...row.log].sort((a, b) => a.seq - b.seq) };
}

class Show {
  snap: Snap = { view: null, catching: false, jumped: false };
  real: UnoState;
  mySeat: number;
  private queue: Row[] = [];
  private queuedTo: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private id: string,
    real: UnoState,
    mySeat: number,
  ) {
    this.real = real;
    this.mySeat = mySeat;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = () => this.snap;

  private patch(change: Partial<Snap>) {
    this.snap = { ...this.snap, ...change };
    for (const listener of this.listeners) listener();
  }

  feed(page: LogPage | null) {
    if (page === null) {
      this.queuedTo = Math.max(this.queuedTo ?? -1, this.real.seq);
      this.settle();
      return;
    }
    if (this.queuedTo === null) {
      this.queuedTo = page.start.seq;
      const theirs = page.moves.filter((m) => m.seq > page.start.seq && m.by !== this.mySeat).length;
      this.patch({ view: withLog(page.start.state, this.real), catching: theirs > CATCH_UP_MOVES, jumped: true });
    }
    for (const m of page.moves) {
      if (m.seq <= this.queuedTo) continue;
      this.queue.push(m);
      this.queuedTo = m.seq;
    }
    this.pump();
  }

  private pump() {
    if (this.timer) return;
    const row = this.queue.shift();
    if (!row) return this.settle();
    const before = this.snap.view ?? row.state;
    const view = withLog(row.state, this.real);
    this.patch({ view, jumped: false });
    markSeen(this.id, row.seq);
    const mine = row.by === this.mySeat && !this.snap.catching;
    const hold = document.hidden ? 0 : mine ? MINE_MS : holdFor(before, view) * paceOf(this.queue.length);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, hold);
  }

  settle() {
    if (this.timer || this.queue.length) return;
    const view = this.snap.view;
    if (view && view.seq > this.real.seq) return;
    this.queuedTo = Math.max(this.queuedTo ?? -1, this.real.seq);
    this.patch({ view: this.real, catching: false, jumped: false });
    markSeen(this.id, this.real.seq);
  }

  skip = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.queuedTo = Math.max(this.queuedTo ?? -1, this.real.seq);
    this.patch({ view: this.real, catching: false, jumped: true });
    markSeen(this.id, this.real.seq);
  };

  use(real: UnoState, mySeat: number) {
    this.real = real;
    this.mySeat = mySeat;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  resume() {
    if (this.queue.length) this.pump();
  }
}

export function useShow({ id, real, mySeat }: { id: Id<"matches">; real: UnoState; mySeat: number }): Shown {
  const [show] = useState(() => new Show(id, real, mySeat));
  const [from, setFrom] = useState(() => readSeen(id));
  const snap = useSyncExternalStore(show.subscribe, show.getSnapshot);
  const log = useQuery(api.uno.log, { id, from });
  if (from === undefined && log) setFrom(log.start.seq);

  useEffect(() => {
    show.use(real, mySeat);
  });
  useEffect(() => {
    show.resume();
    return () => show.stop();
  }, [show]);
  useEffect(() => {
    if (log !== undefined) show.feed(log);
  }, [log, show]);
  const settleOnReal = useEffectEvent(() => {
    if (log !== undefined) show.settle();
  });
  useEffect(() => settleOnReal(), [real]);

  return { state: snap.view ?? real, catching: snap.catching, jumped: snap.jumped, skip: show.skip };
}
