import type { ReactNode } from "react";

// iOS-style large title at the top of each tab.
export function LargeTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-4 pt-[calc(env(safe-area-inset-top)+20px)]">
      <div className="min-w-0">
        <h1 className="font-display truncate text-[2.1rem] leading-none">{title}</h1>
        {subtitle && <div className="mt-2 text-[0.95rem] text-muted-foreground">{subtitle}</div>}
      </div>
      {action}
    </header>
  );
}

// Compact header with a back button, for screens pushed on top of a tab.
export function BackHeader({ title, back }: { title: string; back: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-3 flex min-h-14 items-center gap-1 bg-background/85 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+6px)] backdrop-blur-xl">
      {back}
      <h1 className="font-display truncate text-xl">{title}</h1>
    </header>
  );
}
