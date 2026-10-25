import { useCallback, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

// iOS-style large title at the top of each tab.
export function LargeTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-5 pt-[calc(env(safe-area-inset-top)+44px)]">
      <div className="min-w-0">
        <h1 className="truncate font-display text-title-lg">{title}</h1>
        {subtitle && <div className="mt-1.5 text-callout text-muted-foreground">{subtitle}</div>}
      </div>
      {action}
    </header>
  );
}

// Back goes wherever you came from; opened straight from a link or a push, it goes to `fallback`.
export function useGoBack(fallback = "/") {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => (location.key !== "default" ? navigate(-1) : navigate(fallback, { replace: true })), [location.key, navigate, fallback]);
}

// The bar on screens pushed on top of a tab: back, a centered title, and one optional action. It scrolls with
// the page on purpose, and starts below the band iOS blurs under the status bar (see TopEdge).
export function NavBar({ title, subtitle, back = "/", action }: { title: string; subtitle?: ReactNode; back?: string; action?: ReactNode }) {
  const goBack = useGoBack(back);
  return (
    <header className="-mx-2 mb-2 grid min-h-12 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 pt-[calc(env(safe-area-inset-top)+34px)]">
      <Button variant="ghost" size="icon" aria-label="Back" onClick={goBack}>
        <CaretLeftIcon size={24} weight="bold" />
      </Button>
      <div className="min-w-0 text-center">
        <h1 className="truncate font-display text-body">{title}</h1>
        {subtitle && <p className="truncate text-footnote text-muted-foreground">{subtitle}</p>}
      </div>
      {action ?? <span />}
    </header>
  );
}
