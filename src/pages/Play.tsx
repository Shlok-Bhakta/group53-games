import { useState, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MatchView } from "../../convex/matches";
import { games } from "@/games";
import { Chip, Group, InviteCard, MatchRow, ResultChip, Section, TurnChip } from "@/games/chess/parts";
import { Tiles } from "@/Tiles";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LargeTitle } from "@/components/AppHeader";
import { NotificationBanner } from "@/components/NotificationBanner";
import { useNotifications } from "@/notifications";
import { cn } from "@/lib/utils";

// The Play tab: what needs you first (challenges, your moves, live games, open seats), then games to watch,
// games waiting on someone else folded into one row, and your recent results. Starting a game is the + button.
export function Play() {
  const push = useNotifications();
  const locked = push.state !== "on" && push.state !== "unsupported";
  const inbox = useQuery(api.matches.inbox);
  const me = useQuery(api.users.me);
  const meId = me?._id;

  const needs = inbox ? inbox.invites.length + inbox.myTurn.length + inbox.live.length : 0;
  const subtitle = locked || !inbox ? undefined : needs === 0 ? "Nothing needs you right now" : `${needs} game${needs > 1 ? "s" : ""} need${needs > 1 ? "" : "s"} you`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <LargeTitle title="Play" subtitle={subtitle} />
        {locked && <NotificationBanner push={push} />}
      </div>
      {!locked && (inbox === undefined ? <Skeleton className="h-48 rounded-lg" /> : inbox && <Games inbox={inbox} meId={meId} />)}
      <ComingSoon />
    </div>
  );
}

type Inbox = NonNullable<FunctionReturnType<typeof api.matches.inbox>>;

function Games({ inbox, meId }: { inbox: Inbox; meId: Id<"users"> | undefined }) {
  const now = [
    ...inbox.myTurn.map((m) => ({ match: m, status: <TurnChip match={m} meId={meId} /> })),
    ...inbox.live.map((m) => ({ match: m, status: <TurnChip match={m} meId={meId} /> })),
    ...inbox.open.map((m) => ({ match: m, status: <Chip>Join</Chip> })),
  ];
  const later = [
    ...inbox.theirTurn.map((m) => ({ match: m, status: <TurnChip match={m} meId={meId} /> })),
    ...inbox.waiting.map((m) => ({ match: m, status: <Chip tone="quiet">{m.players.length > 1 || (m.invited.length === 0) ? "Waiting" : "Sent"}</Chip> })),
  ];
  const empty = inbox.invites.length === 0 && now.length === 0;

  return (
    <>
      {(inbox.invites.length > 0 || now.length > 0 || later.length > 0) && (
        <section aria-label="Your games" className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {inbox.invites.map((m) => (
              <InviteCard key={m._id} match={m} />
            ))}
          </AnimatePresence>
          {(now.length > 0 || later.length > 0) && (
            <Group>
              {now.map(({ match, status }) => (
                <MatchRow key={match._id} match={match} meId={meId} status={status} />
              ))}
              {later.length > 0 && <Later rows={later} meId={meId} folded={now.length > 0 || inbox.invites.length > 0} />}
            </Group>
          )}
        </section>
      )}
      {empty && <AllClear />}

      {inbox.watch.length > 0 && (
        <Section title="Happening now">
          {inbox.watch.map((m) => (
            <MatchRow key={m._id} match={m} meId={meId} vs status={MODE_LIVE(m) ? <Chip tone="live">Watch</Chip> : <Chip tone="quiet">Watch</Chip>} />
          ))}
        </Section>
      )}

      {inbox.recent.length > 0 && (
        <Section title="Recent">
          {inbox.recent.map((m) => (
            <MatchRow key={m._id} match={m} meId={meId} status={<ResultChip match={m} meId={meId} />} />
          ))}
        </Section>
      )}
    </>
  );
}

const MODE_LIVE = (m: MatchView) => m.mode.startsWith("chess:realtime");

// Games waiting on someone else. When something needs you, they fold into one row underneath.
function Later({ rows, meId, folded }: { rows: { match: MatchView; status: ReactNode }[]; meId: Id<"users"> | undefined; folded: boolean }) {
  const [open, setOpen] = useState(!folded);
  return (
    <>
      {folded && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-13 w-full touch-manipulation items-center justify-between gap-3 px-4 text-left text-callout font-medium text-muted-foreground transition-colors active:bg-muted"
        >
          {rows.length} game{rows.length > 1 ? "s" : ""} waiting on others
          <CaretDownIcon weight="bold" className={cn("transition-transform duration-200", open && "rotate-180")} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="later" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }} className="divide-y divide-border overflow-hidden">
            {rows.map(({ match, status }) => (
              <MatchRow key={match._id} match={match} meId={meId} status={status} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AllClear() {
  const [, setParams] = useSearchParams();
  return (
    <section aria-label="Nothing to do" className="flex flex-col items-start gap-4 px-1">
      <Tiles word="IDLE" states={["gray", "gray", "yellow", "gray"]} size="sm" label="Idle" />
      <p className="text-callout text-muted-foreground">No moves to make and no challenges waiting. Start something.</p>
      <Button size="lg" onClick={() => setParams((p) => (p.set("new", "1"), p), { replace: true })}>
        <PlusIcon weight="bold" /> Start a game
      </Button>
    </section>
  );
}

// Games that aren't playable yet, one line each.
function ComingSoon() {
  const soon = games.filter((g) => g.wip);
  if (soon.length === 0) return null;
  return (
    <section aria-label="Coming soon" className="flex flex-col gap-3 px-1 pt-1">
      {soon.map((g) => (
        <div key={g.path} className="flex items-center gap-3.5">
          <Tiles word={g.tiles.word} states={g.tiles.states} size="sm" label={g.name} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{g.name}</span>
            <span className="block truncate text-footnote text-muted-foreground">Coming soon</span>
          </span>
        </div>
      ))}
    </section>
  );
}
