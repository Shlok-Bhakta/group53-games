import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// Which position the board shows: `at` moves into the game, `count` being now. Now follows the game as moves
// land; a step back stays where it is when one arrives, so the board never changes under someone looking back.
export function useHistory(game: string, count: number) {
  const [viewing, setViewing] = useState<{ game: string; at: number } | null>(null);
  const at = viewing?.game === game ? Math.min(viewing.at, count) : count;
  const go = (k: number) => setViewing(k >= count ? null : { game, at: Math.max(0, k) });
  return { at, count, live: at === count, go };
}

export type History = ReturnType<typeof useHistory>;

// The moves under the board, with arrows either end to step through them. Tapping a move shows the board
// right after it.
export function MoveLine({ history: { at, count, go }, empty, children }: { history: History; empty: ReactNode; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  // Keeps the move on show in view: centered while stepping, the newest at the end.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const cur = el.querySelector<HTMLElement>("[data-current]");
    const left = at === count ? el.scrollWidth : cur ? cur.offsetLeft + cur.offsetWidth / 2 - el.clientWidth / 2 : 0;
    el.scrollTo({ left, behavior: shown.current ? "smooth" : "instant" });
    shown.current = true;
  }, [at, count]);
  // The arrow keys step too, for the odd game on a laptop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft" && at > 0) go(at - 1);
      if (e.key === "ArrowRight" && at < count) go(at + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (count === 0) return <p className="flex h-11 items-center justify-center px-1 text-footnote text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-2 flex h-11 items-center">
      <Step label="Previous move" disabled={at === 0} onClick={() => go(at - 1)}>
        <CaretLeftIcon weight="bold" />
      </Step>
      <div
        ref={list}
        aria-label="Moves"
        className="relative flex h-full min-w-0 flex-1 items-center gap-3.5 overflow-x-auto px-4 font-display text-callout tabular-nums [mask-image:linear-gradient(90deg,transparent,#000_16px,#000_calc(100%-16px),transparent)] [scrollbar-width:none]"
      >
        {children}
      </div>
      <Step label="Next move" disabled={at === count} onClick={() => go(at + 1)}>
        <CaretRightIcon weight="bold" />
      </Step>
    </div>
  );
}

function Step({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 shrink-0 touch-manipulation place-items-center rounded-md transition-[transform,opacity] duration-100 active:scale-[0.97] disabled:opacity-30 [&_svg]:size-[22px]"
    >
      {children}
    </button>
  );
}

// One move in the line. `ply` counts from 0, so the board after it is `ply + 1` moves in. Moves after the one
// on show are faded.
export function MoveChip({ ply, history, currentClass = "bg-primary text-primary-foreground", children }: { ply: number; history: History; currentClass?: string; children: ReactNode }) {
  const current = ply === history.at - 1;
  return (
    <button
      type="button"
      data-current={current || undefined}
      aria-current={current ? "step" : undefined}
      onClick={() => history.go(ply + 1)}
      className={cn("flex h-full shrink-0 touch-manipulation items-center transition-opacity duration-100", ply >= history.at && "opacity-40")}
    >
      <span className={cn("flex items-center gap-1.5 rounded-sm", current && cn("px-1.5", currentClass))}>{children}</span>
    </button>
  );
}

// Lies over the board while it shows the past: a tap there goes back to now, where pieces move again.
export function BackToNow({ history }: { history: History }) {
  if (history.live) return null;
  return <button type="button" aria-label="Back to the current position" onClick={() => history.go(history.count)} className="absolute inset-0 z-40 touch-manipulation" />;
}
