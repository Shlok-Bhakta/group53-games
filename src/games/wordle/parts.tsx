import type { ReactNode } from "react";
import {
  CoinsIcon,
  CloudFogIcon,
  EyeSlashIcon,
  HandGrabbingIcon,
  HourglassMediumIcon,
  LightbulbIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MoneyWavyIcon,
  ReceiptIcon,
  RowsPlusBottomIcon,
  ShieldIcon,
} from "@phosphor-icons/react";
import type { ItemKey } from "../../../convex/wordle/engine";
import { cn } from "@/lib/utils";

export const MARK_BG = ["var(--tile-gray)", "var(--tile-yellow)", "var(--tile-green)"];
export const MARK_STATE = ["gray", "yellow", "green"] as const;

const ICONS: Record<ItemKey, typeof CoinsIcon> = {
  fog: CloudFogIcon,
  fuse: HourglassMediumIcon,
  jam: LockIcon,
  pickpocket: HandGrabbingIcon,
  dark: EyeSlashIcon,
  shield: ShieldIcon,
  hint: LightbulbIcon,
  extra: RowsPlusBottomIcon,
  tax: ReceiptIcon,
  clue: MagnifyingGlassIcon,
  payday: MoneyWavyIcon,
};

export function ItemIcon({ item, size = 20, className }: { item: ItemKey; size?: number; className?: string }) {
  const Icon = ICONS[item];
  return <Icon size={size} weight="fill" className={className} aria-hidden="true" />;
}

export function Coins({ n, className }: { n: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-display tabular-nums", className)}>
      <CoinsIcon weight="fill" className="text-[var(--tile-yellow)]" aria-hidden="true" />
      {n}
    </span>
  );
}

export function MiniBoard({
  marks,
  rows,
  cell = 9,
  label,
  className,
}: {
  marks: string[];
  rows: number;
  cell?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("grid shrink-0 grid-cols-5", className)}
      style={{ gap: Math.max(1, Math.round(cell / 6)), gridAutoRows: cell, gridTemplateColumns: `repeat(5, ${cell}px)` }}
      data-marks={marks.join(",")}
    >
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: 5 }, (_, i) => {
          const m = marks[r]?.[i];
          return (
            <span key={`${r}${i}`} className="rounded-xs" style={{ background: m === undefined ? "var(--muted)" : MARK_BG[Number(m)] }} />
          );
        }),
      )}
    </span>
  );
}
