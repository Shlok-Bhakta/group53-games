import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { GameControllerIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import { MODES, MODE_KEYS, modeBySlug, modePath } from "../../convex/modes";
import { Chip, InviteCard, MatchRow, Section, TurnChip } from "@/games/chess/parts";
import { Tiles } from "@/Tiles";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LargeTitle } from "@/components/AppHeader";
import { NotificationBanner } from "@/components/NotificationBanner";
import { useNotifications } from "@/notifications";

// Home: what's going on with your games. Each section shows up only when it has something in it.
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
            <section aria-label="Challenges" className="flex flex-col gap-2.5">
              <h2 className="px-1 font-display text-heading">Challenges</h2>
              <AnimatePresence initial={false}>
                {inbox.invites.map((m) => (
                  <InviteCard key={m._id} match={m} />
                ))}
              </AnimatePresence>
            </section>
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
          <Stats />
          {waiting.length > 0 && (
            <Section title="Waiting">
              {waiting.map((m) => (
                <MatchRow
                  key={m._id}
                  match={m}
                  meId={meId}
                  status={m.status === "waiting" ? <Chip tone="quiet">{m.players.length > 1 || m.invited.length === 0 ? "Open" : "Sent"}</Chip> : <TurnChip match={m} meId={meId} />}
                />
              ))}
            </Section>
          )}
          {inbox.watch.length > 0 && (
            <Section title="Happening now">
              {inbox.watch.map((m) => (
                <MatchRow key={m._id} match={m} meId={meId} vs status={<Chip tone={MODES[m.mode as keyof typeof MODES]?.kind === "realtime" ? "live" : "quiet"}>Watch</Chip>} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// Old pushes and links pointed at /?new=<mode>; send them to that mode's page.
function useLegacyNewGameLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slug = params.get("new");
  useEffect(() => {
    if (slug === null) return;
    const mode = modeBySlug(slug);
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

// My rating in each mode I've played, as small stat cards.
function Stats() {
  const ratings = useQuery(api.ratings.mine);
  const played = MODE_KEYS.filter((m) => (ratings?.[m]?.games ?? 0) > 0);
  if (!ratings || played.length === 0) return null;
  return (
    <section aria-label="Your ratings" className="flex flex-col gap-2.5">
      <h2 className="px-1 font-display text-heading">Your ratings</h2>
      <div className="grid grid-cols-2 gap-3">
        {played.map((m, i) => {
          const r = ratings[m]!;
          return (
            <StatCard key={m} to={modePath(m)} delay={i * 0.04} label={MODES[m].name} value={r.rating}>
              {r.wins}–{r.losses}
              {r.draws ? `–${r.draws}` : ""}
            </StatCard>
          );
        })}
      </div>
    </section>
  );
}

function StatCard({ to, label, value, delay, children }: { to: string; label: string; value: number; delay: number; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.4, delay }}>
      <Link to={to} className="flex min-h-[88px] flex-col justify-between rounded-lg bg-card p-3.5 transition-[transform,background-color] duration-100 ease-out active:scale-[0.97] active:bg-muted">
        <span className="truncate text-footnote font-semibold text-muted-foreground">{label}</span>
        <span className="flex items-end justify-between gap-2">
          <span className="font-display text-title tabular-nums">{value}</span>
          <span className="pb-1 text-footnote tabular-nums text-muted-foreground">{children}</span>
        </span>
      </Link>
    </motion.div>
  );
}
