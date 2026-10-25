import type { ReactNode } from "react";

// iOS-style large title at the top of each tab.
export function LargeTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-4 pt-[calc(env(safe-area-inset-top)+44px)]">
      <div className="min-w-0">
        <h1 className="font-display truncate text-[2.1rem] leading-none">{title}</h1>
        {subtitle && <div className="mt-2 text-[0.95rem] text-muted-foreground">{subtitle}</div>}
      </div>
      {action}
    </header>
  );
}

// Compact header with a back button, for screens pushed on top of a tab. It scrolls with the page on
// purpose, and starts below the band iOS blurs under the status bar (see TopEdge).
export function BackHeader({ title, back, action }: { title: string; back: ReactNode; action?: ReactNode }) {
  return (
    <header className="-mx-2 mb-3 flex min-h-12 items-center gap-1 pt-[calc(env(safe-area-inset-top)+34px)]">
      {back}
      <h1 className="font-display min-w-0 flex-1 truncate text-xl">{title}</h1>
      {action}
    </header>
  );
}
