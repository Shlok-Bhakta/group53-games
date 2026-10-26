import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { MODES, changedSettings, settingsOf, settingsSummary, type ModeKey, type Setting, type Settings } from "../../convex/modes";
import { Segmented } from "@/components/Segmented";
import { cn } from "@/lib/utils";

// One segmented control per setting, labelled above it.
export function SettingsFields({ mode, value, onChange }: { mode: ModeKey; value: Settings; onChange: (next: Settings) => void }) {
  const defs = MODES[mode].settings as readonly Setting[];
  return (
    <div className="flex flex-col gap-4">
      {defs.map((s) => (
        <div key={s.key} className="flex flex-col gap-1.5">
          <span className="px-1 text-footnote font-semibold text-muted-foreground">{s.label}</span>
          <Segmented
            label={s.label}
            value={String(value[s.key] ?? s.default)}
            onChange={(v) => onChange({ ...value, [s.key]: Number(v) })}
            options={s.options.map((o) => ({ value: String(o.value), label: o.label }))}
          />
        </div>
      ))}
    </div>
  );
}

// The settings for the next game you start in a mode, folded away under a row that names what you've
// changed. Remembered per mode on this phone.
export function useModeSettings(mode: ModeKey) {
  const storageKey = `settings:${mode}`;
  const [value, setValue] = useState<Settings>(() => {
    try {
      return settingsOf(mode, JSON.parse(localStorage.getItem(storageKey) ?? "{}"));
    } catch {
      return settingsOf(mode);
    }
  });
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(changedSettings(mode, value)));
  }, [mode, storageKey, value]);
  return [value, setValue] as const;
}

export function SettingsSection({ mode, value, onChange }: { mode: ModeKey; value: Settings; onChange: (next: Settings) => void }) {
  const [open, setOpen] = useState(false);
  const summary = settingsSummary(mode, value);
  if ((MODES[mode].settings as readonly Setting[]).length === 0) return null;
  return (
    <section aria-label="Settings">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full touch-manipulation items-center gap-2.5 rounded-md px-1 text-left text-callout font-semibold text-muted-foreground transition-colors active:bg-muted"
      >
        <SlidersHorizontalIcon size={20} weight="fill" />
        <span className="flex-1">Settings</span>
        {summary.length > 0 && <span className="max-w-[55%] truncate text-footnote font-semibold text-primary">{summary.join(", ")}</span>}
        <CaretDownIcon weight="bold" className={cn("shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="settings"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.8, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-2 pt-2">
              <SettingsFields mode={mode} value={value} onChange={onChange} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
