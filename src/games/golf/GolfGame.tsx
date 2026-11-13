import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { CaretLeftIcon, ListIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { scoreName, type Course } from "../../../convex/golf/engine";
import { totals, vsPar, type GolfState } from "../../../convex/golf/round";
import { useGoBack } from "@/components/AppHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Result } from "@/components/match";
import { Sheet } from "@/components/ui/sheet";
import { Countdown } from "@/components/game/Countdown";
import { FloatButton, FloatPill, FloatingTopBar, FullscreenStage } from "@/components/game/floating";
import { useTurnText } from "@/components/game/TurnText";
import { ThinkingDots } from "@/presence";
import { seatColor } from "@/games/seats";
import { sfx } from "@/sound";
import { cn } from "@/lib/utils";
import GolfWorld, { type Round } from "./GolfWorld";
import { GolfMenu, SeedRow } from "./GolfMenu";
import { Scorecard } from "./Scorecard";

// A game of golf (convex/golf.ts): the hole being played takes the whole screen, with whose turn it is up top
// and the card in the menu. Between holes the last one's scores come up over the next. Once it's over, the
// result and the card.
//
// Coming back to a turn-based game catches you up: every shot since this phone last looked plays out, one after
// another as it happened (the waits skipped), hole by hole with each finished hole's scores, then it's live.

// Where this phone last watched the game up to: a hole, and a tick in it.
type Seen = { hole: number; tick: number };
const seenKey = (id: string) => `golf-seen:${id}`;
function readSeen(id: string): Seen | null {
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(id)) ?? "null");
    return v && typeof v.hole === "number" && typeof v.tick === "number" ? v : null;
  } catch {
    return null;
  }
}

export function GolfGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const st = match.state as GolfState | null;
  const holes = useQuery(api.golf.holes, { matchId: match._id });
  const [menu, setMenu] = useState(false);
  const [card, setCard] = useState<number | null>(null);
  const seat = match.players.findIndex((p) => p.userId === meId);
  const playing = seat >= 0 && !!st && !st.out.includes(seat);
  // Opening the game (or coming back to it) stands the caddie down, and restarts a course that stopped building.
  const here = useMutation(api.golf.here);
  const active = match.status === "active";
  useEffect(() => {
    if (!active || seat < 0) return;
    const ping = () => document.visibilityState === "visible" && void here({ id: match._id }).catch(() => {});
    ping();
    document.addEventListener("visibilitychange", ping);
    return () => document.removeEventListener("visibilitychange", ping);
  }, [active, seat, match._id, here]);

  // Catching up: which hole's playing back, and from where. Starts on opening and on coming back to the app.
  const [catchUp, setCatchUp] = useState<{ hole: number; from: number } | null>(null);
  const [shooter, setShooter] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false); // there's something to play back, and it's playing
  const hole = st?.hole ?? -1;
  const holeRef = useRef(hole);
  holeRef.current = hole;
  // A game that finished while you were away plays out too, then shows the result.
  const finished = match.status === "finished";
  const canCatchUp = match.mode === "golf:turns" && (active || finished) && hole >= 0;
  const pending = useRef(false); // a catch-up's been decided on and hasn't finished yet
  useEffect(() => {
    if (!canCatchUp) return;
    const begin = () => {
      if (document.visibilityState !== "visible") return;
      const seen = readSeen(match._id);
      if (seen ? seen.hole > holeRef.current : finished) return;
      pending.current = true;
      setCatchUp((c) => c ?? (seen ? { hole: seen.hole, from: seen.tick } : { hole: holeRef.current, from: 0 }));
    };
    begin();
    document.addEventListener("visibilitychange", begin);
    return () => document.removeEventListener("visibilitychange", begin);
  }, [canCatchUp, finished, match._id]);
  const caughtUp = useCallback((h: number) => {
    setShooter(null);
    setReplaying(false);
    // A finished hole: its scores come up while the next one plays back.
    if (h < holeRef.current) {
      setCard(h);
      setCatchUp({ hole: h + 1, from: 0 });
    } else {
      pending.current = false;
      setCatchUp(null);
    }
  }, []);
  const onSeen = useCallback((tick: number) => localStorage.setItem(seenKey(match._id), JSON.stringify({ hole: holeRef.current, tick })), [match._id]);
  // Once the result's on screen (not just about to catch up first) there's nothing left to catch up on.
  const total = st?.total ?? 0;
  useEffect(() => {
    if (finished && !catchUp && !pending.current) localStorage.setItem(seenKey(match._id), JSON.stringify({ hole: total, tick: 0 }));
  }, [finished, catchUp, total, match._id]);

  if (finished && st && !catchUp) return <Finished match={match} st={st} meId={meId} />;
  if (!st) return null;
  const shown = catchUp?.hole ?? st.hole;
  const course = holes?.[shown];
  return (
    <>
      {course && st.hole >= 0 ? (
        <Hole
          key={course.id}
          match={match}
          st={st}
          meId={meId}
          course={course}
          n={shown}
          catchUp={catchUp && { from: catchUp.from, shooter, replaying, onStart: () => setReplaying(true), onShot: setShooter, onSeen: (tick) => localStorage.setItem(seenKey(match._id), JSON.stringify({ hole: catchUp.hole, tick })), onDone: () => caughtUp(catchUp.hole), onSkip: () => caughtUp(holeRef.current) }}
          onSeen={catchUp ? undefined : onSeen}
          onMenu={() => setMenu(true)}
        />
      ) : (
        <Building st={st} onMenu={() => setMenu(true)} />
      )}
      <HoleCard match={match} st={st} meId={meId} show={card} setShow={setCard} />
      <GolfMenu open={menu} onOpenChange={setMenu} match={match} st={st} meId={meId} playing={playing && match.status === "active"} />
    </>
  );
}

type CatchUp = { from: number; shooter: string | null; replaying: boolean; onStart: () => void; onSeen: (tick: number) => void; onShot: (by: string) => void; onDone: () => void; onSkip: () => void };

function Hole({ match, st, meId, course, n, catchUp, onSeen, onMenu }: { match: MatchView; st: GolfState; meId: Id<"users"> | undefined; course: Course; n: number; catchUp: CatchUp | null; onSeen?: (tick: number) => void; onMenu: () => void }) {
  const turns = match.mode === "golf:turns";
  // While catching up nobody's on turn here: it's a replay.
  const turn = catchUp ? null : ((match.turn as string | undefined) ?? null);
  const myTurn = turns && turn === meId;
  // A ding when the turn comes round to me.
  const was = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !was.current) sfx("turn");
    was.current = myTurn;
  }, [myTurn]);
  const colors = useMemo(() => new Map(match.players.map((p) => [p.userId as string, seatColor(p)])), [match.players]);
  const round: Round = {
    turns,
    turn,
    number: n + 1,
    total: st.total,
    minTick: st.turnTick + 1,
    colorOf: (id) => colors.get(id),
    bar: catchUp?.replaying ? <ReplayBar match={match} meId={meId} shooter={catchUp.shooter} n={n} total={st.total} par={course.par} /> : <TurnBar match={match} st={st} meId={meId} par={course.par} />,
    onMenu,
    onSunk: (strokes) => toast.success(`${scoreName(strokes, course.par)}`, { description: `${strokes} on a par ${course.par}. Watch the rest come in.` }),
    catchUp: catchUp ? { from: catchUp.from, onStart: catchUp.onStart, onShot: catchUp.onShot, onDone: catchUp.onDone, onSeen: catchUp.onSeen } : undefined,
    banner: catchUp?.replaying ? (
      <FloatPill className="py-1 pl-4 pr-1 font-display text-callout" role="status">
        Catching up
        <button type="button" onClick={catchUp.onSkip} className="min-h-11 rounded-full bg-primary px-4 text-primary-foreground active:scale-[0.97]">
          Skip
        </button>
      </FloatPill>
    ) : undefined,
    onSeen,
  };
  return <GolfWorld course={course} round={round} />;
}

// The top bar while catching up: whose shot is playing back, and which hole.
function ReplayBar({ match, meId, shooter, n, total, par }: { match: MatchView; meId: Id<"users"> | undefined; shooter: string | null; n: number; total: number; par: number }) {
  const p = match.players.find((x) => x.userId === shooter);
  return (
    <>
      {p ? <PlayerAvatar player={p} size={32} seat={seatColor(p)} className="m-1" /> : null}
      <span className="min-w-0 flex-1 pl-1">
        <span className="block truncate font-display text-callout leading-tight">{p ? `${p.userId === meId ? "Your" : `${p.name}'s`} shot` : "What you missed"}</span>
        <span className="block truncate text-caption text-muted-foreground">
          Hole {n + 1} of {total}, par {par}
        </span>
      </span>
    </>
  );
}

// Inside the top bar's pill: whose turn it is (or the hole clock), and the hole.
function TurnBar({ match, st, meId, par }: { match: MatchView; st: GolfState; meId: Id<"users"> | undefined; par: number }) {
  const up = match.players.find((p) => p.userId === match.turn);
  const { text, thinking } = useTurnText(up, meId, "Your shot");
  const live = match.mode === "golf:live";
  const mine = up?.userId === meId;
  const seat = match.players.findIndex((p) => p.userId === meId);
  const t = totals(st, match.players.length);
  const parSoFar = st.scores.reduce((a, _, n) => a + (st.holes[n]?.par ?? 0), 0);
  return (
    <>
      {up ? (
        <PlayerAvatar player={up} size={32} seat={seatColor(up)} className="m-1" />
      ) : null}
      <span className="min-w-0 flex-1 pl-1">
        <motion.span key={up?.userId ?? "live"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn("flex items-center gap-1.5 truncate font-display text-callout leading-tight", mine && "text-primary")} aria-live="polite">
          {live ? `Hole ${st.hole + 1} of ${st.total}` : (text ?? "Next up")}
          {thinking && <ThinkingDots />}
        </motion.span>
        <span className="block truncate text-caption text-muted-foreground">
          {live ? `Par ${par}` : `Hole ${st.hole + 1} of ${st.total}, par ${par}`}
          {seat >= 0 && st.scores.length > 0 ? `, you ${vsPar(t[seat], parSoFar)}` : ""}
        </span>
      </span>
      {live && st.clockAt && <Countdown deadline={st.clockAt} mine />}
    </>
  );
}

// While the holes are being made.
function Building({ st, onMenu }: { st: GolfState; onMenu: () => void }) {
  const goBack = useGoBack("/");
  const built = st.holes.filter(Boolean).length;
  return (
    <FullscreenStage className="grid place-items-center">
      <FloatingTopBar>
        <FloatButton aria-label="Back" onClick={goBack}>
          <CaretLeftIcon size={22} weight="bold" />
        </FloatButton>
        <span className="flex-1" />
        <FloatButton aria-label="Menu" onClick={onMenu}>
          <ListIcon size={22} weight="bold" />
        </FloatButton>
      </FloatingTopBar>
      <div className="flex flex-col items-center gap-3 text-center" aria-busy="true">
        <motion.span className="size-5 rounded-full bg-[#fbf9f3] shadow-md" animate={{ y: [0, -18, 0] }} transition={{ duration: 0.7, repeat: Infinity, ease: "easeOut" }} />
        <h2 className="font-display text-title">{st.waiting ? "Building the next hole" : "Building the course"}</h2>
        <FloatPill className="px-4 font-display text-callout">
          {built} of {st.total} holes ready
        </FloatPill>
      </div>
    </FullscreenStage>
  );
}

// A hole's just finished: everyone's score on it, best first, with the running totals, in a sheet over the
// next hole. Goes on a swipe or the X, or by itself after a while.
function HoleCard({ match, st, meId, show, setShow }: { match: MatchView; st: GolfState; meId: Id<"users"> | undefined; show: number | null; setShow: (n: number | null) => void }) {
  const seen = useRef(st.scores.length);
  useEffect(() => {
    if (st.scores.length > seen.current) {
      seen.current = st.scores.length;
      if (match.status === "active") {
        setShow(st.scores.length - 1);
        sfx("win");
      }
    }
  }, [st.scores.length, match.status]);
  useEffect(() => {
    if (show === null) return;
    const id = setTimeout(() => setShow(null), 9000);
    return () => clearTimeout(id);
  }, [show]);
  const n = show;
  const h = n !== null ? st.holes[n] : null;
  const t = totals(st, match.players.length);
  const par = st.scores.reduce((a, _, k) => a + (st.holes[k]?.par ?? 0), 0);
  const rows = n === null ? [] : match.players.map((p, i) => ({ p, i, x: st.scores[n]?.[i] ?? null })).filter((r) => r.x !== null).sort((a, b) => a.x! - b.x!);
  const next = n !== null ? st.holes[n + 1] : null;
  return (
    <Sheet open={n !== null && !!h} onClose={() => setShow(null)} title={h ? h.name : ""} closable>
      {n !== null && h && (
        <>
          <p className="text-callout text-muted-foreground">
            Hole {n + 1}, par {h.par}
          </p>
          <ol className="flex flex-col gap-2" aria-label={`Hole ${n + 1} scores`}>
            {rows.map(({ p, i, x }) => (
              <li key={p.userId} className="flex items-center gap-3">
                <PlayerAvatar player={p} size={32} seat={seatColor(p)} className="m-1" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-semibold", p.userId === meId && "text-primary")}>{p.userId === meId ? "You" : p.name}</span>
                  <span className="block text-footnote text-muted-foreground">{st.sunk[n]?.[i] === false ? "Picked up" : scoreName(x!, h.par)}</span>
                </span>
                <span className="font-display text-heading tabular-nums">{x}</span>
                <span className="w-10 text-right font-display text-callout tabular-nums text-muted-foreground">{vsPar(t[i], par)}</span>
              </li>
            ))}
          </ol>
          {next && n + 1 < st.total && (
            <p className="text-callout text-muted-foreground">
              Next: hole {n + 2}, {next.name}, par {next.par}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

// The round's over: the result (shared with every game), then the card, and the seed to play the holes again.
function Finished({ match, st, meId }: { match: MatchView; st: GolfState; meId: Id<"users"> | undefined }) {
  return (
    <div className="flex flex-col gap-6 pt-4">
      <Result match={match} meId={meId} />
      <section aria-label="The card" className="flex flex-col gap-2">
        <h2 className="px-1 font-display text-heading">The card</h2>
        <Scorecard match={match} st={st} meId={meId} />
        <SeedRow match={match} />
      </section>
    </div>
  );
}

export default GolfGame;
