import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  BellRingingIcon,
  CaretRightIcon,
  CheckIcon,
  BellSlashIcon,
  MusicNotesIcon,
  SpeakerHighIcon,
  PaletteIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  SignOutIcon,
  TextAaIcon,
  type Icon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { LargeTitle } from "@/components/AppHeader";
import { CardEditor } from "@/components/CardEditor";
import { PlayerCard } from "@/components/PlayerCard";
import { Segmented } from "@/components/Segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useNotifications } from "@/notifications";
import { MUSIC_TRACKS, SFX_PACKS, setSound, sfx, useSoundSettings, type MusicTrack, type SfxPack } from "@/sound";
import { useTheme } from "@/theme";
import { FONTS, PALETTES } from "@/themes";
import { cn } from "@/lib/utils";

export function You() {
  const mine = useQuery(api.profiles.mine);
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <LargeTitle title="You" />
        {mine ? <PlayerCard player={mine} online size="hero" /> : <Skeleton className="aspect-[5/6] rounded-lg" />}
        <Button size="xl" variant="secondary" className="mt-3 w-full" onClick={() => setEditing(true)} disabled={!mine}>
          <PencilSimpleIcon weight="bold" /> Edit card
        </Button>
      </div>

      {mine && <CardEditor open={editing} onOpenChange={setEditing} player={mine} />}

      <NotificationsGroup />
      <SoundGroup />
      <AppearanceGroup />
      <AccountGroup />
    </div>
  );
}

function NotificationsGroup() {
  const push = useNotifications();
  const toggle = async (next: boolean) => {
    try {
      await (next ? push.enable() : push.disable());
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  // Only when there's something to do about it.
  const footer = push.state === "blocked" ? "Notifications are blocked for Group 53. Turn them on in your phone's settings, then reopen the app." : undefined;
  return (
    <Group title="Notifications" footer={footer}>
      <Row icon={BellRingingIcon} tint="#ff453a" label="Notifications" htmlFor="push-switch">
        <Switch
          id="push-switch"
          checked={push.state === "on"}
          disabled={push.busy || push.state === "blocked" || push.state === "unsupported" || push.state === "loading"}
          onCheckedChange={(v) => void toggle(v)}
        />
      </Row>
      {push.state === "on" && (
        <Row
          icon={PaperPlaneTiltIcon}
          tint="#30d158"
          label="Send a test notification"
          onClick={() => void push.sendTest().then(() => toast.success("Sent. It should land in a few seconds."))}
        />
      )}
    </Group>
  );
}

// Music plays all over the app; effects play as you place and play tiles. Picking a track switches to
// it right away, and picking a pack plays a little game in it.
function SoundGroup() {
  const sound = useSoundSettings();
  const [sheet, setSheet] = useState<"music" | "sfx" | null>(null);
  return (
    <Group title="Sound" footer={sound.onSilent ? "Plays with your ringer off. Other audio, like Spotify, pauses while you play." : "Goes quiet when your ringer is off, and plays alongside other audio."}>
      <Row icon={MusicNotesIcon} tint="#bf5af2" label="Music" value={MUSIC_TRACKS.find((t) => t.value === sound.music)?.label} onClick={() => setSheet("music")} />
      <Row icon={SpeakerHighIcon} tint="#ff9f0a" label="Sound effects" value={SFX_PACKS.find((p) => p.value === sound.sfx)?.label} onClick={() => setSheet("sfx")} />
      <Row icon={BellSlashIcon} tint="#8e8e93" label="Play on silent" htmlFor="silent-switch">
        <Switch id="silent-switch" checked={sound.onSilent} onCheckedChange={(v) => setSound({ onSilent: v })} />
      </Row>

      <Sheet open={sheet === "music"} onClose={() => setSheet(null)} title="Music">
        <Choices options={MUSIC_TRACKS} value={sound.music} onPick={(v) => setSound({ music: v as MusicTrack })} />
      </Sheet>
      <Sheet open={sheet === "sfx"} onClose={() => setSheet(null)} title="Sound effects">
        <Choices
          options={SFX_PACKS}
          value={sound.sfx}
          onPick={(v) => {
            setSound({ sfx: v as SfxPack });
            sfx("preview");
          }}
        />
      </Sheet>
    </Group>
  );
}

// A list to pick one from, each with a line about what it is. Tapping the chosen one again plays it again.
function Choices({ options, value, onPick }: { options: readonly { value: string; label: string; about: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup">
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

function AppearanceGroup() {
  const { theme, setTheme, palette, setPalette, font, setFont } = useTheme();
  const [sheet, setSheet] = useState<"theme" | "font" | null>(null);
  return (
    <Group title="Appearance">
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
      <Row icon={PaletteIcon} tint="#ff9f0a" label="Theme" value={PALETTES.find((p) => p.id === palette)?.name} onClick={() => setSheet("theme")} />
      <Row icon={TextAaIcon} tint="#64d2ff" label="Heading font" value={FONTS.find((f) => f.id === font)?.name} onClick={() => setSheet("font")} />

      <Sheet open={sheet === "theme"} onClose={() => setSheet(null)} title="Theme">
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
      </Sheet>

      <Sheet open={sheet === "font"} onClose={() => setSheet(null)} title="Heading font">
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
      </Sheet>
    </Group>
  );
}

function AccountGroup() {
  const { signOut } = useAuthActions();
  return (
    <Group title="Account">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button type="button" className="flex min-h-[52px] w-full touch-manipulation items-center gap-3 px-4 text-left font-semibold text-destructive transition-colors active:bg-muted">
            <SignOutIcon size={22} weight="bold" /> Sign out
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>You'll need to sign in with Discord again to play.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay signed in</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void signOut()}>
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Group>
  );
}

function Group({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-1 pb-2.5 font-display text-heading">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-lg bg-card">{children}</div>
      {footer && <p className="px-1 pt-2 text-footnote text-muted-foreground">{footer}</p>}
    </section>
  );
}

// An iOS settings row: tinted icon tile, label, then a control, a value with a chevron, or nothing.
function Row({
  icon: RowIcon,
  tint,
  label,
  value,
  onClick,
  htmlFor,
  children,
}: {
  icon: Icon;
  tint: string;
  label: string;
  value?: string;
  onClick?: () => void;
  htmlFor?: string;
  children?: ReactNode;
}) {
  const inner = (
    <>
      <span className="grid size-[30px] shrink-0 place-items-center rounded-sm text-white" style={{ background: tint }}>
        <RowIcon size={18} weight="fill" />
      </span>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="flex-1 font-medium">
          {label}
        </label>
      ) : (
        <span className="flex-1 font-medium">{label}</span>
      )}
      {value && <span className="text-callout text-muted-foreground">{value}</span>}
      {onClick && <CaretRightIcon size={16} weight="bold" className="text-muted-foreground/70" />}
      {children}
    </>
  );
  const cls = "flex min-h-[52px] w-full items-center gap-3 px-4 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "touch-manipulation transition-colors active:bg-muted")}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-1">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
