import { useState } from "react";
import { BellSlashIcon, CheckIcon, MusicNotesIcon, SpeakerHighIcon, SpeakerSimpleHighIcon, SpeakerSimpleLowIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Section } from "@/components/parts";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { MUSIC_TRACKS, SFX_PACKS, setSound, sfx, useSoundSettings, type MusicTrack, type SfxPack } from "@/sound";
import { cn } from "@/lib/utils";
import { PickSheet } from "./PickSheet";
import { SettingsRow, TINT } from "./SettingsRow";

// Music plays all over the app; effects play as you place and play tiles. The volume follows your finger,
// and picking a pack plays a little game in it.
export function SoundGroup() {
  const sound = useSoundSettings();
  const [sheet, setSheet] = useState<"music" | "sfx" | null>(null);
  return (
    <Section title="Sound" footer={sound.onSilent ? "Plays with your ringer off. Other audio, like Spotify, pauses while you play." : "Goes quiet when your ringer is off, and plays alongside other audio."}>
      <SettingsRow icon={MusicNotesIcon} tint={TINT.purple} label="Music" value={MUSIC_TRACKS.find((t) => t.value === sound.music)?.label} onClick={() => setSheet("music")} />
      {sound.music !== "off" && (
        <div className="flex min-h-[52px] items-center gap-3 px-4 py-1">
          <span className="grid size-[30px] shrink-0 place-items-center rounded-sm text-white" style={{ background: TINT.purple }}>
            <SpeakerSimpleLowIcon size={18} weight="fill" />
          </span>
          <Slider label="Music volume" className="flex-1" min={0} max={1} step={0.01} value={[sound.volume]} onValueChange={([v]) => setSound({ volume: v })} />
          <SpeakerSimpleHighIcon size={20} weight="fill" className="shrink-0 text-muted-foreground" />
        </div>
      )}
      <SettingsRow icon={SpeakerHighIcon} tint={TINT.orange} label="Sound effects" value={SFX_PACKS.find((p) => p.value === sound.sfx)?.label} onClick={() => setSheet("sfx")} />
      <SettingsRow icon={BellSlashIcon} tint={TINT.gray} label="Play on silent" htmlFor="silent-switch">
        <Switch id="silent-switch" checked={sound.onSilent} onCheckedChange={(v) => setSound({ onSilent: v })} />
      </SettingsRow>

      <PickSheet open={sheet === "music"} onClose={() => setSheet(null)} title="Music">
        <section className="flex flex-col gap-2" aria-labelledby="music-human">
          <h3 id="music-human" className="font-display text-heading">
            Made by a human
          </h3>
          <Choices label="Made by a human" options={MUSIC_TRACKS} value={sound.music} onPick={(v) => setSound({ music: v as MusicTrack })} />
        </section>
      </PickSheet>
      <PickSheet open={sheet === "sfx"} onClose={() => setSheet(null)} title="Sound effects">
        <Choices
          options={SFX_PACKS}
          value={sound.sfx}
          onPick={(v) => {
            setSound({ sfx: v as SfxPack });
            sfx("preview");
          }}
        />
      </PickSheet>
    </Section>
  );
}

// A list to pick one from, each with a line about what it is. Tapping the chosen one again plays it again.
function Choices({ label, options, value, onPick }: { label?: string; options: readonly { value: string; label: string; about: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <motion.button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          whileTap={{ scale: 0.98 }}
          onClick={() => onPick(o.value)}
          className={cn(
            "flex min-h-16 touch-manipulation items-center justify-between gap-3 rounded-lg border-2 bg-card px-4 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            value === o.value ? "border-primary" : "border-transparent",
          )}
        >
          <span className="min-w-0">
            <span className="block font-semibold">{o.label}</span>
            <span className="block text-footnote text-muted-foreground">{o.about}</span>
          </span>
          {value === o.value && <CheckIcon size={22} weight="bold" className="shrink-0 text-primary" />}
        </motion.button>
      ))}
    </div>
  );
}
