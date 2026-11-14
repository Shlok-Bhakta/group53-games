import { useCallback, useEffect, useRef, useState } from "react";
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
import { CLOSE, useCamera } from "./camera";
import { DeedSheet, useLandlordMove } from "./Deed";
import { Dock } from "./Dock";
import { centerOf } from "./geometry";
import { HoldingsSheet } from "./Holdings";
import { LandlordMenu, PlayerSheet } from "./LandlordMenu";
import { Overlays } from "./Overlays";
import { useShow } from "./show";
import { TradeSheet, type TradeStart } from "./Trade";

// A game of Landlord: the board fills the screen and the camera follows whatever's happening on it, with the
// turn floating over the top and the dock (everyone's cash, then your move) over the bottom. What's on screen
// is the show (show.ts): everything since you last looked plays out, then it's live.
export default function LandlordGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const real = match.state as MonoState;
  const mySeat = match.players.findIndex((p) => p.userId === meId);
  const stage = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [pads, setPads] = useState({ top: 110, bottom: 220 });
  useEffect(() => {
    const measure = () => {
      const s = stage.current?.getBoundingClientRect();
      const t = top.current?.getBoundingClientRect();
      const d = dock.current?.getBoundingClientRect();
      if (!s || !t || !d) return;
      setPads({ top: Math.round(t.bottom - s.top + 8), bottom: Math.round(s.bottom - d.top + 8) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (dock.current) ro.observe(dock.current);
    if (top.current) ro.observe(top.current);
    return () => ro.disconnect();
  }, []);
  const camera = useCamera(stage, pads);
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

  // The first frame: straight to whoever's up, no glide in from nowhere.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || pads.bottom === 220) return;
    placed.current = true;
    const c = centerOf(state.players[state.current]?.pos ?? 0);
    camera.focus(c.x, c.y, CLOSE, { instant: true, force: true });
  }, [pads, camera, state]);
  // Finished: the whole board, everyone's empire on it.
  useEffect(() => {
    if (over) camera.whole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        ? ph.k === "auction" ? `Auction: ${squareName(ph.pos)}` : ph.k === "debt" ? "You owe money" : ph.k === "buy" ? `Buy ${squareName(ph.pos)}?` : "Your turn"
        : `${nameOf(up)}${ph.k === "auction" ? " to bid" : ph.k === "debt" ? " is raising money" : ph.k === "buy" ? " is deciding" : "'s turn"}`;

  return (
    <FullscreenStage className="[background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_8%,transparent)_1px,transparent_1px)] [background-size:16px_16px]">
      <div ref={stage} className="absolute inset-0 touch-none overflow-hidden" {...camera.bind}>
        <Board camera={camera} state={state} match={match} highlight={shown.highlight} picking={picking} onSquare={(pos) => (picking ? setPick(pos) : setDeed(pos))} />
      </div>
      <Overlays shown={shown} top={pads.top} bottom={pads.bottom} />

      <FloatingTopBar ref={top}>
        <FloatButton aria-label="Back" onClick={goBack}>
          <CaretLeftIcon size={22} weight="bold" />
        </FloatButton>
        <FloatPill onClick={() => setMenu(true)} aria-label="Players" className="flex-1 border-2 py-1 pl-1 pr-3 transition-colors duration-300" style={{ borderColor: upPlayer ? seatColor(upPlayer) : "transparent" }}>
          {upPlayer && <PlayerAvatar player={upPlayer} size={34} className="shrink-0" />}
          <motion.span key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn("min-w-0 flex-1 truncate font-display text-callout leading-tight", up === mySeat && !shown.busy && "text-primary")} aria-live="polite">
            {status}
          </motion.span>
          {shown.catching && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">Catching up</span>}
        </FloatPill>
        <FloatButton
          aria-label={camera.overview ? "Zoom in" : "Whole board"}
          onClick={() => {
            if (camera.overview) return look(state.players[up >= 0 ? up : 0]?.pos ?? 0, true);
            // The whole board stays up until the game next has something to show.
            camera.manual.current = true;
            camera.whole();
          }}
        >
          {camera.overview ? <CornersInIcon size={22} weight="bold" /> : <CornersOutIcon size={22} weight="bold" />}
        </FloatButton>
        <FloatButton aria-label="Menu" onClick={() => setMenu(true)}>
          <ListIcon size={22} weight="bold" />
        </FloatButton>
      </FloatingTopBar>

      <div ref={dock} className="absolute inset-x-0 bottom-0 z-10 rounded-t-3xl bg-card/85 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-1 shadow-[0_-8px_24px_rgb(0_0_0/0.18)] backdrop-blur-xl" data-busy={shown.busy ? "" : undefined}>
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
      </div>

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
          <HoldingsSheet open={holdings} onClose={() => setHoldings(false)} match={match} state={state} seat={mySeat} busy={shown.busy} onDeed={(pos) => setDeed(pos)} />
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
