import type { ReactNode } from "react";
import { ListIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import type { MatchView } from "../../convex/matches";
import { MODES, GAMES, gameOf, matchPath, settingLabel, settingsOf, type ModeKey, type Setting } from "../../convex/modes";
import { Group, SectionTitle } from "@/components/parts";
import { Rules } from "@/components/Rules";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { shareLink } from "@/share";
import { cn } from "@/lib/utils";

// The menu every game screen has, sliding in from the right: whatever the game puts on top (Scrabble's scores
// and words), then the game's settings, how to play, sharing, and a footer pinned to the bottom (resigning).

export function MenuButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Menu" onClick={onClick} className={className}>
      <ListIcon size={22} weight="bold" />
    </Button>
  );
}

export function GameMenu({
  open,
  onOpenChange,
  match,
  title,
  rules,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: MatchView;
  title: string;
  rules: string[];
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const mode = MODES[match.mode as ModeKey];
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-[86%] max-w-sm overflow-hidden" aria-describedby={undefined}>
        <div className="flex h-full flex-col overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-[calc(env(safe-area-inset-top)+34px)]">
          <DrawerHeader className="px-1 pb-3 text-left">
            <DrawerTitle className="font-display text-title">{title}</DrawerTitle>
          </DrawerHeader>
          {children}
          <MatchSettings match={match} />
          <div className="pt-4">
            <Rules rules={rules} defaultOpen={false} />
          </div>
          <Button
            variant="secondary"
            className="mt-2 h-14 w-full rounded-lg"
            onClick={() => void shareLink(matchPath(match), `${mode?.name ?? ""} ${GAMES[gameOf(match.mode)].name.toLowerCase()} on Group 53:`)}
          >
            <ShareNetworkIcon weight="bold" /> Share this game
          </Button>
          {footer && <div className="mt-auto pt-8">{footer}</div>}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// Every setting this game is played with, the ones the host changed from the default in the primary color.
function MatchSettings({ match }: { match: MatchView }) {
  const defs = (MODES[match.mode as ModeKey]?.settings ?? []) as readonly Setting[];
  if (defs.length === 0) return null;
  const value = settingsOf(match.mode, match.settings);
  return (
    <section aria-label="Game settings" className="pt-6">
      <SectionTitle className="pb-2">Settings</SectionTitle>
      <Group className="bg-muted/50">
        {defs.map((s) => (
          <div key={s.key} className="flex min-h-12 items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 text-callout text-muted-foreground">{s.label}</span>
            <span className={cn("shrink-0 text-callout font-semibold", value[s.key] !== s.default && "text-primary")}>{settingLabel(match.mode, s.key, value[s.key])}</span>
          </div>
        ))}
      </Group>
    </section>
  );
}
