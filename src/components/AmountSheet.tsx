import type { ReactNode } from "react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { AsyncButton } from "@/components/AsyncButton";
import { Button, IconButton } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";

export type Preset = { label: string; value: number };

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
          <IconButton label="Less" variant="secondary" size="icon-lg" disabled={value <= min} onClick={() => onChange(snap(value - step))}>
            <MinusIcon weight="bold" />
          </IconButton>
          {amount}
          <IconButton label="More" variant="secondary" size="icon-lg" disabled={value >= max} onClick={() => onChange(snap(value + step))}>
            <PlusIcon weight="bold" />
          </IconButton>
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
