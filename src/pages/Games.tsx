import { Link } from "react-router";
import { motion } from "motion/react";
import { HammerIcon, LockSimpleIcon, PlayIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { games } from "@/games";
import { ChessBanner } from "@/games/chess/ChessBanner";
import { Tiles } from "@/Tiles";
import { Button } from "@/components/ui/button";
import { LargeTitle } from "@/components/AppHeader";
import { NotificationBanner } from "@/components/NotificationBanner";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useNotifications } from "@/notifications";
import { usePlayingIn } from "@/presence";
import { shareLink } from "@/share";

// Every game, one card each, with its art playing in once when you land here.
export function Games() {
  const push = useNotifications();
  const locked = push.state !== "on" && push.state !== "unsupported";

  return (
    <div className="flex flex-col gap-5">
      <LargeTitle title="Games" />
      <NotificationBanner push={push} />

      {games.map((g, i) => (
        <motion.article
          key={g.path}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", bounce: 0, duration: 0.45, delay: i * 0.06 }}
          className="overflow-hidden rounded-lg bg-card"
        >
          <div className="relative grid place-items-center bg-muted/60 px-4 py-9 [background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_9%,transparent)_1px,transparent_1px)] [background-size:14px_14px]">
            {g.art === "chess" ? <ChessBanner /> : <Tiles word={g.tiles.word} states={g.tiles.states} flip label={g.name} />}
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-title">{g.name}</h2>
              {g.wip ? (
                <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-footnote font-semibold text-muted-foreground">
                  <HammerIcon weight="bold" /> Soon
                </span>
              ) : (
                <PlayingNow gamePath={g.path} />
              )}
            </div>
            <p className="mt-1.5 text-callout text-muted-foreground">{g.blurb}</p>
            <div className="mt-5 flex gap-2.5">
              {g.wip ? (
                <Button size="xl" className="flex-1" variant="secondary" disabled>
                  Coming soon
                </Button>
              ) : locked ? (
                <Button size="xl" className="flex-1" variant="secondary" disabled>
                  <LockSimpleIcon weight="bold" /> Locked
                </Button>
              ) : (
                <Button size="xl" className="flex-1" asChild>
                  <Link to={g.path}>
                    <PlayIcon weight="fill" /> Play
                  </Link>
                </Button>
              )}
              <Button size="xl" variant="secondary" className="w-14 px-0" aria-label={`Share ${g.name}`} onClick={() => void shareLink(g.path, `${g.name} on Group 53:`)}>
                <ShareNetworkIcon weight="bold" />
              </Button>
            </div>
          </div>
        </motion.article>
      ))}
    </div>
  );
}

// Only people actually in this game, not everyone with the app open.
function PlayingNow({ gamePath }: { gamePath: string }) {
  const playing = usePlayingIn(gamePath);
  if (playing.length === 0) return null;
  const label = playing.length === 1 ? `${playing[0].name} is playing` : `${playing.length} playing`;
  return (
    <span className="flex min-w-0 items-center gap-2 text-footnote font-medium text-muted-foreground">
      <span className="flex shrink-0 -space-x-2">
        {playing.slice(0, 3).map((p) => (
          <PlayerAvatar key={p._id} name={p.name} image={p.image} size={24} className="rounded-full ring-2 ring-card" />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
