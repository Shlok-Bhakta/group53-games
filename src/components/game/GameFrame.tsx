import { createContext, use, type ReactNode } from "react";
import { CaretLeftIcon, ListIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Chrome = { title: string; onBack: () => void; onMenu: () => void };

const ChromeContext = createContext<Chrome | null>(null);

export function GameChrome({ children, ...chrome }: Chrome & { children: ReactNode }) {
  return <ChromeContext value={chrome}>{children}</ChromeContext>;
}

const LANDSCAPE_FRAME =
  "phone-landscape:grid phone-landscape:h-[calc(100svh-var(--safe-bottom)-16px)] phone-landscape:grid-cols-[minmax(0,1fr)_minmax(13rem,32%)] phone-landscape:grid-rows-[auto_minmax(0,1fr)_auto] phone-landscape:gap-x-4 phone-landscape:gap-y-3 phone-landscape:pt-[max(8px,var(--safe-top))]";

const FIT_HEIGHT = "phone-landscape:[--fit-h:calc(100svh-var(--safe-bottom)-max(8px,var(--safe-top))-16px)]";

export function GameFrame({ children, dock, aside, tight }: { children: ReactNode; dock: ReactNode; aside?: ReactNode; tight?: boolean }) {
  return (
    <div data-wide data-game-frame className={cn("contents", LANDSCAPE_FRAME)}>
      <div
        data-game-board
        className={cn(
          "flex flex-1 flex-col justify-center",
          tight ? "gap-1 py-1" : "gap-2 py-2",
          "phone-landscape:col-start-1 phone-landscape:row-span-3 phone-landscape:row-start-1 phone-landscape:min-h-0 phone-landscape:items-center phone-landscape:py-0",
          FIT_HEIGHT,
        )}
      >
        {children}
      </div>
      <SideChrome />
      {aside && (
        <div className="hidden overscroll-contain phone-landscape:col-start-2 phone-landscape:row-start-2 phone-landscape:block phone-landscape:overflow-y-auto">
          {aside}
        </div>
      )}
      <div className={cn(tight ? "pt-1.5" : "pt-4", "phone-landscape:col-start-2 phone-landscape:row-start-3 phone-landscape:pt-0")}>
        {dock}
      </div>
    </div>
  );
}

function SideChrome() {
  const chrome = use(ChromeContext);
  if (!chrome) return null;
  return (
    <div className="hidden items-center gap-2 phone-landscape:col-start-2 phone-landscape:row-start-1 phone-landscape:flex">
      <IconButton label="Back" onClick={chrome.onBack}>
        <CaretLeftIcon size={24} weight="bold" />
      </IconButton>
      <h1 className="min-w-0 flex-1 truncate text-center font-display text-body">{chrome.title}</h1>
      <IconButton label="Menu" onClick={chrome.onMenu}>
        <ListIcon size={22} weight="bold" />
      </IconButton>
    </div>
  );
}

export function ActionRail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="group"
      aria-label="Actions"
      className={cn("grid auto-cols-fr grid-flow-col gap-2 phone-landscape:flex phone-landscape:flex-col", className)}
    >
      {children}
    </div>
  );
}

export function DockNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex h-[60px] items-center justify-center text-center text-callout text-muted-foreground", className)}>{children}</p>
  );
}
