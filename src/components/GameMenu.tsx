import type { ReactNode } from "react";
import { ListIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import type { MatchView } from "../../convex/matches";
import { MODES, GAMES, gameOf, matchPath, settingApplies, settingLabel, settingsOf, type ModeKey, type Setting } from "../../convex/modes";
import { Group, SectionTitle } from "@/components/parts";
import { Rules } from "@/components/Rules";
import { Button, IconButton } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { shareLink } from "@/share";
import { cn } from "@/lib/utils";

export function MenuButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <IconButton label="Menu" onClick={onClick} className={className}>
      <ListIcon size={22} weight="bold" />
    </IconButton>
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
        <div className="flex h-full flex-col overflow-y-auto overscroll-contain pl-4 pr-[max(1rem,var(--safe-right))] pb-[calc(var(--safe-bottom)+20px)] pt-[calc(var(--safe-top)+34px)]">
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
            onClick={() =>
              void shareLink(matchPath(match), `${mode?.name ?? ""} ${GAMES[gameOf(match.mode)].name.toLowerCase()} on Group 53:`)
            }
          >
            <ShareNetworkIcon weight="bold" /> Share this game
          </Button>
          {footer && <div className="mt-auto pt-8">{footer}</div>}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function MatchSettings({ match }: { match: MatchView }) {
  const value = settingsOf(match.mode, match.settings);
  const defs = ((MODES[match.mode as ModeKey]?.settings ?? []) as readonly Setting[]).filter((s) => settingApplies(s, value));
  if (defs.length === 0) return null;
  return (
    <section aria-label="Game settings" className="pt-6">
      <SectionTitle className="pb-2">Settings</SectionTitle>
      <Group className="bg-muted/50">
        {defs.map((s) => (
          <div key={s.key} className="flex min-h-12 items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 text-callout text-muted-foreground">{s.label}</span>
            <span className={cn("shrink-0 text-callout font-semibold", value[s.key] !== s.default && s.kind !== "seed" && "text-primary")}>
              {settingLabel(match.mode, s.key, value[s.key])}
            </span>
          </div>
        ))}
      </Group>
    </section>
  );
}
