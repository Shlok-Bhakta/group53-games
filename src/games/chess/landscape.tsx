import type { ReactNode } from "react";

export { usePhoneLandscape } from "@/components/game/landscape";

export function BesideTheBoard({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}
