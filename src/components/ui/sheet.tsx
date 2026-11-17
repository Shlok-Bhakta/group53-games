import type { ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onClose,
  title,
  hideTitle,
  closable,
  className,
  bodyClassName,
  pinned,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  hideTitle?: boolean;
  closable?: boolean;
  className?: string;
  bodyClassName?: string;
  pinned?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        className={cn("max-h-[92dvh] phone-landscape:mx-auto phone-landscape:max-w-lg", className)}
        aria-describedby={undefined}
      >
        <SheetHeader title={title} hideTitle={hideTitle} closable={closable} />
        {pinned && <div className="shrink-0">{pinned}</div>}
        <div
          className={cn(
            "flex flex-col gap-4 overflow-y-auto *:shrink-0 overscroll-contain px-4 pb-[calc(var(--safe-bottom)+20px)]",
            bodyClassName,
          )}
        >
          {children}
        </div>
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
          <IconButton label="Close" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
            <XIcon weight="bold" />
          </IconButton>
        </DrawerClose>
      )}
    </DrawerHeader>
  );
}
