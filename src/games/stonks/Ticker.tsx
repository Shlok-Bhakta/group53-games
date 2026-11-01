import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// A number whose digits roll when it changes: up when it rose, down when it fell. Each digit has its own
// slot, counted from the right so a digit keeps its place as the number grows, and only the digits that
// changed move: a price going from 344.61 to 344.68 rolls one digit. Readers get the plain text.
export function Ticker({ value, text, instant, className }: { value: number; text: string; instant?: boolean; className?: string }) {
  const still = useReducedMotion();
  const last = useRef({ value, dir: 1 });
  if (last.current.value !== value) last.current = { value, dir: value > last.current.value ? 1 : -1 };
  const dir = last.current.dir;
  const chars = [...text];
  if (instant || still) return <span className={cn("tabular-nums", className)}>{text}</span>;
  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      <span className="sr-only">{text}</span>
      {chars.map((ch, i) => {
        const slot = chars.length - i;
        if (!/\d/.test(ch))
          return (
            <span key={`s${slot}`} aria-hidden className="whitespace-pre">
              {ch}
            </span>
          );
        return (
          <span key={`d${slot}`} aria-hidden className="relative inline-flex overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={dir}>
              <motion.span
                key={ch}
                custom={dir}
                variants={{
                  enter: (d: number) => ({ y: d > 0 ? "75%" : "-75%", opacity: 0 }),
                  center: { y: 0, opacity: 1 },
                  exit: (d: number) => ({ y: d > 0 ? "-75%" : "75%", opacity: 0 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", bounce: 0, duration: 0.38 }}
              >
                {ch}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}
