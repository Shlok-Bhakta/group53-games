import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MatchView } from "../../../convex/matches";
import { COLOR_NAME, isWild, type Card, type Color } from "../../../convex/uno/cards";
import { isOutOfHand, type UnoState } from "../../../convex/uno/engine";
import { entryText } from "../../../convex/uno/text";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { UnoCard } from "./Card";
import { angleTo, type Burst, type Flight, type Geo, type P, type Tone, type Wave } from "./fx";

type Fx = { flights: Flight[]; bursts: Burst[]; waves: Wave[] };

const uno = (c: Color, pct = 100) =>
  pct === 100 ? `var(--color-uno-${c})` : `color-mix(in srgb, var(--color-uno-${c}) ${pct}%, transparent)`;

export function Table({
  boxRef: ref,
  match,
  state,
  seat,
  geo,
  fx,
  canDraw,
  onDraw,
  onBox,
  onPlayer,
  origin,
  corner,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  match: MatchView;
  state: UnoState;
  seat: number;
  geo: Geo | null;
  fx: Fx;
  canDraw: boolean;
  onDraw: () => void;
  onBox: (box: { w: number; h: number }) => void;
  onPlayer: (seat: number) => void;
  origin: (seat: number, card: Card) => P;
  corner: ReactNode;
}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => onBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onBox, ref]);
  const last = state.log.at(-1);
  const name = (i: number) => (i === seat ? "you" : (match.players[i]?.name ?? "Someone"));
  const lastText = last ? entryText(last, name) : "";
  return (
    <div
      ref={ref}
      className="relative min-h-[236px] flex-1 phone-landscape:w-full"
      data-top={state.top}
      data-color={state.color}
      data-seq={state.seq}
      role="group"
      aria-label="Table"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.div
            key={state.color}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background: geo
                ? `radial-gradient(circle at ${geo.c.x}px ${geo.c.y}px, ${uno(state.color, 26)}, transparent ${Math.round(geo.ring * 1.6)}px)`
                : undefined,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        </AnimatePresence>
        {geo && <Beam geo={geo} state={state} seat={seat} active={match.status === "active"} />}
      </div>
      {geo && (
        <>
          <Ring geo={geo} state={state} />
          {[...geo.seats].map(([i, at]) => (
            <Seat key={i} match={match} state={state} i={i} at={at} onTap={() => onPlayer(i)} />
          ))}
          <Piles geo={geo} state={state} canDraw={canDraw} onDraw={onDraw} origin={origin} name={name} />
          <Waves geo={geo} waves={fx.waves} />
          <Flights flights={fx.flights} />
          <Bursts bursts={fx.bursts} w={geo.w} />
        </>
      )}
      <div className="absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between px-1">{corner}</div>
      <p className="absolute inset-x-0 bottom-0 h-5 truncate px-2 text-center text-footnote text-muted-foreground" data-last={last?.kind}>
        {lastText ? lastText[0].toUpperCase() + lastText.slice(1) : ""}
      </p>
    </div>
  );
}

function useTurning(target: number) {
  const [angle, setAngle] = useState(target);
  const [aim, setAim] = useState(target);
  if (aim !== target) {
    setAim(target);
    setAngle(angle + ((((target - angle) % 360) + 540) % 360) - 180);
  }
  return angle;
}

function Beam({ geo, state, seat, active }: { geo: Geo; state: UnoState; seat: number; active: boolean }) {
  const up = state.turn;
  const target = up === seat || up < 0 ? 180 : angleTo(geo.c, geo.seats.get(up) ?? geo.me);
  const angle = useTurning(target);
  const size = Math.max(geo.w, geo.h);
  if (!active || up < 0) return null;
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute rounded-full"
      style={{
        left: geo.c.x - size / 2,
        top: geo.c.y - size / 2,
        width: size,
        height: size,
        background: `conic-gradient(from -16deg, ${uno(state.color, 24)} 0deg, ${uno(state.color, 6)} 32deg, transparent 33deg)`,
        maskImage: "radial-gradient(closest-side, black 15%, transparent 80%)",
      }}
      initial={false}
      animate={{ rotate: angle }}
      transition={{ type: "spring", bounce: 0.15, duration: 0.6 }}
    />
  );
}

function Ring({ geo, state }: { geo: Geo; state: UnoState }) {
  const r = geo.ring;
  const turns = useTurnCount(state);
  const arrows = [0, 120, 240];
  return (
    <motion.svg
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: geo.c.x - r - 8, top: geo.c.y - r - 8, width: 2 * r + 16, height: 2 * r + 16, color: uno(state.color, 55) }}
      viewBox={`${-r - 8} ${-r - 8} ${2 * r + 16} ${2 * r + 16}`}
      initial={false}
      animate={{ rotate: turns * 24 }}
      transition={{ type: "spring", bounce: 0.2, duration: 0.8 }}
    >
      <circle r={r} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="2 10" strokeLinecap="round" />
      <motion.g initial={false} animate={{ scaleX: state.dir }} transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}>
        {arrows.map((a) => (
          <path
            key={a}
            d={`M -7 -6 L 4 0 L -7 6`}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={`rotate(${a - 90}) translate(${r} 0) rotate(90)`}
          />
        ))}
      </motion.g>
    </motion.svg>
  );
}

function useTurnCount(state: UnoState) {
  const [count, setCount] = useState(0);
  const [at, setAt] = useState(state.seq);
  if (at !== state.seq) {
    setAt(state.seq);
    setCount(count + (state.seq > at ? state.dir : 0));
  }
  return count;
}

function Seat({ match, state, i, at, onTap }: { match: MatchView; state: UnoState; i: number; at: P; onTap: () => void }) {
  const pl = match.players[i];
  const out = isOutOfHand(state, i);
  const up = state.turn === i && match.status === "active";
  const count = state.counts[i];
  const fan = Math.min(count, 6);
  return (
    <Button
      variant="bare"
      size="overlay"
      data-seat={i}
      data-count={count}
      data-up={up || undefined}
      onClick={onTap}
      aria-label={`${pl.name}: ${out ? "out" : `${count} cards`}`}
      className={cn("absolute flex w-[76px] flex-col items-center gap-0.5 rounded-md", out && "opacity-45")}
      style={{ left: at.x, top: at.y, translate: "-50% -50%" }}
    >
      <span className="relative flex h-5 w-full justify-center" aria-hidden="true">
        {Array.from({ length: fan }, (_, k) => (
          <motion.span
            key={k}
            className="absolute bottom-[-10px]"
            style={{ transformOrigin: "50% 140%" }}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0, rotate: (k - (fan - 1) / 2) * 11 }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
          >
            <UnoCard width={18} />
          </motion.span>
        ))}
      </span>
      <span className="relative">
        {up && (
          <span
            className="absolute -inset-1 rounded-full ring-2 motion-safe:animate-ping"
            style={{ color: uno(state.color) }}
            aria-hidden="true"
          />
        )}
        <span
          className={cn("block rounded-full transition-shadow duration-200", up && "ring-3 ring-offset-2 ring-offset-background")}
          style={up ? { color: uno(state.color) } : undefined}
        >
          <PlayerAvatar player={pl} size={44} seat={seatColor(pl, out)} />
        </span>
        <motion.span
          key={count}
          initial={{ scale: 1.5 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", bounce: 0.5, duration: 0.4 }}
          className="absolute -right-3 -bottom-1 flex min-w-6 items-center justify-center gap-0.5 rounded-full bg-card px-1.5 font-display text-footnote tabular-nums shadow-md"
        >
          {out ? "out" : count}
        </motion.span>
        <AnimatePresence>
          {count === 1 && !out && (
            <motion.span
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: -8 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", bounce: 0.5, duration: 0.4 }}
              className={cn(
                "absolute -top-2 -left-4 rounded-full px-1.5 font-display text-caption shadow-md",
                state.forgot === i ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground",
              )}
            >
              {state.forgot === i ? "No UNO!" : "UNO"}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="max-w-full truncate text-caption text-muted-foreground">
        {state.rules.goal ? `${pl.name} · ${state.scores[i]}` : pl.name}
      </span>
    </Button>
  );
}

const tilt = (key: string) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return { rotate: (h % 19) - 9, x: (h % 9) - 4, y: ((h >> 2) % 7) - 3 };
};

function Piles({
  geo,
  state,
  canDraw,
  onDraw,
  origin,
  name,
}: {
  geo: Geo;
  state: UnoState;
  canDraw: boolean;
  onDraw: () => void;
  origin: (seat: number, card: Card) => P;
  name: (i: number) => string;
}) {
  const plays = state.log.filter((e) => e.hand === state.hand && (e.kind === "play" || e.kind === "jump"));
  const pile = state.recent.slice(-4).map((card, i, arr) => {
    const fromEnd = arr.length - 1 - i;
    const e = plays[plays.length - 1 - fromEnd];
    return { card, key: e && e.card === card ? `${state.hand}:${e.seq}` : `${state.hand}:start:${card}` };
  });
  const top = pile.at(-1);
  const lastPlay = plays.at(-1);
  const came = top && lastPlay && lastPlay.card === top.card ? origin(lastPlay.seat, lastPlay.card) : null;
  const entry = came ? { x: came.x - geo.pile.x, y: came.y - geo.pile.y } : null;
  const p = state.pending;
  return (
    <>
      <div className="absolute flex flex-col items-center gap-1" style={{ left: geo.deck.x, top: geo.deck.y, translate: "-50% -50%" }}>
        <Button
          variant="bare"
          size="overlay"
          aria-label={canDraw ? "Draw a card" : "Draw pile"}
          disabled={!canDraw}
          onClick={onDraw}
          className={cn("relative rounded-md disabled:opacity-100", canDraw && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
        >
          <UnoCard width={geo.deckW} className="absolute top-1.5 left-1.5" />
          <UnoCard width={geo.deckW} className="absolute top-0.5 left-0.5" />
          <UnoCard width={geo.deckW} />
        </Button>
        <span className="text-caption text-muted-foreground tabular-nums">{state.left} left</span>
      </div>
      <div
        className="absolute"
        style={{ left: geo.pile.x, top: geo.pile.y, width: geo.pileW, height: geo.pileW * 1.4, translate: "-50% -50%" }}
        aria-label={`${COLOR_NAME[state.color]} is up`}
        role="img"
        data-pile
      >
        <AnimatePresence initial={false}>
          {pile.map(({ card, key }) => {
            const t = tilt(key);
            const isTop = key === top?.key;
            const from = isTop ? entry : null;
            return (
              <motion.span
                key={key}
                className="absolute inset-0"
                initial={from ? { x: from.x, y: from.y, rotate: t.rotate - 50, scale: 0.7 } : { opacity: 0, scale: 1.2 }}
                animate={{ x: t.x, y: t.y, rotate: t.rotate, scale: 1, opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.3 } }}
                transition={{ type: "spring", bounce: 0.28, duration: 0.5 }}
              >
                <UnoCard
                  card={card}
                  width={geo.pileW}
                  chosen={isTop && isWild(card) ? state.color : undefined}
                  style={isTop ? { boxShadow: `0 0 0 3px ${uno(state.color)}, 0 0 24px ${uno(state.color, 70)}` } : undefined}
                />
              </motion.span>
            );
          })}
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-x-0 -bottom-4 z-10 flex justify-center">
          <AnimatePresence>
            {p && (
              <motion.span
                key={p.kind}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: "spring", bounce: 0.5 }}
                className="rounded-full bg-destructive px-3 py-1 font-display text-callout whitespace-nowrap text-destructive-foreground shadow-md"
                data-pending={p.kind === "draw" ? p.amount : "roulette"}
              >
                <motion.span
                  key={p.kind === "draw" ? p.amount : 0}
                  className="inline-block"
                  initial={{ scale: 1.5 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", bounce: 0.5 }}
                >
                  {p.kind === "draw" ? `+${p.amount} on ${name(state.turn)}` : `Roulette for ${name(state.turn)}`}
                </motion.span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

function Waves({ geo, waves }: { geo: Geo; waves: Wave[] }) {
  return (
    <AnimatePresence>
      {waves.map((w) => (
        <motion.span
          key={w.key}
          aria-hidden="true"
          className="pointer-events-none absolute size-24 rounded-full border-8"
          style={{ left: geo.pile.x - 48, top: geo.pile.y - 48, borderColor: uno(w.color, 80) }}
          initial={{ scale: 0.3, opacity: 1 }}
          animate={{ scale: 6, opacity: 0 }}
          transition={{ duration: 0.85, ease: "easeOut" }}
        />
      ))}
    </AnimatePresence>
  );
}

function Flights({ flights }: { flights: Flight[] }) {
  return (
    <>
      {flights.map((f) => (
        <motion.span
          key={f.key}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 z-20"
          style={{ translate: "-50% -50%" }}
          initial={{ x: f.from.x, y: f.from.y, scale: 0.9, rotate: -20, opacity: 0 }}
          animate={{ x: f.to.x, y: f.to.y, scale: 0.55, rotate: 15, opacity: [0, 1, 1, 0.6] }}
          transition={{ duration: 0.52, delay: f.delay / 1000, ease: [0.3, 0.7, 0.4, 1] }}
        >
          <UnoCard card={f.card} width={44} />
        </motion.span>
      ))}
    </>
  );
}

const TONE: Record<"hit" | "good" | "info", string> = {
  hit: "bg-destructive text-destructive-foreground",
  good: "bg-primary text-primary-foreground",
  info: "bg-card text-foreground",
};

const toneClass = (tone: Tone) => (tone in TONE ? TONE[tone as keyof typeof TONE] : "text-paper");

function Bursts({ bursts, w }: { bursts: Burst[]; w: number }) {
  return (
    <AnimatePresence>
      {bursts.map((b) => (
        <motion.span
          key={b.key}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-0 left-0 z-30 flex flex-col items-center rounded-lg font-display whitespace-nowrap shadow-lg",
            b.big ? "px-5 py-3 text-title" : "px-3 py-1 text-heading",
            toneClass(b.tone),
          )}
          style={{
            translate: "-50% -50%",
            left: Math.min(Math.max(b.at.x, b.big ? w / 2 : 64), w - 64),
            top: b.at.y,
            background: b.tone in TONE ? undefined : uno(b.tone as Color),
          }}
          initial={{ scale: 2.2, opacity: 0, rotate: -14 }}
          animate={{ scale: 1, opacity: 1, rotate: b.big ? 0 : -6 }}
          exit={{ scale: 0.7, opacity: 0, y: -16 }}
          transition={{ type: "spring", bounce: 0.45, duration: 0.45 }}
        >
          {b.text}
          {b.sub && <span className="text-heading tabular-nums">{b.sub}</span>}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}
