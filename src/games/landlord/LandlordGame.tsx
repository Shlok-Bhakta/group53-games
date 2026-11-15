import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { motion } from "motion/react";
import { CaretLeftIcon, CornersInIcon, CornersOutIcon, ListIcon } from "@phosphor-icons/react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { actor, type MonoState } from "../../../convex/landlord/engine";
import { squareName } from "../../../convex/landlord/text";
import { useGoBack } from "@/components/AppHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { FloatButton, FloatPill, FloatingTopBar, FullscreenStage } from "@/components/game/floating";
import { AsyncButton } from "@/components/AsyncButton";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { sfx } from "@/sound";
import { cn } from "@/lib/utils";
import { Board } from "./Board";
import { CLOSE, UNMEASURED_VIEW, useCamera, type CameraView } from "./camera";
import { DeedSheet, useLandlordMove } from "./Deed";
import { Dock } from "./Dock";
import { centerOf } from "./geometry";
import { HoldingsSheet } from "./Holdings";
import { usePhoneLandscape } from "@/components/game/landscape";
import { LandlordMenu, PlayerSheet } from "./LandlordMenu";
import { Overlays } from "./Overlays";
import { useShow } from "./show";
import { TradeSheet, type TradeStart } from "./Trade";

type MeasuredView = CameraView & { landscape: boolean };

const DOCK_SURFACE = "bg-card/85 shadow-[0_-8px_24px_color-mix(in_srgb,var(--shade)_18%,transparent)] backdrop-blur-xl";
const BAR_GAP = 8;

function measureView(viewport: HTMLElement, bar: HTMLElement | null, dock: HTMLElement | null, landscape: boolean): MeasuredView | null {
  const s = viewport.getBoundingClientRect();
  const size = { w: viewport.clientWidth, h: viewport.clientHeight, landscape };
  if (landscape) {
    if (!bar) return null;
    const side = bar.getBoundingClientRect();
    return {
      ...size,
      top: Math.round(side.top - s.top),
      bottom: Math.round(s.bottom - side.bottom),
      left: 0,
      right: Math.round(s.right - side.left + BAR_GAP),
    };
  }
  if (!bar || !dock) return null;
  const t = bar.getBoundingClientRect();
  const d = dock.getBoundingClientRect();
  return { ...size, top: Math.round(t.bottom - s.top + BAR_GAP), bottom: Math.round(s.bottom - d.top + BAR_GAP), left: 0, right: 0 };
}

export default function LandlordGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const real = match.state as MonoState;
  const mySeat = match.players.findIndex((p) => p.userId === meId);
  const landscape = usePhoneLandscape();
  const viewport = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MeasuredView | null>(null);
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const measure = () => {
      const measured = measureView(vp, landscape ? side.current : top.current, dock.current, landscape);
      if (measured) setView(measured);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [vp, top.current, side.current, dock.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [landscape]);
  const cameraView = view ?? UNMEASURED_VIEW;
  const camera = useCamera(viewport, cameraView);
  const nameOf = useCallback((seat: number) => match.players[seat]?.name ?? "Someone", [match.players]);
  const look = useCallback(
    (pos: number, fresh: boolean) => {
      if (fresh) camera.release();
      const c = centerOf(pos);
      camera.focus(c.x, c.y, CLOSE);
    },
    [camera],
  );
  const shown = useShow({ id: match._id, real, mySeat, nameOf, onLook: look });
  const state = shown.state;
  const over = match.status === "finished" && !shown.busy;

  const placedFor = useRef<boolean | null>(null);
  const placeCamera = useEffectEvent((rotated: boolean) => {
    if (rotated && over) return camera.whole(true);
    const c = centerOf(state.players[state.current]?.pos ?? 0);
    camera.focus(c.x, c.y, CLOSE, { instant: true, force: true });
  });
  useEffect(() => {
    if (!view || placedFor.current === view.landscape) return;
    const rotated = placedFor.current !== null;
    placedFor.current = view.landscape;
    placeCamera(rotated);
  }, [view]);
  const showWholeBoard = useEffectEvent(() => camera.whole());
  useEffect(() => {
    if (over) showWholeBoard();
  }, [over]);
  const wasOver = useRef(match.status === "finished");
  useEffect(() => {
    if (!over || wasOver.current) return;
    wasOver.current = true;
    if (mySeat >= 0) sfx(match.result?.winners.includes(match.players[mySeat].userId) ? "win" : "lose");
  }, [over, match.result, match.players, mySeat]);

  const [menu, setMenu] = useState(false);
  const [deed, setDeed] = useState<number | null>(null);
  const [holdings, setHoldings] = useState(false);
  const [trade, setTrade] = useState<TradeStart | null>(null);
  const [player, setPlayer] = useState<number | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const act = useLandlordMove(match._id);
  const ph = state.phase;
  const picking = !shown.busy && ph.k === "pick" && state.current === mySeat;

  const goBack = useGoBack("/");
  const up = ph.k === "over" ? -1 : actor(state);
  const upPlayer = up >= 0 ? match.players[up] : undefined;
  const status = over
    ? "Game over"
    : shown.busy
      ? (shown.line ?? (state.current === mySeat ? "Your turn" : `${nameOf(state.current)}'s turn`))
      : up === mySeat
        ? ph.k === "auction"
          ? `Auction: ${squareName(ph.pos)}`
          : ph.k === "debt"
            ? "You owe money"
            : ph.k === "buy"
              ? `Buy ${squareName(ph.pos)}?`
              : "Your turn"
        : `${nameOf(up)}${ph.k === "auction" ? " to bid" : ph.k === "debt" ? " is raising money" : ph.k === "buy" ? " is deciding" : "'s turn"}`;

  const bar = (
    <>
      <FloatButton aria-label="Back" onClick={goBack}>
        <CaretLeftIcon size={22} weight="bold" />
      </FloatButton>
      <FloatPill
        onClick={() => setMenu(true)}
        aria-label="Players"
        className="flex-1 border-2 py-1 pl-1 pr-3 transition-colors duration-300"
        style={{ borderColor: upPlayer ? seatColor(upPlayer) : "transparent" }}
      >
        {upPlayer && <PlayerAvatar player={upPlayer} size={34} className="shrink-0" />}
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn("min-w-0 flex-1 truncate font-display text-callout leading-tight", up === mySeat && !shown.busy && "text-primary")}
          aria-live="polite"
        >
          {status}
        </motion.span>
        {shown.catching && (
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">
            Catching up
          </span>
        )}
      </FloatPill>
      <FloatButton
        aria-label={camera.overview ? "Zoom in" : "Whole board"}
        onClick={() => {
          if (camera.overview) return look(state.players[up >= 0 ? up : 0]?.pos ?? 0, true);
          camera.hold();
          camera.whole();
        }}
      >
        {camera.overview ? <CornersInIcon size={22} weight="bold" /> : <CornersOutIcon size={22} weight="bold" />}
      </FloatButton>
      <FloatButton aria-label="Menu" onClick={() => setMenu(true)}>
        <ListIcon size={22} weight="bold" />
      </FloatButton>
    </>
  );
  const dockBody = (
    <Dock
      match={match}
      meId={meId}
      state={state}
      mySeat={mySeat}
      busy={shown.busy}
      catching={shown.catching}
      floats={shown.floats}
      onSkip={shown.skip}
      onPlayer={(seat) => {
        setPlayer(seat);
        const p = state.players[seat];
        if (p && !p.out) look(p.pos, true);
      }}
      onHoldings={() => setHoldings(true)}
      onTrade={() => setTrade({})}
      over={over}
    />
  );

  return (
    <FullscreenStage className="[background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_8%,transparent)_1px,transparent_1px)] [background-size:16px_16px]">
      <div
        ref={viewport}
        className="absolute inset-0 touch-none overflow-hidden phone-landscape:left-(--safe-left) phone-landscape:right-(--safe-right)"
        {...camera.bind}
      >
        <Board
          camera={camera}
          state={state}
          match={match}
          highlight={shown.highlight}
          picking={picking}
          onSquare={(pos) => (picking ? setPick(pos) : setDeed(pos))}
        />
        <Overlays shown={shown} view={cameraView} />
      </div>

      {landscape ? (
        <div
          ref={side}
          className="pointer-events-none absolute right-[max(12px,var(--safe-right))] top-[max(12px,var(--safe-top))] bottom-[max(12px,var(--safe-bottom))] z-20 flex w-[min(22rem,48vw)] flex-col gap-2"
        >
          <div className="flex items-center gap-2">{bar}</div>
          <div
            ref={dock}
            data-dock
            data-busy={shown.busy ? "" : undefined}
            className={cn("pointer-events-auto flex min-h-0 flex-1 flex-col overflow-y-auto rounded-3xl px-3 pb-3 pt-1", DOCK_SURFACE)}
          >
            {dockBody}
          </div>
        </div>
      ) : (
        <>
          <FloatingTopBar ref={top}>{bar}</FloatingTopBar>
          <div
            ref={dock}
            data-dock
            data-busy={shown.busy ? "" : undefined}
            className={cn("absolute inset-x-0 bottom-0 z-10 rounded-t-3xl px-3 pb-[calc(var(--safe-bottom)+10px)] pt-1", DOCK_SURFACE)}
          >
            {dockBody}
          </div>
        </>
      )}

      <LandlordMenu open={menu} onOpenChange={setMenu} match={match} state={state} mySeat={mySeat} feed={shown.feed} />
      <DeedSheet
        pos={deed}
        onClose={() => setDeed(null)}
        match={match}
        state={state}
        mySeat={mySeat}
        busy={shown.busy}
        onTrade={(seat, pos) => {
          setDeed(null);
          setTrade({ with: seat, want: pos });
        }}
      />
      {mySeat >= 0 && (
        <>
          <HoldingsSheet
            open={holdings}
            onClose={() => setHoldings(false)}
            match={match}
            state={state}
            seat={mySeat}
            busy={shown.busy}
            onDeed={(pos) => setDeed(pos)}
          />
          <TradeSheet open={trade !== null} start={trade ?? {}} onClose={() => setTrade(null)} match={match} state={state} seat={mySeat} />
        </>
      )}
      <PlayerSheet
        seat={player}
        onClose={() => setPlayer(null)}
        match={match}
        state={state}
        mySeat={mySeat}
        onDeed={(pos) => setDeed(pos)}
        onTrade={(seat) => {
          setPlayer(null);
          setTrade({ with: seat });
        }}
      />
      <Sheet open={pick !== null} onClose={() => setPick(null)} title={pick !== null ? `Go to ${squareName(pick)}?` : ""} closable>
        <AsyncButton
          size="xl"
          className="w-full"
          onClick={async () => {
            if (pick === null) return;
            await act({ k: "pick", pos: pick });
            setPick(null);
          }}
        >
          Go there
        </AsyncButton>
      </Sheet>
    </FullscreenStage>
  );
}
