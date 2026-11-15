import { useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LargeTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-5 pt-[calc(var(--safe-top)+44px)]">
      <div className="min-w-0">
        <h1 className="truncate font-display text-title-lg">{title}</h1>
        {subtitle && <div className="mt-1.5 text-callout text-muted-foreground">{subtitle}</div>}
      </div>
      {action}
    </header>
  );
}

// platform: react-router counts in-app history in history.state.idx, which a replace keeps at 0.
export function useGoBack(fallback = "/") {
  const navigate = useNavigate();
  return useCallback(
    () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate(fallback, { replace: true })),
    [navigate, fallback],
  );
}

export function NavBar({
  title,
  subtitle,
  back = "/",
  action,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string;
  action?: ReactNode;
  className?: string;
}) {
  const goBack = useGoBack(back);
  return (
    <header
      className={cn(
        "-mx-2 mb-2 grid min-h-12 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 pt-[calc(var(--safe-top)+34px)]",
        className,
      )}
    >
      <IconButton label="Back" onClick={goBack}>
        <CaretLeftIcon size={24} weight="bold" />
      </IconButton>
      <div className="min-w-0 text-center">
        <h1 className="truncate font-display text-body">{title}</h1>
        {subtitle && <p className="truncate text-footnote text-muted-foreground">{subtitle}</p>}
      </div>
      {action ?? <span />}
    </header>
  );
}
