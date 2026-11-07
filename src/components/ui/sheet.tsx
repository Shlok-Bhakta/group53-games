import type { ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

// A sheet up from the bottom for one small focused thing (a player's card, an amount, a picker), never a game
// menu. It dims the screen behind it, has a title (`hideTitle` keeps it for screen readers only), and pads its
// body clear of the home indicator. `closable` adds an X, for sheets over a dock, where swiping down
// shouldn't be the only way out.
export function Sheet({
  open,
  onClose,
  title,
  hideTitle,
  closable,
  className,
  bodyClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  hideTitle?: boolean;
  closable?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className={cn("max-h-[92dvh]", className)} aria-describedby={undefined}>
        <SheetHeader title={title} hideTitle={hideTitle} closable={closable} />
        <div className={cn("flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]", bodyClassName)}>{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

export function SheetHeader({ title, hideTitle, closable }: { title: ReactNode; hideTitle?: boolean; closable?: boolean }) {
  if (hideTitle) return <DrawerTitle className="sr-only">{title}</DrawerTitle>;
  return (
    <DrawerHeader className="relative">
      <DrawerTitle className={cn(closable && "px-12")}>{title}</DrawerTitle>
      {closable && (
        <DrawerClose asChild>
          <Button variant="ghost" size="icon" aria-label="Close" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon weight="bold" />
          </Button>
        </DrawerClose>
      )}
    </DrawerHeader>
  );
}
