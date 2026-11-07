import { useEffect, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The parts of a fullscreen game (Scrabble, Golf): the game fills the screen, right up under the status bar,
// and everything else floats over it. Buttons are round and see-through, info sits in pills, and the top bar
// starts below the band iOS blurs under the status bar (see TopEdge).

// The game runs up under the status bar, so the solid strip that normally covers that band steps aside.
export function useFullbleed(on = true) {
  useEffect(() => {
    if (!on) return;
    document.documentElement.dataset.fullbleed = "";
    return () => void delete document.documentElement.dataset.fullbleed;
  }, [on]);
}

// The whole screen, edge to edge, out of the page's padding. Sets fullbleed while it's up.
export function FullscreenStage({ className, ...props }: ComponentProps<"div">) {
  useFullbleed();
  return <div className={cn("relative -mx-4 -mb-[calc(env(safe-area-inset-bottom)+16px)] h-[100dvh] overflow-hidden bg-background", className)} {...props} />;
}

// The row floating over the top: a back button, a pill, a menu button. Only what's in it takes taps.
export function FloatingTopBar({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+34px)] z-20 flex items-center gap-2 px-3", className)} {...props} />;
}

// A round 44px button over the game.
export function FloatButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "pointer-events-auto grid size-11 shrink-0 touch-manipulation place-items-center rounded-full bg-card/90 shadow-md backdrop-blur-md transition-transform duration-100 active:scale-[0.94] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export const floatPill = "pointer-events-auto flex min-h-11 min-w-0 items-center gap-2 rounded-full bg-card/90 shadow-md backdrop-blur-md";

// Whatever the game says in the top bar, in a see-through pill. Give it `onClick` and it's a button.
export function FloatPill({ className, onClick, ...props }: ComponentProps<"div"> & { onClick?: () => void }) {
  if (onClick) return <button type="button" onClick={onClick} className={cn(floatPill, "text-left", className)} {...(props as ComponentProps<"button">)} />;
  return <div className={cn(floatPill, className)} {...props} />;
}
