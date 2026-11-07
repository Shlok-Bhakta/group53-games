import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A game screen under the nav bar: the board and its players as one block in the middle, and the actions
// docked at the bottom where thumbs are. Keep the dock's height fixed so nothing shifts the board.
export function GameFrame({ children, dock, tight }: { children: ReactNode; dock: ReactNode; tight?: boolean }) {
  return (
    <>
      <div className={cn("flex flex-1 flex-col justify-center", tight ? "gap-1 py-1" : "gap-2 py-2")}>{children}</div>
      <div className={tight ? "pt-1.5" : "pt-4"}>{dock}</div>
    </>
  );
}

// A line in the dock instead of buttons ("Folded", "You're out"), the same height as the buttons it replaces.
export function DockNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("flex h-[60px] items-center justify-center text-center text-callout text-muted-foreground", className)}>{children}</p>;
}
