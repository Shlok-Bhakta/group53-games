import { useEffect, type ComponentProps } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function useFullbleed(on = true) {
  useEffect(() => {
    if (!on) return;
    document.documentElement.dataset.fullbleed = "";
    return () => void delete document.documentElement.dataset.fullbleed;
  }, [on]);
}

export function FullscreenStage({ className, ...props }: ComponentProps<"div">) {
  useFullbleed();
  return (
    <div
      data-wide
      className={cn("relative bleed-x -mb-[calc(var(--safe-bottom)+16px)] h-[100dvh] overflow-hidden bg-background", className)}
      {...props}
    />
  );
}

export function FloatingTopBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-floating-bar
      className={cn(
        "pointer-events-none absolute inset-x-0 top-[calc(var(--safe-top)+34px)] z-20 flex items-center gap-2 px-3",
        "phone-landscape:inset-x-auto phone-landscape:top-[max(12px,var(--safe-top))] phone-landscape:bottom-[max(12px,var(--safe-bottom))] phone-landscape:left-[max(12px,var(--safe-left))] phone-landscape:max-w-[40vw] phone-landscape:flex-col phone-landscape:items-start phone-landscape:px-0 phone-landscape:*:flex-none phone-landscape:*:last:mt-auto",
        className,
      )}
      {...props}
    />
  );
}

export function FloatButton({
  "aria-label": label,
  className,
  ...props
}: Omit<ComponentProps<typeof IconButton>, "label"> & { "aria-label": string }) {
  return <IconButton label={label} variant="float" size="float" className={className} {...props} />;
}

export const floatPill = "pointer-events-auto flex min-h-11 min-w-0 items-center gap-2 rounded-full bg-card/90 shadow-md backdrop-blur-md";

type FloatPillProps = Pick<ComponentProps<"div">, "className" | "style" | "children" | "role" | "id" | "aria-label" | "aria-live"> & {
  onClick?: () => void;
};

export function FloatPill({ className, onClick, ...props }: FloatPillProps) {
  if (onClick) return <Button variant="float" size="pill" onClick={onClick} className={className} {...props} />;
  return <div className={cn(floatPill, className)} {...props} />;
}
