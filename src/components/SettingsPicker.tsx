import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { CheckIcon, DiceFiveIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import {
  MODES,
  SEED_MAX,
  changedSettings,
  maskOn,
  seedSummary,
  settingApplies,
  settingsOf,
  settingsSummary,
  type ModeKey,
  type Setting,
  type Settings,
} from "../../convex/modes";
import { Segmented } from "@/components/Segmented";
import { Disclosure } from "@/components/ui/disclosure";
import { IconButton } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";

function SettingsFields({
  mode,
  value,
  onChange,
  preview,
}: {
  mode: ModeKey;
  value: Settings;
  onChange: (next: Settings) => void;
  preview?: ReactNode;
}) {
  const defs = (MODES[mode].settings as readonly Setting[]).filter((s) => settingApplies(s, value));
  const after = (defs.find((s) => s.kind === "seed") ?? defs[0])?.key;
  return (
    <div className="flex flex-col gap-4">
      {defs.map((s) => (
        <Fragment key={s.key}>
          <div className="flex flex-col gap-1.5">
            <span className="px-1 text-footnote font-semibold text-muted-foreground">{s.label}</span>
            {s.kind === "seed" ? (
              <SeedField label={s.label} value={value[s.key] ?? 0} onChange={(v) => onChange({ ...value, [s.key]: v })} />
            ) : s.kind === "mask" ? (
              <MaskField setting={s} value={value[s.key] ?? s.default} onChange={(v) => onChange({ ...value, [s.key]: v })} />
            ) : (
              <Segmented
                label={s.label}
                value={String(value[s.key] ?? s.default)}
                onChange={(v) => onChange({ ...value, [s.key]: Number(v) })}
                options={s.options.map((o) => ({
                  value: String(o.value),
                  label: o.label,
                }))}
              />
            )}
          </div>
          {s.key === after && preview}
        </Fragment>
      ))}
    </div>
  );
}

function SeedField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value ? String(value) : "");
  }
  const commit = () => {
    const n = Math.min(SEED_MAX, Math.max(0, Math.floor(Number(text.replace(/\D/g, "")) || 0)));
    if (n !== value) onChange(n);
    else setText(n ? String(n) : "");
  };
  return (
    <div className="flex gap-2">
      <input
        aria-label={label}
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="Random"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-11 min-w-0 flex-1 rounded-md bg-muted px-3 font-display text-body tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      <IconButton
        label="New random seed"
        variant="secondary"
        size="icon-square"
        onClick={() => {
          setText("");
          onChange(0);
        }}
      >
        <DiceFiveIcon weight="fill" className="size-[22px]" />
      </IconButton>
    </div>
  );
}

function MaskField({ setting, value, onChange }: { setting: Setting; value: number; onChange: (v: number) => void }) {
  const all = 2 ** setting.options.length - 1;
  const toggle = (bit: number) => {
    const next = maskOn(value, bit) ? value - 2 ** bit : value + 2 ** bit;
    if (next > 0) onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-1.5 p-px" role="group" aria-label={setting.label}>
      <Toggle variant="solid" pressed={value === all} onPressedChange={() => onChange(all)}>
        All
      </Toggle>
      {setting.options.map((o) => {
        const on = maskOn(value, o.value);
        return (
          <Toggle key={o.value} pressed={on} onPressedChange={() => toggle(o.value)}>
            {on && <CheckIcon size={14} weight="bold" />}
            {o.label}
          </Toggle>
        );
      })}
    </div>
  );
}

const remembered = (mode: ModeKey, s: Settings) => {
  const out = changedSettings(mode, s);
  for (const d of MODES[mode].settings as readonly Setting[]) if (d.kind === "seed") delete out[d.key];
  return out;
};

export function useModeSettings(mode: ModeKey) {
  const storageKey = `settings:${mode}`;
  const [params] = useSearchParams();
  const linked = params.get("settings");
  const [value, setValue] = useState<Settings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      return settingsOf(mode, linked ? { ...saved, ...JSON.parse(linked) } : saved);
    } catch {
      return settingsOf(mode);
    }
  });
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(remembered(mode, value)));
  }, [mode, storageKey, value]);
  return [value, setValue] as const;
}

export function SettingsSection({
  mode,
  value,
  onChange,
  defaultOpen,
  preview,
}: {
  mode: ModeKey;
  value: Settings;
  onChange: (next: Settings) => void;
  defaultOpen?: boolean;
  preview?: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const seed = seedSummary(mode, value);
  const summary = [...settingsSummary(mode, value), ...(seed ? [seed] : [])];
  if ((MODES[mode].settings as readonly Setting[]).length === 0) return null;
  return (
    <>
      <Disclosure
        label="Settings"
        icon={<SlidersHorizontalIcon size={20} weight="fill" />}
        title="Settings"
        defaultOpen={defaultOpen}
        onOpenChange={setOpen}
        trailing={
          summary.length > 0 && <span className="max-w-[55%] truncate text-footnote font-semibold text-primary">{summary.join(", ")}</span>
        }
      >
        <div className="pb-2 pt-2">
          <SettingsFields mode={mode} value={value} onChange={onChange} preview={open ? preview : undefined} />
        </div>
      </Disclosure>
      {!open && preview && <div className="pt-4">{preview}</div>}
    </>
  );
}
