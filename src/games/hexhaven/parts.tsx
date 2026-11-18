import { useMutation } from "convex/react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { RESOURCE_NAMES } from "../../../convex/hexhaven/board";
import type { Action } from "../../../convex/hexhaven/engine";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Glyph } from "./Board";
import { TERRAIN } from "./palette";

export function useHexMove(id: Id<"matches">, seq: number) {
  const send = useMutation(api.hexhaven.move);
  return async (action: Action) => {
    await send({ id, action: action as never, seen: seq });
  };
}

export function ResIcon({ r, size = 28 }: { r: number; size?: number }) {
  return (
    <svg viewBox="-.5 -.5 1 1" width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect x="-.5" y="-.5" width="1" height="1" rx=".24" fill={TERRAIN[r]} />
      <g transform="scale(1.05)">
        <Glyph r={r} />
      </g>
    </svg>
  );
}

export function HandRow({ hand, gained, className }: { hand: number[]; gained?: number[]; className?: string }) {
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
          <ResIcon r={r} size={26} />
          <span className="font-display text-body tabular-nums">{n}</span>
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
