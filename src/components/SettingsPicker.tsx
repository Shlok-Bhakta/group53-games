import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { CheckIcon, DiceFiveIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { MODES, SEED_MAX, changedSettings, maskOn, seedSummary, settingApplies, settingsOf, settingsSummary, type ModeKey, type Setting, type Settings } from "../../convex/modes";
import { Segmented } from "@/components/Segmented";
import { Disclosure } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

// One control per setting, labelled above it: a segmented control for a few choices, a number with a dice for a
// seed, and chips to tick for a pick-any (golf's items). Settings that don't apply to the rest (a seed for a
// course made by hand) are left out.
function SettingsFields({ mode, value, onChange }: { mode: ModeKey; value: Settings; onChange: (next: Settings) => void }) {
  const defs = (MODES[mode].settings as readonly Setting[]).filter((s) => settingApplies(s, value));
  return (
    <div className="flex flex-col gap-4">
      {defs.map((s) => (
        <div key={s.key} className="flex flex-col gap-1.5">
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
              options={s.options.map((o) => ({ value: String(o.value), label: o.label }))}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// A seed: blank (or 0) rolls a new one when the game's made; type one in to play the same holes again.
// Changes go out when you're done typing, not on every key.
function SeedField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => setText(value ? String(value) : ""), [value]);
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
      <button
        type="button"
        aria-label="New random seed"
        onClick={() => {
          setText("");
          onChange(0);
        }}
        className="grid size-11 shrink-0 place-items-center rounded-md bg-muted transition-transform duration-100 active:scale-[0.94]"
      >
        <DiceFiveIcon size={22} weight="fill" />
      </button>
    </div>
  );
}

// Tick any of them; at least one stays on. "All" turns everything back on.
function MaskField({ setting, value, onChange }: { setting: Setting; value: number; onChange: (v: number) => void }) {
  const all = 2 ** setting.options.length - 1;
  const toggle = (bit: number) => {
    const next = maskOn(value, bit) ? value - 2 ** bit : value + 2 ** bit;
    if (next > 0) onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={setting.label}>
      <button
        type="button"
        aria-pressed={value === all}
        onClick={() => onChange(all)}
        className={cn("min-h-11 rounded-full px-3.5 text-footnote font-semibold transition-transform duration-100 active:scale-[0.96]", value === all ? "bg-primary text-primary-foreground" : "bg-muted")}
      >
        All
      </button>
      {setting.options.map((o) => {
        const on = maskOn(value, o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={cn("flex min-h-11 items-center gap-1 rounded-full px-3.5 text-footnote font-semibold transition-transform duration-100 active:scale-[0.96]", on ? "bg-primary/15 text-foreground ring-1 ring-primary/50" : "bg-muted text-muted-foreground line-through decoration-muted-foreground/60")}
          >
            {on && <CheckIcon size={14} weight="bold" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Settings that are only for one game: a seed is rolled fresh every time unless you type one in, so it isn't
// remembered.
const remembered = (mode: ModeKey, s: Settings) => {
  const out = changedSettings(mode, s);
  for (const d of MODES[mode].settings as readonly Setting[]) if (d.kind === "seed") delete out[d.key];
  return out;
};

// The settings for the next game you start in a mode, folded away under a row that names what you've
// changed. Remembered per mode on this phone. A link can bring its own (`?settings=`, "Play these holes"),
// seed and all.
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

export function SettingsSection({ mode, value, onChange, defaultOpen }: { mode: ModeKey; value: Settings; onChange: (next: Settings) => void; defaultOpen?: boolean }) {
  const seed = seedSummary(mode, value);
  const summary = [...settingsSummary(mode, value), ...(seed ? [seed] : [])];
  if ((MODES[mode].settings as readonly Setting[]).length === 0) return null;
  return (
    <Disclosure
      label="Settings"
      icon={<SlidersHorizontalIcon size={20} weight="fill" />}
      title="Settings"
      defaultOpen={defaultOpen}
      trailing={summary.length > 0 && <span className="max-w-[55%] truncate text-footnote font-semibold text-primary">{summary.join(", ")}</span>}
    >
      <div className="pb-2 pt-2">
        <SettingsFields mode={mode} value={value} onChange={onChange} />
      </div>
    </Disclosure>
  );
}
