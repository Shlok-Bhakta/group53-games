import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { EyedropperIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import type { PlayerCard as Card } from "../../convex/profiles";
import { BADGES, CUSTOM_COLOR_FRAMES, EFFECTS, FRAME_COLORS, FRAMES, TAGLINE_MAX, type Frame } from "../../convex/profileOptions";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerCard } from "@/components/PlayerCard";
import { Segmented } from "@/components/Segmented";
import { Switch } from "@/components/ui/switch";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

const FRAME_NAMES: Record<Frame, string> = {
  none: "None", solid: "Solid", comet: "Comet", pulse: "Pulse", neon: "Neon",
  gold: "Gold", fire: "Fire", ice: "Ice", toxic: "Toxic", holo: "Holo", rgb: "RGB",
};
const EFFECT_NAMES: Record<string, string> = { none: "None", foil: "Foil", crt: "CRT" };

const spring = { type: "spring", stiffness: 500, damping: 36 } as const;

export function CardEditor({ open, onOpenChange, player }: { open: boolean; onOpenChange: (o: boolean) => void; player: Card }) {
  const update = useMutation(api.profiles.update).withOptimisticUpdate((store, changes) => {
    const current = store.getQuery(api.profiles.mine, {});
    if (current) store.setQuery(api.profiles.mine, {}, { ...current, ...changes });
  });
  const set = (changes: Parameters<typeof update>[0]) => void update(changes);
  const customColor = CUSTOM_COLOR_FRAMES.includes(player.frame as Frame);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[94dvh]">
        <DrawerTitle className="sr-only">Edit card</DrawerTitle>
        <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          {/* The preview stays pinned while you scroll the options. */}
          <div className="sticky top-0 z-10 -mx-4 mb-4 flex justify-center border-b border-border/60 bg-popover px-4 pb-4 pt-2 shadow-[0_10px_20px_-16px_rgb(0_0_0/0.5)]">
            <div className="w-[min(36vw,148px)]">
              <PlayerCard player={player} />
            </div>
          </div>

          <div className="flex flex-col gap-7">
            <TaglineField value={player.tagline} onSave={(tagline) => set({ tagline })} />

            <Section title="Frame">
              <div className="grid grid-cols-4 gap-2.5">
                {FRAMES.map((frame) => (
                  <Choice key={frame} selected={player.frame === frame} group="frame" onClick={() => set({ frame })} label={FRAME_NAMES[frame]}>
                    <PlayerAvatar name={player.name} image={player.image} frame={frame} frameColor={player.frameColor} glow={player.glow} size={48} />
                  </Choice>
                ))}
              </div>
            </Section>

            {customColor && (
              <Section title="Frame color">
                <div className="flex flex-wrap gap-2.5">
                  {FRAME_COLORS.map((c) => (
                    <motion.button
                      key={c}
                      type="button"
                      whileTap={{ scale: 0.88 }}
                      aria-label={`Color ${c}`}
                      aria-pressed={player.frameColor === c}
                      onClick={() => set({ frameColor: c })}
                      className="relative size-11 touch-manipulation rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      style={{ background: c }}
                    >
                      {player.frameColor.toLowerCase() === c && (
                        <motion.span layoutId="color-selected" transition={spring} className="absolute -inset-[5px] rounded-full border-[3px] border-foreground" />
                      )}
                    </motion.button>
                  ))}
                  <CustomColor value={player.frameColor} onChange={(frameColor) => set({ frameColor })} selected={!FRAME_COLORS.includes(player.frameColor.toLowerCase() as never)} />
                </div>
              </Section>
            )}

            <div className="flex min-h-[56px] items-center justify-between rounded-2xl border bg-card px-4">
              <label htmlFor="glow" className="font-medium">
                Glow
              </label>
              <Switch id="glow" checked={player.glow} disabled={player.frame === "none"} onCheckedChange={(glow) => set({ glow })} />
            </div>

            <Section title="Effect">
              <Segmented label="Effect" value={player.effect} onChange={(effect) => set({ effect })} options={EFFECTS.map((e) => ({ value: e, label: EFFECT_NAMES[e] }))} />
            </Section>

            <Section title="Badge">
              <div className="grid grid-cols-6 gap-2">
                {BADGES.map((badge) => (
                  <Choice key={badge || "none"} selected={player.badge === badge} group="badge" onClick={() => set({ badge })} ariaLabel={badge || "No badge"} square>
                    {badge ? <span className="text-[1.6rem] leading-none">{badge}</span> : <span className="text-xs font-semibold text-muted-foreground">None</span>}
                  </Choice>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[13px] font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Choice({
  selected,
  group,
  onClick,
  label,
  ariaLabel,
  square,
  children,
}: {
  selected: boolean;
  group: string;
  onClick: () => void;
  label?: string;
  ariaLabel?: string;
  square?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      aria-pressed={selected}
      aria-label={ariaLabel ?? label}
      onClick={onClick}
      className={cn(
        "relative flex touch-manipulation flex-col items-center justify-center gap-1.5 rounded-2xl bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        square ? "aspect-square" : "py-3",
      )}
    >
      {selected && <motion.span layoutId={`${group}-selected`} transition={spring} className="absolute inset-0 rounded-2xl border-2 border-primary bg-primary/8" />}
      <span className="relative">{children}</span>
      {label && <span className={cn("relative text-[11px] font-semibold", selected ? "text-primary" : "text-muted-foreground")}>{label}</span>}
    </motion.button>
  );
}

// The native picker opens from a hidden color input behind a rainbow swatch.
function CustomColor({ value, onChange, selected }: { value: string; onChange: (c: string) => void; selected: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <label className="relative grid size-11 cursor-pointer touch-manipulation place-items-center rounded-full bg-[conic-gradient(#ff4d4d,#ffd24d,#4dff88,#4dd2ff,#9b4dff,#ff4dd2,#ff4d4d)]">
      <span className="grid size-7 place-items-center rounded-full bg-card">
        <EyedropperIcon size={16} weight="bold" />
      </span>
      {selected && <motion.span layoutId="color-selected" transition={spring} className="absolute -inset-[5px] rounded-full border-[3px] border-foreground" />}
      <input
        type="color"
        aria-label="Custom color"
        value={value}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        onChange={(e) => {
          const c = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(c), 120);
        }}
      />
    </label>
  );
}

// A textarea rather than an input: iOS offers saved passwords on single-line text fields.
function TaglineField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(value), [value]);
  const change = (v: string) => {
    const clean = v.replace(/\n/g, "");
    setDraft(clean);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(clean), 600);
  };
  return (
    <Section title="Tagline">
      <div className="relative">
        <textarea
          name="card-tagline"
          rows={1}
          value={draft}
          maxLength={TAGLINE_MAX}
          placeholder="Certified word guesser"
          autoComplete="off"
          autoCorrect="on"
          spellCheck
          enterKeyHint="done"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          onChange={(e) => change(e.target.value)}
          onBlur={() => draft !== value && onSave(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="block min-h-14 w-full resize-none rounded-2xl border bg-card px-4 py-4 pr-16 text-[17px] leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground">
          {draft.length}/{TAGLINE_MAX}
        </span>
      </div>
    </Section>
  );
}
