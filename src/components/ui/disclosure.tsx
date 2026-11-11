import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// A row that folds something away: its icon and title, maybe a summary at the end, and a caret. Height
// animates on a bare wrapper (padding lives inside it) so it closes all the way down instead of snapping shut
// at the end.
// `onOpenChange` hears it open and close, for whatever outside it depends on that.
export function Disclosure({ icon, title, trailing, defaultOpen = false, label, onOpenChange, children }: { icon: ReactNode; title: string; trailing?: ReactNode; defaultOpen?: boolean; label?: string; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const [open, setOpenState] = useState(defaultOpen);
  const setOpen = (f: (o: boolean) => boolean) => {
    const next = f(open);
    setOpenState(next);
    onOpenChange?.(next);
  };
  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full touch-manipulation items-center gap-2.5 rounded-md px-1 text-left text-callout font-semibold text-muted-foreground transition-colors active:bg-muted [&>svg:first-child]:size-5"
      >
        {icon}
        <span className="flex-1">{title}</span>
        {trailing}
        <CaretDownIcon weight="bold" className={cn("shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.8, 0.25, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
