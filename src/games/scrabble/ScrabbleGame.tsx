import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { settingsOf } from "../../../convex/modes";
import { centre, rulesOf, type ScrabbleState } from "../../../convex/scrabble/engine";
import { Result } from "@/components/match";
import { FullscreenStage } from "@/components/game/floating";
import { seatColor } from "@/games/seats";
import { Tiles } from "@/Tiles";
import { cn } from "@/lib/utils";
import { sfx } from "@/sound";
import { ScrabbleBoard, type BoardView, type DraftTile } from "./Board";
import { BagSheet } from "./BagSheet";
import { BlankPicker } from "./BlankPicker";
import { BagButton, DockActions } from "./DockActions";
import { DragGhost } from "./DragGhost";
import { Rack } from "./Rack";
import { ScrabbleMenu } from "./ScrabbleMenu";
import { TopBar } from "./TopBar";
import { usePreview } from "./usePreview";
import { key, useScrabbleDraft } from "./useScrabbleDraft";
import { useTileDrag } from "./useTileDrag";

export function ScrabbleGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const state = match.state as ScrabbleState;
  const settings = settingsOf(match.mode, match.settings);
  const rules = rulesOf(settings);
  const mySeat = match.players.findIndex((p) => p.userId === meId);
  const playing = match.status === "active" && mySeat >= 0 && !state.out.includes(mySeat);
  const myTurn = playing && state.turn === mySeat;
  const colorOf = useCallback((seat: number) => seatColor(match.players[seat]), [match.players]);

  const rack = useQuery(api.scrabble.rack, mySeat >= 0 ? { id: match._id } : "skip");
  const play = useMutation(api.scrabble.play);

  const { draft, setDraft, occupied, rackById, placed, inRack, setPlaced, setOrder } = useScrabbleDraft({
    match,
    state,
    mySeat,
    playing,
    rack,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const [blankFor, setBlankFor] = useState<{ id: number; x: number; y: number } | null>(null);
  const [swapping, setSwapping] = useState<number[] | null>(null);

  const putDown = (id: number, x: number, y: number, letter?: string) => {
    if (occupied.has(key(x, y))) return;
    const tile = rackById.get(id);
    if (!tile) return;
    const prior = placed.find((p) => p.id === id);
    if (tile.letter === "?" && !letter && !prior?.letter) return setBlankFor({ id, x, y });
    const rest = placed.filter((p) => p.id !== id && !(p.x === x && p.y === y));
    setPlaced([...rest, { id, x, y, ...(tile.letter === "?" ? { letter: letter ?? prior?.letter } : {}) }]);
    setSelected(null);
    sfx("place");
  };
  const recall = (id: number) => {
    setPlaced(placed.filter((p) => p.id !== id));
    sfx("recall");
  };

  const onCellTap = (x: number, y: number) => {
    if (selected !== null && !occupied.has(key(x, y))) putDown(selected, x, y);
  };

  const { board, rackEl, ghost, drag, target, slot, startDrag } = useTileDrag({
    playing,
    swapping,
    setSwapping,
    setSelected,
    occupied,
    placed,
    inRack,
    rackSize: rules.rack,
    putDown,
    recall,
    setOrder,
  });
  const [hop, setHop] = useState(0);

  const { evaluation, bad, checking, tone, bubble, shake, setShake } = usePreview({
    id: match._id,
    placed,
    rack,
    tiles: state.tiles,
    rules,
  });

  const last = state.moves.at(-1);
  const fresh = useMemo(
    () => new Set(state.tiles.filter((t) => t.turn === state.moves.length - 1 && last?.kind === "play").map((t) => key(t.x, t.y))),
    [state.tiles, state.moves.length, last?.kind],
  );
  const lastCell = useMemo(
    () => [...fresh].map((k) => k.split(",").map(Number) as [number, number]).sort((a, b) => b[0] + b[1] - a[0] - a[1])[0],
    [fresh],
  );
  const scored =
    last?.kind === "play" && lastCell
      ? { key: state.moves.length, x: lastCell[0], y: lastCell[1], text: `+${last.score}`, color: colorOf(last.seat) }
      : null;

  const planning = useQuery(api.scrabble.planning, match.status === "active" ? { id: match._id } : "skip");
  const upUser = match.status === "active" ? match.players[state.turn]?.userId : undefined;
  const upPlan = upUser && upUser !== meId ? planning?.find((p) => p.userId === upUser) : undefined;
  const ghosts = upPlan ? { cells: upPlan.cells, color: colorOf(state.turn) } : null;
  const ghostCount = ghosts?.cells.length ?? 0;
  const ghostSig = ghosts?.cells.map((c) => c.join(",")).join("|") ?? "";
  const heardGhosts = useRef(ghostSig);
  useEffect(() => {
    if (ghostSig !== heardGhosts.current && ghostCount > 0) sfx("ghost");
    heardGhosts.current = ghostSig;
  }, [ghostSig, ghostCount]);

  const seenMoves = useRef(state.moves.length);
  useEffect(() => {
    if (state.moves.length <= seenMoves.current) return;
    seenMoves.current = state.moves.length;
    const m = state.moves.at(-1)!;
    if (m.seat !== mySeat && m.kind === "play") sfx(m.bingo ? "bingo" : "land", { count: m.count });
    if (myTurn) setTimeout(() => sfx("turn"), m.kind === "play" ? 650 : 100);
  }, [state.moves, mySeat, myTurn]);
  const wasActive = useRef(match.status === "active");
  useEffect(() => {
    if (wasActive.current && match.status === "finished" && mySeat >= 0) sfx(match.result?.winners.includes(meId!) ? "win" : "lose");
    wasActive.current = match.status === "active";
  }, [match.status, match.result, mySeat, meId]);

  const bingoKey = last?.bingo ? state.moves.length : null;

  const focus = useMemo<[number, number]>(() => {
    if (!state.tiles.length && !draft.placed.length) return [centre(state.size), centre(state.size)];
    const pts = [...state.tiles, ...draft.placed];
    return [Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length), Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length)];
  }, [state.tiles, state.size, draft.placed]);

  const finished = match.status === "finished";

  const area = useRef<HTMLDivElement>(null);
  const topBar = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Required<BoardView>>({ width: 0, height: 0, padTop: 0, padRight: 0, padBottom: 0, padLeft: 0 });
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setView(boardView(el, topBar.current, dock.current));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (dock.current) ro.observe(dock.current);
    if (topBar.current) ro.observe(topBar.current);
    return () => ro.disconnect();
  }, [finished]);
  const px = Math.floor(Math.min(view.width, view.height));

  const [menu, setMenu] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const draggedTile = drag ? rackById.get(drag.id) : undefined;
  const draftTiles: DraftTile[] = placed.map((p) => {
    const tile = rackById.get(p.id)!;
    return {
      id: p.id,
      x: p.x,
      y: p.y,
      letter: tile.letter === "?" ? (p.letter ?? "?").toUpperCase() : tile.letter,
      blank: tile.letter === "?",
    };
  });

  const boardEl = px > 0 && (
    <ScrabbleBoard
      ref={board}
      size={state.size}
      px={px}
      view={finished ? undefined : view}
      tiles={state.tiles}
      draft={draftTiles}
      seatColor={colorOf}
      fresh={fresh}
      freshSeat={last?.kind === "play" ? last.seat : null}
      target={target}
      tone={tone}
      bubble={bubble}
      hidden={drag?.from === "board" ? drag.id : null}
      focus={focus}
      zoomOnDoubleTap={selected === null}
      reveal={{ key: state.moves.length, cells: [...fresh].map((k) => k.split(",").map(Number) as [number, number]) }}
      ghosts={ghosts}
      scored={scored}
      shake={shake}
      onCellTap={onCellTap}
      onDraftDown={(id, e) => startDrag(id, "board", e)}
    />
  );

  if (finished) {
    return (
      <div className="flex flex-1 flex-col gap-2 pb-1">
        <div
          ref={area}
          className="relative aspect-square w-full phone-landscape:mx-auto phone-landscape:max-w-[calc(100svh-var(--safe-bottom)-16px)]"
        >
          {boardEl && <div className="absolute inset-0 flex items-start justify-center">{boardEl}</div>}
        </div>
        <div className="pt-4">
          <Result match={match} meId={meId} />
        </div>
      </div>
    );
  }

  return (
    <FullscreenStage className="[--rail-width:12rem] [background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_8%,transparent)_1px,transparent_1px)] [background-size:16px_16px]">
      <div ref={area} className="absolute inset-0">
        {boardEl && <div className="absolute inset-0">{boardEl}</div>}
        <TopBar ref={topBar} match={match} state={state} meId={meId} myTurn={myTurn} onMenu={() => setMenu(true)} />
        <AnimatePresence>{bingoKey !== null && <Bingo key={bingoKey} />}</AnimatePresence>
      </div>

      <div
        ref={dock}
        data-dock
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2.5 rounded-t-3xl bg-card/80 px-3 pb-[calc(var(--safe-bottom)+10px)] pt-3 shadow-[0_-8px_24px_color-mix(in_oklch,var(--shade)_18%,transparent)] backdrop-blur-xl",
          "phone-landscape:right-[max(12px,var(--safe-right))] phone-landscape:left-[calc(max(12px,var(--safe-left))+var(--rail-width)+8px)] phone-landscape:pb-[max(10px,var(--safe-bottom))]",
        )}
      >
        {playing ? (
          <>
            <Rack
              ref={rackEl}
              tiles={inRack}
              size={rules.rack}
              selected={selected}
              swapping={swapping}
              dragging={drag?.from === "rack" ? drag.id : null}
              slot={slot}
              hop={hop}
              onDown={(id, e) => startDrag(id, "rack", e)}
            />
            <DockActions
              match={match}
              myTurn={myTurn}
              placed={placed}
              evaluation={evaluation}
              bad={bad}
              checking={checking}
              swapping={swapping}
              setSwapping={setSwapping}
              bagCount={state.bag}
              onBag={() => setBagOpen(true)}
              onShuffle={() => {
                setOrder(shuffled(inRack.map((t) => t.id)));
                setHop((h) => h + 1);
                sfx("shuffle");
              }}
              onRecall={() => {
                setPlaced([]);
                sfx("recall");
              }}
              onPlay={async () => {
                const count = placed.length;
                let score: number;
                try {
                  score = await play({ id: match._id, tiles: placed });
                } catch (e) {
                  setShake((n) => n + 1);
                  sfx("invalid");
                  throw e;
                }
                setDraft((d) => ({ ...d, placed: [] }));
                sfx(evaluation?.ok && evaluation.bingo ? "bingo" : "play", { count, score });
              }}
            />
          </>
        ) : (
          <div className="flex items-center gap-3">
            <BagButton count={state.bag} onClick={() => setBagOpen(true)} />
            <p className="text-callout text-muted-foreground">
              {mySeat >= 0 ? "You're out. Stick around to see who wins." : "You're watching."}
            </p>
          </div>
        )}
      </div>

      <ScrabbleMenu open={menu} onOpenChange={setMenu} match={match} state={state} meId={meId} planning={planning} playing={playing} />
      <BagSheet open={bagOpen} onClose={() => setBagOpen(false)} match={match} state={state} rack={rack ?? undefined} />

      {drag && draggedTile && (
        <DragGhost
          ref={ghost}
          letter={draftTiles.find((d) => d.id === drag.id)?.letter ?? draggedTile.letter}
          blank={draggedTile.letter === "?"}
        />
      )}

      <BlankPicker
        open={blankFor !== null}
        onClose={() => setBlankFor(null)}
        onPick={(letter) => {
          if (blankFor) putDown(blankFor.id, blankFor.x, blankFor.y, letter);
          setBlankFor(null);
        }}
      />
    </FullscreenStage>
  );
}

function Bingo() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 1.05] }}
      transition={{ duration: 2.2, times: [0, 0.15, 0.8, 1] }}
    >
      <Tiles word="BINGO" states={["green", "yellow", "green", "yellow", "green"]} size="lg" flip label="Bingo" />
    </motion.div>
  );
}

function shuffled<T>(xs: T[]) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const OPEN_GAP = 6;

function boardView(area: HTMLElement, bar: HTMLElement | null, dock: HTMLElement | null): Required<BoardView> {
  const barIsSideRail = !!bar && bar.offsetHeight > bar.offsetWidth;
  return {
    width: area.clientWidth,
    height: area.clientHeight || area.clientWidth,
    padTop: bar && !barIsSideRail ? bar.offsetTop + bar.offsetHeight + OPEN_GAP : 0,
    padLeft: bar && barIsSideRail ? bar.offsetLeft + bar.offsetWidth + OPEN_GAP : 0,
    padBottom: dock ? dock.offsetHeight + OPEN_GAP : 0,
    padRight: dock ? area.clientWidth - dock.offsetLeft - dock.offsetWidth : 0,
  };
}
