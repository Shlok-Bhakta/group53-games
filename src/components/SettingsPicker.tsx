import { useEffect, useState } from "react";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { MODES, changedSettings, settingsOf, settingsSummary, type ModeKey, type Setting, type Settings } from "../../convex/modes";
import { Segmented } from "@/components/Segmented";
import { Disclosure } from "@/components/ui/disclosure";

// One segmented control per setting, labelled above it.
function SettingsFields({ mode, value, onChange }: { mode: ModeKey; value: Settings; onChange: (next: Settings) => void }) {
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
  const summary = settingsSummary(mode, value);
  if ((MODES[mode].settings as readonly Setting[]).length === 0) return null;
  return (
    <Disclosure
      label="Settings"
      icon={<SlidersHorizontalIcon size={20} weight="fill" />}
      title="Settings"
      trailing={summary.length > 0 && <span className="max-w-[55%] truncate text-footnote font-semibold text-primary">{summary.join(", ")}</span>}
    >
      <div className="pb-2 pt-2">
        <SettingsFields mode={mode} value={value} onChange={onChange} />
      </div>
    </Disclosure>
  );
}
