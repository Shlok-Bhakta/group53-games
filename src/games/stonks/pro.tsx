import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

// Pro mode: the numbers traders want, one tap in the corner of either screen, remembered on the phone.
const proListeners = new Set<() => void>();
const proOn = () => localStorage.getItem("stonks-pro") === "1";
export function usePro(): [boolean, () => void] {
  const pro = useSyncExternalStore(
    (cb) => (proListeners.add(cb), () => proListeners.delete(cb)),
    proOn,
    () => false,
  );
  return [pro, () => (localStorage.setItem("stonks-pro", pro ? "0" : "1"), proListeners.forEach((l) => l()))];
}

// Not a Button: its transparent border clips the fill a pixel in, and its hover tints don't suit a toggle.
export function ProToggle() {
  const [pro, toggle] = usePro();
  return (
    <button
      type="button"
      aria-pressed={pro}
      aria-label="Pro mode"
      onClick={toggle}
      className={cn(
        "grid size-11 place-items-center rounded-full text-footnote font-bold transition-[transform,background-color,color] duration-100 active:scale-[0.97]",
        pro ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      Pro
    </button>
  );
}
