import { useMutation } from "convex/react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COSTS, RESOURCE_NAMES, type Piece } from "../../../convex/hexhaven/board";
import type { Action } from "../../../convex/hexhaven/engine";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Glyph } from "./Board";
import { useHold } from "./hold";
import { TERRAIN } from "./palette";

export function useHexMove(id: Id<"matches">, seq: number) {
  const send = useMutation(api.hexhaven.move);
  return async (action: Action) => {
    await send({ id, action: action as never, seen: seq });
  };
}

export function ResIcon({ r, size = 28 }: { r: number; size?: number }) {
  return (
    <svg viewBox="-.5 -.5 1 1" width={size} height={size} style={{ width: size, height: size }} aria-hidden="true" className="shrink-0">
      <rect x="-.5" y="-.5" width="1" height="1" rx=".24" fill={TERRAIN[r]} />
      <g transform="scale(1.05)">
        <Glyph r={r} />
      </g>
    </svg>
  );
}

export const PIECE_NAME: Record<Piece, string> = { road: "Road", village: "Settlement", town: "City", card: "Development card" };

export const costUnits = (kind: Piece) => COSTS[kind].flatMap((n, r) => Array<number>(n).fill(r));

export function missingFor(hand: readonly number[], kind: Piece) {
  return COSTS[kind].map((n, r) => Math.max(0, n - (hand[r] ?? 0)));
}

export function Cost({ kind, hand, size = 14 }: { kind: Piece; hand?: readonly number[]; size?: number }) {
  const used = [0, 0, 0, 0, 0];
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true" data-cost={kind}>
      {costUnits(kind).map((r, k) => {
        used[r] += 1;
        const short = hand !== undefined && used[r] > (hand[r] ?? 0);
        return (
          <span
            key={k}
            data-short={short ? "" : undefined}
            className={cn("transition-opacity duration-150", short && "opacity-35 grayscale")}
          >
            <ResIcon r={r} size={size} />
          </span>
        );
      })}
    </span>
  );
}

export function Fact({ label, children, tone }: { label: ReactNode; children?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <li
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2 text-callout",
        tone === "good" ? "bg-primary/15" : tone === "bad" ? "bg-destructive/10" : "bg-muted/50",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">{label}</span>
      {children !== undefined && (
        <span className="flex shrink-0 items-center gap-1.5 text-right font-display tabular-nums">{children}</span>
      )}
    </li>
  );
}

export function Facts({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {children}
    </ul>
  );
}

function HandTile({ r, onPick, children }: { r: number; onPick?: (r: number) => void; children: ReactNode }) {
  const hold = useHold(() => onPick?.(r));
  if (!onPick) return <>{children}</>;
  return (
    <Button
      variant="bare"
      size="overlay"
      aria-label={`About ${RESOURCE_NAMES[r].toLowerCase()}`}
      className="absolute inset-0 rounded-md [-webkit-touch-callout:none] after:absolute after:-inset-x-0.5 after:inset-y-0"
      onClick={() => onPick(r)}
      {...hold}
    >
      {children}
    </Button>
  );
}

export function HandRow({
  hand,
  gained,
  className,
  onPick,
}: {
  hand: number[];
  gained?: number[];
  className?: string;
  onPick?: (r: number) => void;
}) {
  return (
    <div className={cn("grid grid-cols-5 gap-1.5", className)} aria-label="Your cards" role="list">
      {hand.map((n, r) => (
        <div
          key={r}
          role="listitem"
          aria-label={`${n} ${RESOURCE_NAMES[r].toLowerCase()}`}
          data-res={r}
          data-count={n}
          className={cn("relative flex h-11 items-center justify-center gap-1.5 rounded-md bg-muted/60", n === 0 && "opacity-55")}
        >
          <HandTile r={r} onPick={onPick}>
            <span className="flex size-full items-center justify-center gap-1.5">
              <ResIcon r={r} size={26} />
              <span className="font-display text-body tabular-nums">{n}</span>
            </span>
          </HandTile>
          <AnimatePresence>
            {gained && gained[r] !== 0 && (
              <motion.span
                key={`${r}:${gained[r]}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: -14 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className={cn(
                  "pointer-events-none absolute -top-1 right-1 font-display text-footnote font-bold",
                  gained[r] > 0 ? "text-primary" : "text-destructive",
                )}
              >
                {gained[r] > 0 ? `+${gained[r]}` : gained[r]}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

export function Counts({
  value,
  max,
  onChange,
  label,
}: {
  value: number[];
  max?: number[];
  onChange: (next: number[]) => void;
  label: string;
}) {
  const set = (r: number, n: number) => onChange(value.map((x, i) => (i === r ? n : x)));
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={label}>
      {value.map((n, r) => (
        <div key={r} className="flex min-h-11 items-center gap-3 rounded-md bg-muted/50 px-2">
          <ResIcon r={r} />
          <span className="min-w-0 flex-1">
            {RESOURCE_NAMES[r]}
            {max && <span className="text-footnote text-muted-foreground"> · {max[r]}</span>}
          </span>
          <IconButton label={`Less ${RESOURCE_NAMES[r].toLowerCase()}`} disabled={n <= 0} onClick={() => set(r, n - 1)}>
            <MinusIcon weight="bold" />
          </IconButton>
          <span className="w-6 text-center font-display text-body tabular-nums" aria-label={`${label}: ${RESOURCE_NAMES[r]}`}>
            {n}
          </span>
          <IconButton
            label={`More ${RESOURCE_NAMES[r].toLowerCase()}`}
            disabled={max ? n >= max[r] : n >= 19}
            onClick={() => set(r, n + 1)}
          >
            <PlusIcon weight="bold" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export function ResPicker({
  value,
  onChange,
  label,
  disabled,
  note,
}: {
  value: number;
  onChange: (r: number) => void;
  label: string;
  disabled?: (r: number) => boolean;
  note?: (r: number) => string;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={label}>
      {RESOURCE_NAMES.map((name, r) => (
        <Button
          key={r}
          aria-label={name}
          role="radio"
          aria-checked={value === r}
          disabled={disabled?.(r)}
          onClick={() => onChange(r)}
          variant="bare"
          size="piece"
          className={cn("h-14 gap-0.5 rounded-md", value === r ? "bg-primary/20 ring-2 ring-primary" : "bg-muted/50")}
        >
          <ResIcon r={r} size={26} />
          {note && <span className="text-caption tabular-nums text-muted-foreground">{note(r)}</span>}
        </Button>
      ))}
    </div>
  );
}
