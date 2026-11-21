import { BackspaceIcon, LockIcon } from "@phosphor-icons/react";
import type { Key } from "../../../convex/wordle/engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LAYOUT = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"];
const KEY_LOOK: Record<Key, string> = {
  0: "bg-[var(--tile-gray)] text-[var(--tile-gray-ink)]",
  1: "bg-[var(--tile-yellow)] text-[var(--tile-yellow-ink)]",
  2: "bg-[var(--tile-green)] text-[var(--tile-ink)]",
};
const HIT = "relative after:absolute after:inset-y-0 after:-inset-x-[5px] after:-z-10 after:content-['']";

export const KEYBOARD_HEIGHT = "h-[184px]";

export function Keyboard({
  colors,
  jammed,
  disabled,
  onLetter,
  onEnter,
  onBack,
}: {
  colors: Record<string, Key> | null;
  jammed: string;
  disabled: boolean;
  onLetter: (ch: string) => void;
  onEnter: () => void;
  onBack: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Keyboard"
      data-dark={colors ? undefined : ""}
      className={cn("bleed-x flex flex-col gap-2 px-1 phone-landscape:mx-0 phone-landscape:w-full phone-landscape:px-0", KEYBOARD_HEIGHT)}
    >
      {LAYOUT.map((row, r) => (
        <div key={r} className={cn("isolate flex flex-1 gap-1", r === 1 && "px-[4.5%]")}>
          {[...row].map((ch) => {
            if (ch === "+")
              return (
                <Button
                  key={ch}
                  variant="bare"
                  size="piece"
                  disabled={disabled}
                  onClick={onEnter}
                  className={cn(HIT, "h-full flex-[1.5] bg-muted text-footnote font-bold")}
                >
                  Enter
                </Button>
              );
            if (ch === "-")
              return (
                <Button
                  key={ch}
                  variant="bare"
                  size="piece"
                  disabled={disabled}
                  onClick={onBack}
                  aria-label="Delete"
                  className={cn(HIT, "h-full flex-[1.5] bg-muted")}
                >
                  <BackspaceIcon className="size-6" weight="bold" />
                </Button>
              );
            const locked = jammed.includes(ch);
            const mark = colors?.[ch];
            return (
              <Button
                key={ch}
                variant="bare"
                size="piece"
                disabled={disabled}
                onClick={() => onLetter(ch)}
                aria-label={locked ? `${ch.toUpperCase()}, jammed` : ch.toUpperCase()}
                data-key={ch}
                data-mark={mark}
                data-jammed={locked ? "" : undefined}
                className={cn(
                  HIT,
                  "h-full flex-1 font-display text-body font-bold uppercase",
                  mark === undefined ? "bg-muted" : KEY_LOOK[mark],
                  locked && "bg-destructive/15 text-destructive",
                )}
              >
                {locked ? <LockIcon className="size-5" weight="fill" /> : ch}
              </Button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
