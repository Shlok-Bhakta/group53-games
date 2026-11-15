import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const FOLD = { duration: 0.28, ease: [0.25, 0.8, 0.25, 1] } as const;

export function Disclosure({
  icon,
  title,
  trailing,
  defaultOpen = false,
  label,
  onOpenChange,
  children,
}: {
  icon: ReactNode;
  title: string;
  trailing?: ReactNode;
  defaultOpen?: boolean;
  label?: string;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Collapsible asChild open={open} onOpenChange={change}>
      <section aria-label={label}>
        <CollapsibleTrigger asChild>
          <Button
            variant="row"
            size="row"
            className="min-h-12 gap-2.5 rounded-md px-1 py-0 text-callout font-semibold text-muted-foreground [&>svg:first-child]:size-5"
          >
            {icon}
            <span className="flex-1">{title}</span>
            {trailing}
            <CaretDownIcon
              weight="bold"
              className={cn("shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")}
            />
          </Button>
        </CollapsibleTrigger>
        <AnimatePresence initial={false}>
          {open && (
            <CollapsibleContent forceMount asChild>
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={FOLD}
                className="overflow-hidden"
              >
                {children}
              </motion.div>
            </CollapsibleContent>
          )}
        </AnimatePresence>
      </section>
    </Collapsible>
  );
}
