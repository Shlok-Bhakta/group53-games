import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRO_KEY = "stonks-pro";
const proListeners = new Set<() => void>();
const proOn = () => localStorage.getItem(PRO_KEY) === "1";
export function usePro(): [boolean, () => void] {
  const pro = useSyncExternalStore(
    (cb) => (proListeners.add(cb), () => proListeners.delete(cb)),
    proOn,
    () => false,
  );
  return [pro, () => (localStorage.setItem(PRO_KEY, pro ? "0" : "1"), proListeners.forEach((l) => l()))];
}

export function ProToggle() {
  const [pro, toggle] = usePro();
  return (
    <Button
      variant="bare"
      size="float"
      aria-pressed={pro}
      aria-label="Pro mode"
      onClick={toggle}
      className={cn(
        "text-footnote font-bold active:scale-[0.97]",
        pro ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      Pro
    </Button>
  );
}
