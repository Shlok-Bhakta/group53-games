import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpenTextIcon, CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// The rules for a mode, folded away once you've played it. Height animates on a bare wrapper (padding
// lives inside it) so it closes all the way down instead of snapping shut at the end.
export function Rules({ rules, defaultOpen, title = "How to play" }: { rules: string[]; defaultOpen: boolean; title?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full touch-manipulation items-center gap-2.5 rounded-md px-1 text-left text-callout font-semibold text-muted-foreground transition-colors active:bg-muted"
      >
        <BookOpenTextIcon size={20} weight="fill" />
        <span className="flex-1">{title}</span>
        <CaretDownIcon weight="bold" className={cn("text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rules"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.8, 0.25, 1] }}
            className="overflow-hidden"
          >
            <ol className="flex flex-col gap-2.5 px-1 pb-2 pt-1">
              {rules.map((rule, i) => (
                <li key={i} className="flex gap-3 text-callout">
                  <span className="mt-px grid size-6 shrink-0 place-items-center rounded-sm bg-primary/12 text-footnote font-bold text-primary">{i + 1}</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
