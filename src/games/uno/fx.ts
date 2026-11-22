import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { COLOR_NAME, drawOf, faceOf, isWild, type Card, type Color } from "../../../convex/uno/cards";
import { inHand, next, type LogEntry, type UnoState } from "../../../convex/uno/engine";
import { entryText } from "../../../convex/uno/text";
import { sfx } from "@/sound";

export type P = { x: number; y: number };
export type Geo = {
  w: number;
  h: number;
  c: P;
  ring: number;
  seats: Map<number, P>;
  me: P;
  deck: P;
  pile: P;
  pileW: number;
  deckW: number;
};
export type Flight = { key: number; from: P; to: P; delay: number; card?: Card };
export type Tone = "hit" | "good" | "info" | Color;
export type Burst = { key: number; at: P; text: string; tone: Tone; big?: boolean; sub?: string };
export type Wave = { key: number; color: Color };

type Snap = { flights: Flight[]; bursts: Burst[]; waves: Wave[]; shake: number };

const FLIGHT_MS = 520;
const BURST_MS = 1250;
const BIG_MS = 2600;
const WAVE_MS = 900;
const MAX_FLIGHTS = 8;
const STAGGER_MS = 80;
const TOO_FAR = 4;

export function geometry(w: number, h: number, order: number[]): Geo {
  const c = { x: w / 2, y: h * 0.6 };
  const rx = w / 2 - 38;
  const ry = Math.max(48, c.y - 50);
  const k = order.length;
  const span = k <= 1 ? 0 : Math.min(240, 60 * (k - 1));
  const seats = new Map<number, P>();
  order.forEach((s, i) => {
    const deg = 90 + span / 2 - (k <= 1 ? 0 : (span * i) / (k - 1));
    const r = (deg * Math.PI) / 180;
    seats.set(s, { x: c.x + rx * Math.cos(r), y: c.y - ry * Math.sin(r) });
  });
  const ring = Math.min(124, rx - 30, c.y - 4);
  const pileW = Math.round(Math.min(92, Math.max(64, ((c.y - 92) * 2) / 1.4)));
  const deckW = Math.round(pileW * 0.7);
  const gap = (pileW + deckW) / 2 + 14;
  return {
    w,
    h,
    c,
    ring,
    seats,
    me: { x: c.x, y: h + 80 },
    deck: { x: c.x - gap * 0.45 - 4, y: c.y },
    pile: { x: c.x + gap * 0.55 - 4, y: c.y },
    pileW,
    deckW,
  };
}

export const angleTo = (c: P, p: P) => (Math.atan2(p.x - c.x, c.y - p.y) * 180) / Math.PI;

class FxStore {
  snap: Snap = { flights: [], bursts: [], waves: [], shake: 0 };
  private keys = 0;
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  get = () => this.snap;
  private patch(change: Partial<Snap>) {
    this.snap = { ...this.snap, ...change };
    for (const l of this.listeners) l();
  }
  fly(from: P, to: P, n: number, card?: Card, after = 0) {
    const made: Flight[] = [];
    for (let i = 0; i < Math.min(n, MAX_FLIGHTS); i++)
      made.push({ key: ++this.keys, from, to, delay: after + i * STAGGER_MS, card: i === 0 ? card : undefined });
    if (!made.length) return;
    this.patch({ flights: [...this.snap.flights, ...made] });
    const last = after + made.length * STAGGER_MS + FLIGHT_MS + 80;
    setTimeout(() => this.patch({ flights: this.snap.flights.filter((f) => !made.includes(f)) }), last);
  }
  burst(at: P, text: string, tone: Tone, more: { big?: boolean; sub?: string; after?: number } = {}) {
    const b: Burst = { key: ++this.keys, at, text, tone, big: more.big, sub: more.sub };
    const show = () => {
      this.patch({ bursts: [...this.snap.bursts.filter((x) => !(more.big && x.big)), b] });
      setTimeout(() => this.patch({ bursts: this.snap.bursts.filter((x) => x !== b) }), more.big ? BIG_MS : BURST_MS);
    };
    if (more.after) setTimeout(show, more.after);
    else show();
  }
  wave(color: Color) {
    const w = { key: ++this.keys, color };
    this.patch({ waves: [...this.snap.waves, w] });
    setTimeout(() => this.patch({ waves: this.snap.waves.filter((x) => x !== w) }), WAVE_MS);
  }
  shakeHand() {
    this.patch({ shake: this.snap.shake + 1 });
  }
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

export function useFx({
  view,
  jumped,
  me,
  geo,
  names,
  tappedRef,
}: {
  view: UnoState;
  jumped: boolean;
  me: number;
  geo: Geo | null;
  names: (seat: number) => string;
  tappedRef: { current: { card: Card; at: P } | null };
}) {
  const [store] = useState(() => new FxStore());
  const snap = useSyncExternalStore(store.subscribe, store.get);
  const prev = useRef(view);
  const geoRef = useRef(geo);
  const namesRef = useRef(names);
  useEffect(() => {
    geoRef.current = geo;
    namesRef.current = names;
  });

  useEffect(() => {
    const was = prev.current;
    prev.current = view;
    if (was === view || (was.seq === view.seq && was.hand === view.hand)) return;
    const g = geoRef.current;
    const name = namesRef.current;
    if (!g || jumped || view.seq < was.seq || view.seq - was.seq > TOO_FAR) return;
    const at = (seat: number) => (seat === me ? g.me : (g.seats.get(seat) ?? g.c));
    const atBurst = (seat: number) => (seat === me ? { x: g.c.x, y: g.h - 24 } : { x: at(seat).x, y: at(seat).y - 34 });
    const hit = (e: LogEntry, text: string) => {
      sfx("slam", { live: true });
      store.shakeHand();
      toast(text, { id: `uno-hit-${e.seq}-${e.kind}` });
    };
    const fresh = view.log.filter((e) => e.seq > was.seq);
    const played = fresh.find((e) => e.kind === "play" || e.kind === "jump");
    let delay = 0;
    for (const e of fresh) {
      switch (e.kind) {
        case "play":
        case "jump": {
          const card = e.card!;
          if (e.seat === me) tappedRef.current = null;
          sfx("play", { live: true });
          if (e.kind === "jump") store.burst(atBurst(e.seat), "Jump in!", "good");
          const face = faceOf(card);
          if (face === "S") store.burst(atBurst(next(was, e.seat)), "Skip", "hit", { after: 250 });
          if (face === "SA") for (const i of inHand(was)) if (i !== e.seat) store.burst(atBurst(i), "Skip", "hit", { after: 250 });
          if (face === "R" || face === "WR4") store.burst({ x: g.c.x, y: g.c.y - g.ring - 4 }, "Reverse", "info", { after: 200 });
          if (face === "DA") store.burst(atBurst(e.seat), "Discard all", e.color ?? "info", { after: 200 });
          const d = drawOf(card);
          if (d) store.burst({ x: g.pile.x, y: g.pile.y - 24 }, `+${d}`, "hit", { after: 220 });
          if (isWild(card) && e.color) {
            store.wave(e.color);
            store.burst({ x: g.pile.x, y: g.pile.y + 70 }, COLOR_NAME[e.color], e.color, { after: 300 });
          }
          delay = 420;
          break;
        }
        case "draw":
          store.fly(g.deck, at(e.seat), e.n ?? 1, undefined, delay);
          sfx("deal", { live: true });
          break;
        case "take": {
          store.fly(g.deck, at(e.seat), e.n ?? 0, undefined, delay);
          store.burst(atBurst(e.seat), `+${e.n}`, "hit", { after: delay + 200 });
          if (e.seat === me) {
            const by = played && played.seat !== me ? played.seat : null;
            if (by !== null) hit(e, `+${e.n} from ${name(by)}`);
          }
          break;
        }
        case "pass":
          store.burst(atBurst(e.seat), "Keeps it", "info");
          break;
        case "challenge": {
          const loser = e.guilty ? e.target! : e.seat;
          store.burst(atBurst(e.target!), e.guilty ? "Bluff!" : "Clean", e.guilty ? "hit" : "good");
          store.fly(g.deck, at(loser), e.n ?? 4, undefined, 300);
          if (e.guilty && e.target === me) hit(e, cap(entryText(e, name)));
          break;
        }
        case "roulette":
          store.wave(e.color!);
          store.fly(g.deck, at(e.seat), e.n ?? 1, undefined, 0);
          store.burst(atBurst(e.seat), `+${e.n} for ${COLOR_NAME[e.color!]}`, e.color!, { after: 300 });
          sfx("deal", { live: true });
          break;
        case "catch":
          store.burst(atBurst(e.target!), "Caught!", "hit");
          store.fly(g.deck, at(e.target!), e.n ?? 2, undefined, 200);
          if (e.target === me) hit(e, cap(entryText(e, name)));
          break;
        case "uno":
          store.burst(atBurst(e.seat), "UNO!", "good");
          sfx("knock", { live: true });
          break;
        case "swap":
          store.fly(at(e.seat), at(e.target!), 3);
          store.fly(at(e.target!), at(e.seat), 3);
          store.burst(g.c, "Swap!", "info", { after: 150 });
          sfx("shuffle", { live: true });
          if (e.target === me) hit(e, cap(entryText(e, name)));
          break;
        case "rotate": {
          const seats = inHand(view);
          for (const i of seats) store.fly(at(i), at(next(view, i)), 1);
          store.burst(g.c, "Pass it on", "info", { after: 150 });
          sfx("shuffle", { live: true });
          if (e.seat !== me && seats.includes(me)) toast(`${cap(name(e.seat))} passed every hand along`, { id: `uno-rotate-${e.seq}` });
          break;
        }
        case "mercy":
          store.burst(atBurst(e.seat), "Mercy", "hit", { after: 500 });
          break;
        case "leave":
          store.burst(atBurst(e.seat), "Left", "info");
          break;
      }
    }
    const r = view.last;
    if (r && (view.hand !== was.hand || (view.over && !was.over)) && r.hand === was.hand) {
      store.burst(g.c, r.winner === me ? "You win the hand" : `${cap(name(r.winner))} wins the hand`, "good", {
        big: true,
        sub: `+${r.points}`,
        after: 500,
      });
      if (!view.over) sfx(r.winner === me ? "win" : "flip", { live: true });
    }
    if (view.turn === me && was.turn !== me && view.hand === was.hand && !view.over) sfx("turn", { live: true });
  }, [view, jumped, me, store, tappedRef]);

  return snap;
}
