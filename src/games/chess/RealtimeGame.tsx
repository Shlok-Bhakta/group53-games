import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { RealtimeState } from "../../../convex/chess";
import type { MatchView } from "../../../convex/matches";
import {
  CELL,
  COOLDOWN_TICKS,
  TICK_MS,
  initialState,
  legalTargets,
  positionAt,
  premoveTargets,
  simulate,
  type Command,
  type Piece,
  type State,
  type Variant,
} from "../../../convex/chess/realtime";
import { MODES, type ModeKey } from "../../../convex/modes";
import { useServerClock } from "./clock";
import { nearest, pieceSrc, pointToScreen, same, viewFor, type Sq, type View } from "./geometry";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";
import { listNames } from "./text";

const FILES = "abcdefgh";
// A finger this close to a square's center (in squares) picks it on the 14x14 board.
const REACH = 0.85;

// rtchess's board language.
const COLORS = {
  cooldown: "rgba(217,214,11,0.75)",
  moveFrom: "rgba(0,16,100,0.25)",
  moveTo: "rgba(0,16,100,0.45)",
  selected: "rgba(42,105,50,0.6)",
  target: "rgba(7,68,7,0.5)",
  premove: "rgba(255,162,0,0.75)",
};

// Remote moves arrive a little after they started; ease them into place over this many ticks.
const CATCH_UP_TICKS = 10;

// Replays from the server's settled snapshot, continuing from the last frame when nothing earlier changed.
function useEngine(snapshot: State | null, commands: Command[], variant: Variant) {
  const cache = useRef<{ base: State | null; commands: Command[]; state: State } | null>(null);
  return useCallback(
    (toTick: number): State => {
      const base = snapshot ?? null;
      const c = cache.current;
      const prefixOk =
        c &&
        c.base === base &&
        c.commands.length <= commands.length &&
        c.commands.every((x, i) => x === commands[i] || (x.tick === commands[i].tick && x.pieceId === commands[i].pieceId && x.toX === commands[i].toX && x.toY === commands[i].toY && x.kind === commands[i].kind));
      const fresh = commands.slice(c?.commands.length ?? 0);
      const resume = c && prefixOk && fresh.every((x) => x.tick >= c.state.tick) && c.state.tick <= toTick;
      const state = resume ? simulate(commands, toTick, c!.state) : simulate(commands, toTick, base ?? initialState(variant));
      cache.current = { base, commands, state };
      return state;
    },
    [snapshot, commands, variant],
  );
}

// Everything that changes the board's structure (not just positions). React only re-renders when this does.
const structureOf = (s: State) =>
  JSON.stringify([
    s.pieces.map((p) => [p.id, p.kind, p.status, p.x, p.y, p.toX, p.toY, p.pending?.toX, p.pending?.toY, p.dead]),
    s.out,
    s.result,
    s.captures.length,
  ]);

export function RealtimeGame({ match, meId, above, below, overlay }: { match: MatchView; meId: Id<"users"> | undefined; above?: ReactNode; below?: ReactNode; overlay?: ReactNode }) {
  const state = match.state as RealtimeState;
  const rt = useQuery(api.chess.rtState, { id: match._id });
  const clock = useServerClock();
  const me = match.players.find((p) => p.userId === meId);
  const variant: Variant = MODES[match.mode as ModeKey]?.board === "four" ? "four" : "two";
  const myColor = me?.color ?? (variant === "four" ? "red" : "w");
  const view = useMemo(() => viewFor(variant, myColor), [variant, myColor]);
  const ready = useMutation(api.chess.ready);
  const commands = useMemo(() => rt?.commands ?? [], [rt?.commands]);
  const run = useEngine((rt?.snapshot as State | null) ?? null, commands, variant);

  const rtMove = useMutation(api.chess.rtMove).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.chess.rtState, { id: args.id });
    if (!current) return;
    const cmd: Command = { tick: args.clientTick, color: myColor, pieceId: args.pieceId, toX: args.toX, toY: args.toY, kind: args.kind ?? "move" };
    store.setQuery(api.chess.rtState, { id: args.id }, { ...current, commands: [...current.commands, cmd] });
  });

  // Tell the server this player's board is up, and keep trying until it hears it.
  const needsReady = match.status === "active" && !!me && state.startAt === null && !state.ready.includes(me.userId);
  useEffect(() => {
    if (!needsReady) return;
    let cancelled = false;
    let delay = 500;
    const attempt = () => {
      ready({ id: match._id }).catch(() => {
        if (cancelled) return;
        setTimeout(attempt, delay);
        delay = Math.min(delay * 2, 5000);
      });
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [needsReady, match._id, ready]);

  const startAt = state.startAt;
  const live = clock.ready && startAt !== null && rt !== undefined;
  const displayTick = useCallback(() => (startAt === null ? -1 : (clock.now() - startAt) / TICK_MS), [clock, startAt]);

  // React state: the board's structure, refreshed only when it changes.
  const [sim, setSim] = useState<State>(() => initialState(variant));
  const [countdown, setCountdown] = useState<number | null>(null);
  const structure = useRef("");
  const pieceEls = useRef(new Map<number, HTMLDivElement>());
  const cooldownEls = useRef(new Map<number, HTMLDivElement>());
  const firstSeen = useRef(new Map<string, number>());

  // The frame loop: advance the simulation, move pieces directly in the DOM, and only touch React when
  // the structure changes.
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const frame = () => {
      const raw = displayTick();
      setCountdown(raw < 0 ? Math.ceil((-raw * TICK_MS) / 1000) : null);
      const s = run(Math.max(0, Math.floor(raw) + 1));
      const tick = s.result ? s.endTick! : Math.max(0, raw);
      const key = structureOf(s);
      if (key !== structure.current) {
        structure.current = key;
        setSim(s);
      }
      for (const p of s.pieces) {
        const el = pieceEls.current.get(p.id);
        if (!el) continue;
        let t = tick;
        if (p.status === "moving") {
          const k = `${p.id}:${p.startTick}`;
          if (!firstSeen.current.has(k)) firstSeen.current.set(k, tick);
          const seen = firstSeen.current.get(k)!;
          const lag = seen - p.startTick!;
          if (lag > 1) t = tick - lag * Math.max(0, 1 - (tick - seen) / CATCH_UP_TICKS);
        }
        const pos = positionAt(p, t);
        const [c, r] = view.toScreen(pos.x / CELL, pos.y / CELL);
        el.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
        const cd = cooldownEls.current.get(p.id);
        if (cd) cd.style.height = p.status === "cooldown" ? `${Math.max(0, Math.min(1, (p.readyAt! - tick) / COOLDOWN_TICKS)) * 100}%` : "0%";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live, run, displayTick, view]);

  const out = sim.out.some((o) => o.color === myColor);
  const playing = match.status === "active" && live && countdown === null && !sim.result && !!me && !out;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = sim.pieces.find((p) => p.id === selectedId && p.color === myColor && !p.dead) ?? null;
  const targets: Sq[] = !playing || !selected ? [] : selected.status === "ready" ? legalTargets(sim.pieces, selected, variant) : premoveTargets(selected, variant);

  const showHint = useFirstGamesHint(match._id);

  const send = (piece: Piece, to: Sq | null) => {
    const clientTick = Math.max(Math.floor(displayTick()), (rt?.snapshot as State | null)?.tick ?? 0);
    rtMove({ id: match._id, pieceId: piece.id, toX: to?.[0] ?? 0, toY: to?.[1] ?? 0, kind: to ? "move" : "cancel", clientTick }).catch((err) => toast.error(errorText(err)));
  };

  return (
    <>
      {above}
      <div className={cn("relative", variant === "four" && "-mx-2.5")}>
        <RtBoard
          sim={sim}
          myColor={myColor}
          view={view}
          playing={playing}
          selected={selected}
          targets={targets}
          pieceEls={pieceEls}
          cooldownEls={cooldownEls}
          displayTick={displayTick}
          onSelect={(p) => setSelectedId(p?.id ?? null)}
          onMove={(p, to) => {
            send(p, to);
            setSelectedId(null);
          }}
          onCancel={(p) => {
            send(p, null);
            setSelectedId(null);
          }}
        >
          {overlay}
        </RtBoard>
        <Overlay match={match} state={state} meId={meId} countdown={countdown} />
      </div>
      {below}
      {out && match.status === "active" ? (
        <p className="px-1 text-center text-callout font-semibold text-destructive">Your king fell. Your army is stone now; watch who survives.</p>
      ) : (
        showHint && match.status === "active" && (
          <p className="px-1 text-center text-footnote text-muted-foreground">
            Move any piece any time; it rests 5 seconds after landing. Drag a resting piece to premove it, tap it to cancel.
          </p>
        )
      )}
    </>
  );
}

// The how-it-works line under a real-time board, for your first few games only.
const HINT_KEY = "rtHintGames";
function useFirstGamesHint(matchId: string) {
  const [show] = useState(() => {
    const seen: string[] = JSON.parse(localStorage.getItem(HINT_KEY) ?? "[]");
    if (seen.includes(matchId)) return true;
    if (seen.length >= 3) return false;
    localStorage.setItem(HINT_KEY, JSON.stringify([...seen, matchId]));
    return true;
  });
  return show;
}

type BoardProps = {
  sim: State;
  myColor: string;
  view: View;
  playing: boolean;
  selected: Piece | null;
  targets: Sq[];
  pieceEls: React.RefObject<Map<number, HTMLDivElement>>;
  cooldownEls: React.RefObject<Map<number, HTMLDivElement>>;
  displayTick: () => number;
  onSelect: (p: Piece | null) => void;
  onMove: (p: Piece, to: Sq) => void;
  onCancel: (p: Piece) => void;
  children?: ReactNode;
};

function RtBoard({ sim, myColor, view, playing, selected, targets, pieceEls, cooldownEls, displayTick, onSelect, onMove, onCancel, children }: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ piece: Piece; over: Sq | null } | null>(null);
  const startPt = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const n = view.n;
  const pct = 100 / n;
  const small = n > 8;
  const toScreen = ([x, y]: Sq): Sq => view.toScreen(x, y);

  const squareAt = (clientX: number, clientY: number): Sq | null => {
    const at = pointToScreen(ref.current!, n, clientX, clientY);
    if (!at) return null;
    const sq = view.fromScreen(Math.floor(at[0]), Math.floor(at[1]));
    return view.onBoard(...sq) ? sq : null;
  };
  // Where my live pieces are this instant: resting, or travelling through a square right now.
  const myPieces = () => {
    const t = displayTick();
    return sim.pieces
      .filter((p) => p.color === myColor && !p.dead)
      .map((p) => {
        if (p.status !== "moving") return { p, sq: [p.x, p.y] as Sq };
        const pos = positionAt(p, t);
        return { p, sq: [Math.round(pos.x / CELL), Math.round(pos.y / CELL)] as Sq };
      });
  };
  // My piece under the finger, preferring one resting there. Small squares snap to the nearest piece.
  const myPieceNear = (clientX: number, clientY: number) => {
    const mine = myPieces();
    const sq = squareAt(clientX, clientY);
    const exact = sq && (mine.find((m) => m.p.status !== "moving" && same(m.sq, sq)) ?? mine.find((m) => same(m.sq, sq)));
    if (exact || !small) return exact?.p ?? null;
    const at = pointToScreen(ref.current!, n, clientX, clientY);
    const near = at && nearest(view, mine.map((m) => m.sq), at[0], at[1], REACH);
    return (near && mine.find((m) => same(m.sq, near))?.p) ?? null;
  };
  const isTarget = (sq: Sq | null) => !!sq && targets.some((t) => same(t, sq));
  const targetNear = (clientX: number, clientY: number) => {
    const sq = squareAt(clientX, clientY);
    if (isTarget(sq) || !small) return sq;
    const at = pointToScreen(ref.current!, n, clientX, clientY);
    return (at && nearest(view, targets, at[0], at[1], REACH)) ?? sq;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!playing) return;
    if (selected) {
      const to = targetNear(e.clientX, e.clientY);
      if (to && isTarget(to)) {
        onMove(selected, to);
        return;
      }
    }
    const sq = squareAt(e.clientX, e.clientY);
    const p = myPieceNear(e.clientX, e.clientY);
    if (!p) return onSelect(null);
    if (p.pending) {
      onCancel(p);
      return;
    }
    onSelect(p);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startPt.current = { x: e.clientX, y: e.clientY, moved: false };
    setDrag({ piece: p, over: sq });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !startPt.current) return;
    const dx = e.clientX - startPt.current.x;
    const dy = e.clientY - startPt.current.y;
    if (!startPt.current.moved && Math.hypot(dx, dy) > 6) startPt.current.moved = true;
    if (ghost.current && startPt.current.moved) {
      const r = ref.current!.getBoundingClientRect();
      const half = r.width / n / 2;
      ghost.current.style.transform = `translate(${e.clientX - r.left - half}px, ${e.clientY - r.top - half}px) scale(${small ? 1.6 : 1.2})`;
      ghost.current.style.opacity = "0.8";
    }
    const over = targetNear(e.clientX, e.clientY);
    if (!same(over, drag.over)) setDrag({ ...drag, over });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag && startPt.current?.moved) {
      const sq = targetNear(e.clientX, e.clientY);
      if (sq && isTarget(sq)) onMove(drag.piece, sq);
    }
    if (ghost.current) ghost.current.style.opacity = "0";
    startPt.current = null;
    setDrag(null);
  };

  const moving = sim.pieces.filter((p) => p.status === "moving");
  const pendings = sim.pieces.filter((p) => p.pending && p.color === myColor);
  const restingEnemy = (sq: Sq) => sim.pieces.some((p) => (p.color !== myColor || p.dead) && p.status !== "moving" && p.x === sq[0] && p.y === sq[1]);
  const premoving = selected && selected.status !== "ready";

  return (
    <div
      ref={ref}
      role="grid"
      aria-label={small ? "4-player real-time chess board" : "Real-time chess board"}
      className={cn("board relative aspect-square w-full touch-none select-none overflow-hidden rounded-sm", !small && "shadow-lg shadow-black/20")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Squares view={view} />

      {/* Highlights */}
      <div className="pointer-events-none absolute inset-0">
        {moving.flatMap((p) => [
          <Tint key={`f${p.id}`} sq={toScreen([p.x, p.y])} color={COLORS.moveFrom} pct={pct} />,
          <Tint key={`t${p.id}`} sq={toScreen([p.toX!, p.toY!])} color={COLORS.moveTo} pct={pct} />,
        ])}
        {selected && <Tint sq={toScreen(selected.status === "moving" ? [selected.toX!, selected.toY!] : [selected.x, selected.y])} color={COLORS.selected} pct={pct} />}
        {targets.map((t) => {
          const [c, r] = toScreen(t);
          const focused = same(drag?.over, t);
          return (
            <span key={view.name(t)} className="absolute" style={{ left: `${c * pct}%`, top: `${r * pct}%`, width: `${pct}%`, height: `${pct}%` }} data-target={view.name(t)}>
              {focused ? (
                <span className="absolute inset-0" style={{ background: premoving ? COLORS.premove : COLORS.target, opacity: 0.6 }} />
              ) : premoving ? (
                <span className="absolute inset-[8%] rounded-md border-[3px] border-dashed" style={{ borderColor: COLORS.premove }} />
              ) : restingEnemy(t) ? (
                <span className={cn("absolute inset-0 rounded-full", small ? "border-[3px]" : "border-[5px]")} style={{ borderColor: COLORS.target }} />
              ) : (
                <span className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", small ? "size-[38%]" : "size-[30%]")} style={{ background: COLORS.target }} />
              )}
            </span>
          );
        })}
      </div>

      {/* Pieces: positioned every frame by the parent's loop */}
      <div className="pointer-events-none absolute inset-0">
        {sim.pieces.map((p) => (
          <div
            key={p.id}
            ref={(el) => {
              if (el) pieceEls.current.set(p.id, el);
              else pieceEls.current.delete(p.id);
            }}
            className={cn("absolute left-0 top-0 will-change-transform", p.status === "moving" ? "z-20" : "z-10", drag?.piece.id === p.id && startPt.current?.moved && "opacity-30")}
            // Where the piece rests until the frame loop takes over, so nothing starts in the corner.
            style={{ width: `${pct}%`, height: `${pct}%`, transform: `translate(${toScreen([p.x, p.y])[0] * 100}%, ${toScreen([p.x, p.y])[1] * 100}%)` }}
            data-piece={`${p.dead ? "dead" : p.color}${p.kind}`}
            data-status={p.status}
          >
            <div
              ref={(el) => {
                if (el) cooldownEls.current.set(p.id, el);
                else cooldownEls.current.delete(p.id);
              }}
              className="absolute inset-x-0 bottom-0"
              style={{ background: COLORS.cooldown, height: 0 }}
            />
            <img src={pieceSrc(p)} alt="" draggable={false} className={cn("relative size-full", p.status === "moving" && "drop-shadow-[0_6px_6px_rgb(0_0_0/0.35)]")} />
          </div>
        ))}
      </div>

      {/* Premove arrows */}
      <svg className="pointer-events-none absolute inset-0 z-30 size-full" viewBox={`0 0 ${n} ${n}`} aria-hidden="true">
        {pendings.map((p) => {
          const from = toScreen(p.status === "moving" ? [p.toX!, p.toY!] : [p.x, p.y]);
          const to = toScreen([p.pending!.toX, p.pending!.toY]);
          return <Arrow key={p.id} from={from} to={to} />;
        })}
      </svg>

      {/* Drag ghost */}
      <div ref={ghost} className="pointer-events-none absolute left-0 top-0 z-40 opacity-0" style={{ width: `${pct}%`, height: `${pct}%` }}>
        {drag && <img src={pieceSrc(drag.piece)} alt="" className="size-full" />}
      </div>

      <CaptureBursts sim={sim} view={view} />
      {children}
    </div>
  );
}

const Squares = memo(function Squares({ view }: { view: View }) {
  const n = view.n;
  return (
    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, gridTemplateRows: `repeat(${n}, 1fr)` }}>
      {Array.from({ length: n * n }, (_, i) => {
        const c = i % n;
        const r = Math.floor(i / n);
        const sq = view.fromScreen(c, r);
        if (!view.onBoard(...sq)) return <div key={i} aria-hidden="true" />;
        const dark = (sq[0] + sq[1]) % 2 === 0;
        const label = view.name(sq);
        return (
          <div key={i} role="gridcell" aria-label={label} data-square={label} className={cn("relative", dark ? "bg-[var(--board-dark)]" : "bg-[var(--board-light)]")}>
            {n === 8 && c === 0 && <span className={cn("absolute left-[5%] top-[4%] text-caption font-bold leading-none", dark ? "text-[var(--board-light)]" : "text-[var(--board-dark)]")}>{sq[1] + 1}</span>}
            {n === 8 && r === 7 && <span className={cn("absolute bottom-[4%] right-[6%] text-caption font-bold leading-none", dark ? "text-[var(--board-light)]" : "text-[var(--board-dark)]")}>{FILES[sq[0]]}</span>}
          </div>
        );
      })}
    </div>
  );
});

function Tint({ sq: [c, r], color, pct }: { sq: Sq; color: string; pct: number }) {
  return <span className="absolute" style={{ left: `${c * pct}%`, top: `${r * pct}%`, width: `${pct}%`, height: `${pct}%`, background: color }} />;
}

function Arrow({ from: [fc, fr], to: [tc, tr] }: { from: Sq; to: Sq }) {
  const x1 = fc + 0.5;
  const y1 = fr + 0.5;
  const x2 = tc + 0.5;
  const y2 = tr + 0.5;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const head = 0.4;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const w = head * Math.tan(Math.PI / 6);
  return (
    <g fill={COLORS.premove} stroke={COLORS.premove}>
      <line x1={x1} y1={y1} x2={bx} y2={by} strokeWidth={0.15} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${bx - uy * w},${by + ux * w} ${bx + uy * w},${by - ux * w}`} stroke="none" />
    </g>
  );
}

function CaptureBursts({ sim, view }: { sim: State; view: View }) {
  const recent = sim.captures.slice(-4);
  const pct = 100 / view.n;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <AnimatePresence>
        {recent.map((c) => {
          const [sc, sr] = view.toScreen(c.x, c.y);
          return (
            <motion.span
              key={`${c.tick}:${c.pieceId}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[var(--tile-hit)]"
              style={{ left: `${(sc + 0.5) * pct}%`, top: `${(sr + 0.5) * pct}%`, width: `${pct}%`, height: `${pct}%` }}
              initial={{ scale: 0.3, opacity: 1 }}
              animate={{ scale: 1.8, opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function Overlay({ match, state, meId, countdown }: { match: MatchView; state: RealtimeState; meId: Id<"users"> | undefined; countdown: number | null }) {
  const waitingFor = match.players.filter((p) => !state.ready.includes(p.userId) && p.userId !== meId);
  const show = match.status === "active" && (state.startAt === null || countdown !== null);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-sm bg-background/55 backdrop-blur-[2px]"
        >
          {state.startAt === null ? (
            <p className="max-w-[24ch] text-center font-display text-heading">
              {waitingFor.length ? `Waiting for ${listNames(waitingFor.map((p) => p.name))} to open the board` : "Starting…"}
            </p>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.span
                key={countdown}
                initial={{ scale: 1.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className="font-display text-7xl text-foreground drop-shadow"
              >
                {countdown}
              </motion.span>
            </AnimatePresence>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
