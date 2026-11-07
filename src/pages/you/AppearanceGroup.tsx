import { useState } from "react";
import { CheckIcon, PaletteIcon, TextAaIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Section } from "@/components/parts";
import { Segmented } from "@/components/Segmented";
import { useTheme } from "@/theme";
import { FONTS, PALETTES } from "@/themes";
import { cn } from "@/lib/utils";
import { PickSheet } from "./PickSheet";
import { SettingsRow, TINT } from "./SettingsRow";

export function AppearanceGroup() {
  const { theme, setTheme, palette, setPalette, font, setFont } = useTheme();
  const [sheet, setSheet] = useState<"theme" | "font" | null>(null);
  return (
    <Section title="Appearance">
      <div className="p-3">
        <Segmented
          label="Mode"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "Auto" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      <SettingsRow icon={PaletteIcon} tint={TINT.orange} label="Theme" value={PALETTES.find((p) => p.id === palette)?.name} onClick={() => setSheet("theme")} />
      <SettingsRow icon={TextAaIcon} tint={TINT.cyan} label="Heading font" value={FONTS.find((f) => f.id === font)?.name} onClick={() => setSheet("font")} />

      <PickSheet open={sheet === "theme"} onClose={() => setSheet(null)} title="Theme">
        <div className="grid grid-cols-2 gap-3">
          {PALETTES.map((p) => (
            <motion.button
              key={p.id}
              type="button"
              whileTap={{ scale: 0.96 }}
              data-palette={p.id}
              aria-pressed={palette === p.id}
              onClick={() => setPalette(p.id)}
              className="relative flex touch-manipulation flex-col gap-3 rounded-lg bg-background p-3 text-left text-foreground outline-none ring-1 ring-border focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* 19px is the card's 16 plus the 3px it sits out, so the ring runs parallel to the corner. */}
              {palette === p.id && (
                <motion.span layoutId="theme-selected" className="absolute -inset-[3px] rounded-[19px] border-[3px] border-primary" transition={{ type: "spring", bounce: 0, duration: 0.3 }} />
              )}
              <span className="flex items-center gap-1" aria-hidden="true">
                {(["green", "yellow", "gray", "hit"] as const).map((c) => (
                  <span key={c} className={`tile tile-${c}`} style={{ width: 22, height: 22, borderRadius: 5 }} />
                ))}
              </span>
              <span className="flex items-center justify-between rounded-md bg-card px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-bold leading-tight">{p.name}</span>
                  <span className="block truncate text-footnote text-muted-foreground">{p.note}</span>
                </span>
                <span className="size-5 shrink-0 rounded-full bg-primary" />
              </span>
            </motion.button>
          ))}
        </div>
      </PickSheet>

      <PickSheet open={sheet === "font"} onClose={() => setSheet(null)} title="Heading font">
        <div className="flex flex-col gap-2">
          {FONTS.map((f) => (
            <motion.button
              key={f.id}
              type="button"
              whileTap={{ scale: 0.98 }}
              data-font={f.id}
              aria-pressed={font === f.id}
              onClick={() => setFont(f.id)}
              style={{ fontFamily: "var(--app-font)" }}
              className={cn(
                "flex min-h-[72px] touch-manipulation items-center justify-between gap-3 rounded-lg border-2 bg-card px-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                font === f.id ? "border-primary" : "border-transparent",
              )}
            >
              <span>
                <span className="block font-display text-heading">Group 53</span>
                <span className="block text-footnote text-muted-foreground">{f.name}</span>
              </span>
              {font === f.id && <CheckIcon size={22} weight="bold" className="shrink-0 text-primary" />}
            </motion.button>
          ))}
        </div>
      </PickSheet>
    </Section>
  );
}
