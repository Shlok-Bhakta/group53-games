import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { nearest, pieceSrc, pointToScreen, same, type Sq, type View } from "./geometry";

export type { Sq } from "./geometry";

export type BoardPiece = {
  key: string | number;
  color: string;
  kind: "P" | "N" | "B" | "R" | "Q" | "K";
  // Fractional while a real-time piece is travelling.
  x: number;
  y: number;
  // Four-player: an eliminated army, greyed out.
  dead?: boolean;
  moving?: boolean;
};

type Props = {
  pieces: BoardPiece[];
  view: View;
  // Squares the current player may pick up from.
  canSelect: (sq: Sq) => boolean;
  // Every square canSelect would accept, so small-board taps can snap to the nearest one.
  selectable?: Sq[];
  selected: Sq | null;
  targets: Sq[];
  onSelect: (sq: Sq | null) => void;
  onMove: (from: Sq, to: Sq) => void;
  lastMove?: [Sq, Sq] | null;
  check?: Sq[];
  disabled?: boolean;
  label?: string;
  // Drawn over the board, e.g. the players in a four-player board's empty corners. Doesn't take taps.
  children?: ReactNode;
};

const FILES = "abcdefgh";
export const squareName = ([x, y]: Sq) => `${FILES[x]}${y + 1}`;
export const fromName = (s: string): Sq => [s.charCodeAt(0) - 97, Number(s.slice(1)) - 1];

// A tap this close to a square's center (in squares) counts as that square on the 14x14 board.
const REACH = 0.85;

export function Board({ pieces, view, canSelect, selectable, selected, targets, onSelect, onMove, lastMove, check = [], disabled, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: Sq; dx: number; dy: number; moved: boolean } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const n = view.n;
  const pct = 100 / n;
  const small = n > 8;

  const squareAt = (clientX: number, clientY: number): Sq | null => {
    const at = pointToScreen(ref.current!, n, clientX, clientY);
    if (!at) return null;
    const sq = view.fromScreen(Math.floor(at[0]), Math.floor(at[1]));
    return view.onBoard(...sq) ? sq : null;
  };
  // Small squares: snap to the nearest square that would do something.
  const snap = (clientX: number, clientY: number, candidates: Sq[]): Sq | null => {
    const exact = squareAt(clientX, clientY);
    if (!small || (exact && candidates.some((c) => same(c, exact)))) return exact;
    const at = pointToScreen(ref.current!, n, clientX, clientY);
    return (at && nearest(view, candidates, at[0], at[1], REACH)) ?? exact;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (disabled) return;
    if (selected) {
      const to = snap(e.clientX, e.clientY, targets);
      if (to && targets.some((t) => same(t, to))) {
        onMove(selected, to);
        onSelect(null);
        return;
      }
    }
    const sq = snap(e.clientX, e.clientY, selectable ?? []);
    if (sq && canSelect(sq)) {
      onSelect(sq);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      start.current = { x: e.clientX, y: e.clientY };
      setDrag({ from: sq, dx: 0, dy: 0, moved: false });
      return;
    }
    onSelect(null);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag || !start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 6 });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (drag?.moved) {
      const sq = snap(e.clientX, e.clientY, targets);
      if (sq && targets.some((t) => same(t, sq))) {
        onMove(drag.from, sq);
        onSelect(null);
      }
    }
    start.current = null;
    setDrag(null);
  };

  return (
    <div
      ref={ref}
      role="grid"
      aria-label={label ?? "Chess board"}
      className={cn("board relative aspect-square w-full touch-none select-none overflow-hidden rounded-sm", !small && "shadow-lg shadow-black/20")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {/* Squares */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, gridTemplateRows: `repeat(${n}, 1fr)` }}>
        {Array.from({ length: n * n }, (_, i) => {
          const c = i % n;
          const r = Math.floor(i / n);
          const sq = view.fromScreen(c, r);
          if (!view.onBoard(...sq)) return <div key={i} aria-hidden="true" />;
          const dark = (sq[0] + sq[1]) % 2 === 0;
          const isTarget = targets.some((t) => same(t, sq));
          const occupied = pieces.some((p) => Math.round(p.x) === sq[0] && Math.round(p.y) === sq[1] && !p.moving);
          const name = view.name(sq);
          return (
            <div key={i} role="gridcell" aria-label={name} data-square={name} className={cn("relative", dark ? "bg-[var(--board-dark)]" : "bg-[var(--board-light)]")}>
              {(same(lastMove?.[0], sq) || same(lastMove?.[1], sq)) && <span className="absolute inset-0 bg-[oklch(0.85_0.17_95/0.42)]" />}
              {same(selected, sq) && <span className="absolute inset-0 bg-[oklch(0.8_0.17_95/0.6)]" />}
              {check.some((k) => same(k, sq)) && <span className="absolute inset-0 bg-[radial-gradient(circle,oklch(0.65_0.25_25/0.85)_15%,transparent_70%)]" />}
              {isTarget &&
                (occupied ? (
                  <span className={cn("absolute inset-0 rounded-full border-black/25", small ? "border-[3px]" : "border-[5px]")} />
                ) : (
                  <span className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25", small ? "size-[38%]" : "size-[30%]")} />
                ))}
              {!small && c === 0 && (
                <span className={cn("pointer-events-none absolute left-[5%] top-[4%] text-caption font-bold leading-none", dark ? "text-[var(--board-light)]" : "text-[var(--board-dark)]")}>
                  {sq[1] + 1}
                </span>
              )}
              {!small && r === 7 && (
                <span className={cn("pointer-events-none absolute bottom-[4%] right-[6%] text-caption font-bold leading-none", dark ? "text-[var(--board-light)]" : "text-[var(--board-dark)]")}>
                  {FILES[sq[0]]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pieces */}
      <div className="pointer-events-none absolute inset-0">
        {pieces.map((p) => {
          const dragging = drag?.moved && same(drag.from, [p.x, p.y]) && !p.moving;
          const [c, r] = view.toScreen(p.x, p.y);
          const style: CSSProperties = {
            left: `${c * pct}%`,
            top: `${r * pct}%`,
            width: `${pct}%`,
            height: `${pct}%`,
            transform: dragging ? `translate(${drag!.dx}px, ${drag!.dy}px) scale(${small ? 1.6 : 1.25})` : undefined,
            transition: !dragging ? "left 220ms cubic-bezier(.2,.8,.2,1), top 220ms cubic-bezier(.2,.8,.2,1)" : "none",
            zIndex: dragging ? 30 : 10,
          };
          return (
            <div key={p.key} className="absolute" style={style} data-piece={`${p.dead ? "dead" : p.color}${p.kind}`}>
              <img src={pieceSrc(p)} alt="" draggable={false} className="relative size-full" />
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
