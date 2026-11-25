import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { AnimatePresence } from "motion/react";
import { GameControllerIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import { MODES, modeBySlug, modePath } from "../../convex/modes";
import { Chip, InviteCard, MatchRow, Section, TurnChip } from "@/components/parts";
import { Tiles } from "@/Tiles";
import { DailyStrip } from "@/games";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LargeTitle } from "@/components/AppHeader";
import { NotificationBanner } from "@/components/NotificationBanner";
import { useNotifications } from "@/notifications";

export function Home() {
  const push = useNotifications();
  const locked = push.state !== "on" && push.state !== "unsupported";
  const inbox = useQuery(api.matches.inbox);
  const me = useQuery(api.users.me);
  const meId = me?._id;
  useLegacyNewGameLink();

  const yourTurn = inbox ? [...inbox.myTurn, ...inbox.live] : [];
  const waiting = inbox ? [...inbox.theirTurn, ...inbox.waiting] : [];
  const nothing = inbox && inbox.invites.length === 0 && yourTurn.length === 0 && inbox.open.length === 0 && waiting.length === 0;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <LargeTitle title="Home" />
        <NotificationBanner push={push} />
      </div>
      {!locked && inbox === undefined && <Skeleton className="h-40 rounded-lg" />}
      {!locked && inbox && (
        <>
          {inbox.invites.length > 0 && (
            <Section title="Challenges" bare>
              <div className="flex flex-col gap-2.5">
                <AnimatePresence initial={false}>
                  {inbox.invites.map((m) => (
                    <InviteCard key={m._id} match={m} />
                  ))}
                </AnimatePresence>
              </div>
            </Section>
          )}
          {yourTurn.length > 0 && (
            <Section title="Your turn">
              {yourTurn.map((m) => (
                <MatchRow key={m._id} match={m} meId={meId} status={<TurnChip match={m} meId={meId} />} />
              ))}
            </Section>
          )}
          {inbox.open.length > 0 && (
            <Section title="Open seats">
              {inbox.open.map((m) => (
                <MatchRow key={m._id} match={m} meId={meId} status={<Chip>Join</Chip>} />
              ))}
            </Section>
          )}
          {nothing && <AllClear />}
          <DailyStrip meId={meId} />
          {waiting.length > 0 && (
            <Section title="Waiting">
              {waiting.map((m) => (
                <MatchRow
                  key={m._id}
                  match={m}
                  meId={meId}
                  status={
                    m.status === "waiting" ? (
                      <Chip tone="quiet">{m.players.length > 1 || m.invited.length === 0 ? "Open" : "Sent"}</Chip>
                    ) : (
                      <TurnChip match={m} meId={meId} />
                    )
                  }
                />
              ))}
            </Section>
          )}
          {inbox.watch.length > 0 && (
            <Section title="Happening now">
              {inbox.watch.map((m) => (
                <MatchRow
                  key={m._id}
                  match={m}
                  meId={meId}
                  vs
                  status={<Chip tone={MODES[m.mode as keyof typeof MODES]?.kind === "realtime" ? "live" : "quiet"}>Watch</Chip>}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function useLegacyNewGameLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slug = params.get("new");
  useEffect(() => {
    if (slug === null) return;
    const mode = modeBySlug("chess", slug);
    navigate(mode ? modePath(mode) : "/games", { replace: true });
  }, [slug, navigate]);
}

function AllClear() {
  return (
    <section aria-label="No games" className="flex flex-col items-start gap-4 px-1">
      <Tiles word="IDLE" states={["gray", "gray", "yellow", "gray"]} size="sm" label="Idle" />
      <Button size="lg" asChild>
        <Link to="/games">
          <GameControllerIcon weight="fill" /> Find a game
        </Link>
      </Button>
    </section>
  );
}
