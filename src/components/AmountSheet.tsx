import type { ReactNode } from "react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { AsyncButton } from "@/components/AsyncButton";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";

export type Preset = { label: string; value: number };

// Picking how much: the amount big in the middle, a slider, a row of usual sizes, and one button to commit.
// Poker's bets and Stonks' orders are both this. `snap` keeps the slider on round amounts; `step` adds − and +
// around the amount for fine steps. Whatever the game wants to say about the amount goes in `detail` (under
// it) and `children` (above the button).
export function AmountSheet({
  open,
  onClose,
  title,
  value,
  onChange,
  min,
  max,
  snap = (v) => v,
  step,
  presets,
  display,
  detail,
  children,
  confirm,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  snap?: (v: number) => number;
  step?: number;
  presets: Preset[];
  display: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  confirm: ReactNode;
  onConfirm: () => Promise<unknown>;
}) {
  // Two sizes can come to the same amount; the last of them lights up.
  const lit = [...presets].reverse().find((p) => p.value === value);
  const amount = (
    <div className="text-center">
      <div className="font-display text-title-lg tabular-nums" aria-live="polite">
        {display}
      </div>
      {detail && <div className="text-footnote text-muted-foreground">{detail}</div>}
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title={title} closable>
      {step ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" size="icon-lg" aria-label="Less" disabled={value <= min} onClick={() => onChange(snap(value - step))}>
            <MinusIcon weight="bold" />
          </Button>
          {amount}
          <Button variant="secondary" size="icon-lg" aria-label="More" disabled={value >= max} onClick={() => onChange(snap(value + step))}>
            <PlusIcon weight="bold" />
          </Button>
        </div>
      ) : (
        amount
      )}
      <Slider label="Amount" min={min} max={max} step={1} value={[value]} onValueChange={([v]) => onChange(snap(v))} />
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}>
        {presets.map((p) => (
          <Button key={p.label} variant={lit === p ? "default" : "secondary"} className="h-11 px-1" onClick={() => onChange(p.value)}>
            {p.label}
          </Button>
        ))}
      </div>
      {children}
      <AsyncButton size="xl" className="w-full" onClick={onConfirm}>
        {confirm}
      </AsyncButton>
    </Sheet>
  );
}
