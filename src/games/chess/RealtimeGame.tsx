import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { RealtimeState } from "../../../convex/chess";
import type { MatchView } from "../../../convex/matches";
import { CELL, TICK_MS, initialState, paceFromSettings, paceOf, legalTargets, positionAt, premoveTargets, type Command, type Piece, type State, type Variant } from "../../../convex/chess/realtime";
import { MODES, settingsOf, type ModeKey } from "../../../convex/modes";
import { useServerClock } from "@/lib/serverClock";
import { viewFor, type Sq } from "./geometry";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";
import { useHoldUpdates } from "@/version";
import { structureOf, useEngine } from "./rt/useEngine";
import { RtBoard } from "./rt/RtBoard";
import { Overlay } from "./rt/Overlay";

// Remote moves arrive a little after they started; ease them into place over this many ticks.
const CATCH_UP_TICKS = 10;

export function RealtimeGame({ match, meId, above, below, overlay }: { match: MatchView; meId: Id<"users"> | undefined; above?: ReactNode; below?: ReactNode; overlay?: ReactNode }) {
  const state = match.state as RealtimeState;
  const rt = useQuery(api.chess.rtState, { id: match._id });
  const clock = useServerClock();
  const me = match.players.find((p) => p.userId === meId);
  const variant: Variant = MODES[match.mode as ModeKey]?.board === "four" ? "four" : "two";
  const myColor = me?.color ?? (variant === "four" ? "red" : "w");
  const view = useMemo(() => viewFor(variant, myColor), [variant, myColor]);
  const ready = useMutation(api.chess.ready);
  const commands = useMemo(() => rt?.commands ?? [], [rt?.commands]);
  const pace = useMemo(() => paceFromSettings(settingsOf(match.mode, match.settings)), [match.mode, match.settings]);
  const run = useEngine((rt?.snapshot as State | null) ?? null, commands, variant, pace);

  const rtMove = useMutation(api.chess.rtMove).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.chess.rtState, { id: args.id });
    if (!current) return;
    const cmd: Command = { tick: args.clientTick, color: myColor, pieceId: args.pieceId, toX: args.toX, toY: args.toY, kind: args.kind ?? "move" };
    store.setQuery(api.chess.rtState, { id: args.id }, { ...current, commands: [...current.commands, cmd] });
  });

  // Tell the server this player's board is up, and keep trying until it hears it.
  const needsReady = match.status === "active" && !!me && state.startAt === null && !state.ready.includes(me.userId);
  useEffect(() => {
    if (!needsReady) return;
    let cancelled = false;
    let delay = 500;
    const attempt = () => {
      ready({ id: match._id }).catch(() => {
        if (cancelled) return;
        setTimeout(attempt, delay);
        delay = Math.min(delay * 2, 5000);
      });
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [needsReady, match._id, ready]);

  const startAt = state.startAt;
  // A reload mid-game would cost the player seconds of play; updates wait until it's over.
  useHoldUpdates(match.status === "active" && !!me);
  const live = clock.ready && startAt !== null && rt !== undefined;
  const displayTick = useCallback(() => (startAt === null ? -1 : (clock.now() - startAt) / TICK_MS), [clock, startAt]);

  // React state: the board's structure, refreshed only when it changes.
  const [sim, setSim] = useState<State>(() => initialState(variant, pace));
  const [countdown, setCountdown] = useState<number | null>(null);
  const structure = useRef("");
  const pieceEls = useRef(new Map<number, HTMLDivElement>());
  const cooldownEls = useRef(new Map<number, HTMLDivElement>());
  const firstSeen = useRef(new Map<string, number>());

  // The frame loop: advance the simulation, move pieces directly in the DOM, and only touch React when
  // the structure changes.
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const frame = () => {
      const raw = displayTick();
      setCountdown(raw < 0 ? Math.ceil((-raw * TICK_MS) / 1000) : null);
      const s = run(Math.max(0, Math.floor(raw) + 1));
      const tick = s.result ? s.endTick! : Math.max(0, raw);
      const key = structureOf(s);
      if (key !== structure.current) {
        structure.current = key;
        setSim(s);
      }
      for (const p of s.pieces) {
        const el = pieceEls.current.get(p.id);
        if (!el) continue;
        let t = tick;
        if (p.status === "moving") {
          const k = `${p.id}:${p.startTick}`;
          if (!firstSeen.current.has(k)) firstSeen.current.set(k, tick);
          const seen = firstSeen.current.get(k)!;
          const lag = seen - p.startTick!;
          if (lag > 1) t = tick - lag * Math.max(0, 1 - (tick - seen) / CATCH_UP_TICKS);
        }
        const pos = positionAt(p, t);
        const [c, r] = view.toScreen(pos.x / CELL, pos.y / CELL);
        el.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
        const cd = cooldownEls.current.get(p.id);
        if (cd) cd.style.height = p.status === "cooldown" ? `${Math.max(0, Math.min(1, (p.readyAt! - tick) / paceOf(s).cooldown)) * 100}%` : "0%";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live, run, displayTick, view]);

  const out = sim.out.some((o) => o.color === myColor);
  const playing = match.status === "active" && live && countdown === null && !sim.result && !!me && !out;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = sim.pieces.find((p) => p.id === selectedId && p.color === myColor && !p.dead) ?? null;
  const targets: Sq[] = !playing || !selected ? [] : selected.status === "ready" ? legalTargets(sim.pieces, selected, variant) : premoveTargets(selected, variant);

  const showHint = useFirstGamesHint(match._id);

  const send = (piece: Piece, to: Sq | null) => {
    const clientTick = Math.max(Math.floor(displayTick()), (rt?.snapshot as State | null)?.tick ?? 0);
    rtMove({ id: match._id, pieceId: piece.id, toX: to?.[0] ?? 0, toY: to?.[1] ?? 0, kind: to ? "move" : "cancel", clientTick }).catch((err) => toast.error(errorText(err)));
  };

  return (
    <>
      {above}
      <div className={cn("relative", variant === "four" && "-mx-2.5")}>
        <RtBoard
          sim={sim}
          myColor={myColor}
          view={view}
          playing={playing}
          selected={selected}
          targets={targets}
          pieceEls={pieceEls}
          cooldownEls={cooldownEls}
          displayTick={displayTick}
          onSelect={(p) => setSelectedId(p?.id ?? null)}
          onMove={(p, to) => {
            send(p, to);
            setSelectedId(null);
          }}
          onCancel={(p) => {
            send(p, null);
            setSelectedId(null);
          }}
        >
          {overlay}
        </RtBoard>
        <Overlay match={match} state={state} meId={meId} countdown={countdown} />
      </div>
      {below}
      {out && match.status === "active" ? (
        <p className="px-1 text-center text-callout font-semibold text-destructive">Your king fell. Your army is stone now; watch who survives.</p>
      ) : (
        showHint && match.status === "active" && (
          <p className="px-1 text-center text-footnote text-muted-foreground">
            Move any piece any time; it rests {Math.round(pace.cooldown / 30)} seconds after landing. Drag a resting piece to premove it, tap it to cancel.
          </p>
        )
      )}
    </>
  );
}

// The how-it-works line under a real-time board, for your first few games only.
const HINT_KEY = "rtHintGames";
function useFirstGamesHint(matchId: string) {
  const [show] = useState(() => {
    const seen: string[] = JSON.parse(localStorage.getItem(HINT_KEY) ?? "[]");
    if (seen.includes(matchId)) return true;
    if (seen.length >= 3) return false;
    localStorage.setItem(HINT_KEY, JSON.stringify([...seen, matchId]));
    return true;
  });
  return show;
}
