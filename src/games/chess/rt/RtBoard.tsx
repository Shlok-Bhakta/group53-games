import { memo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CELL, positionAt, type Piece, type State } from "../../../../convex/chess/realtime";
import { nearest, pieceSrc, pointToScreen, same, type Sq, type View } from "../geometry";
import { cn } from "@/lib/utils";

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

type BoardProps = {
  sim: State;
  myColor: string;
  view: View;
  playing: boolean;
  selected: Piece | null;
  targets: Sq[];
  pieceEls: RefObject<Map<number, HTMLDivElement>>;
  cooldownEls: RefObject<Map<number, HTMLDivElement>>;
  displayTick: () => number;
  onSelect: (p: Piece | null) => void;
  onMove: (p: Piece, to: Sq) => void;
  onCancel: (p: Piece) => void;
  children?: ReactNode;
};

// The board, its highlights and the drag. It draws each piece where it rests; the game's frame loop moves them
// in the DOM from there (`pieceEls`, `cooldownEls`), so this only re-renders when the board's structure changes.
export function RtBoard({ sim, myColor, view, playing, selected, targets, pieceEls, cooldownEls, displayTick, onSelect, onMove, onCancel, children }: BoardProps) {
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
