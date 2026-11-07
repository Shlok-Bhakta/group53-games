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
import { sfx } from "@/sound";
import { ScrabbleBoard, type DraftTile } from "./Board";
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

// A Scrabble game: scores on top, the board in the middle, your rack and actions at the bottom. Lay tiles
// out any time; it's a plan until it's your turn and you play it.
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

  const { draft, setDraft, hydrated, occupied, rackById, placed, inRack, setPlaced, setOrder } = useScrabbleDraft({ match, state, mySeat, playing, rack });

  // --- Picking and placing ---
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

  const { board, rackEl, ghost, drag, target, slot, startDrag } = useTileDrag({ playing, swapping, setSwapping, setSelected, occupied, placed, inRack, rackSize: rules.rack, putDown, recall, setOrder });
  const [hop, setHop] = useState(0);

  const { evaluation, bad, checking, tone, bubble, shake, setShake } = usePreview({ placed, rack, tiles: state.tiles, rules });

  // --- The latest move, which every phone animates in ---
  const last = state.moves.at(-1);
  const fresh = useMemo(() => new Set(state.tiles.filter((t) => t.turn === state.moves.length - 1 && last?.kind === "play").map((t) => key(t.x, t.y))), [state.tiles, state.moves.length, last?.kind]);
  const lastCell = useMemo(() => [...fresh].map((k) => k.split(",").map(Number) as [number, number]).sort((a, b) => b[0] + b[1] - a[0] - a[1])[0], [fresh]);
  const scored = last?.kind === "play" && lastCell ? { key: state.moves.length, x: lastCell[0], y: lastCell[1], text: `+${last.score}`, color: colorOf(last.seat) } : null;

  // Whoever's turn it is, trying tiles out: face down on everyone else's board.
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

  // Sounds for things that happen on other phones: a word landing, your turn coming round, the end.
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

  // The celebration when anyone plays all their tiles.
  const bingoKey = last?.bingo ? state.moves.length : null;

  const focus = useMemo<[number, number]>(() => {
    if (!state.tiles.length && !draft.placed.length) return [centre(state.size), centre(state.size)];
    const pts = [...state.tiles, ...draft.placed];
    return [Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length), Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length)];
    // Only where to look when the board first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated.current]);

  const finished = match.status === "finished";

  // --- Board size. In a game in progress the board fills the screen between the floating top bar and the
  // dock, and you pan around it; once it's over it's a square above the result. ---
  const area = useRef<HTMLDivElement>(null);
  const topBar = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      const bar = topBar.current;
      const d = dock.current;
      setBox({ w: el.clientWidth, h: el.clientHeight || el.clientWidth, top: bar ? bar.offsetTop + bar.offsetHeight + 6 : 0, bottom: d ? d.offsetHeight + 6 : 0 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (dock.current) ro.observe(dock.current);
    return () => ro.disconnect();
  }, [finished]);
  const px = Math.floor(Math.min(box.w, box.h));

  const [menu, setMenu] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const draggedTile = drag ? rackById.get(drag.id) : undefined;
  const draftTiles: DraftTile[] = placed.map((p) => {
    const tile = rackById.get(p.id)!;
    return { id: p.id, x: p.x, y: p.y, letter: tile.letter === "?" ? (p.letter ?? "?").toUpperCase() : tile.letter, blank: tile.letter === "?" };
  });

  const boardEl = px > 0 && (
    <ScrabbleBoard
      ref={board}
      size={state.size}
      px={px}
      view={finished ? undefined : { width: box.w, height: box.h, padTop: box.top, padBottom: box.bottom }}
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
        <div ref={area} className="relative aspect-square w-full">
          {boardEl && <div className="absolute inset-0 flex items-start justify-center">{boardEl}</div>}
        </div>
        <div className="pt-4">
          <Result match={match} meId={meId} />
        </div>
      </div>
    );
  }

  // A game in progress takes the whole screen, Letter League style: the board is the background, with
  // buttons floating over its top and your rack in a see-through dock over its bottom. The stage runs up under
  // the status bar while it's up (see useFullbleed).
  return (
    <FullscreenStage className="[background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_8%,transparent)_1px,transparent_1px)] [background-size:16px_16px]">
      <div ref={area} className="absolute inset-0">
        {boardEl && <div className="absolute inset-0">{boardEl}</div>}
        <TopBar ref={topBar} match={match} state={state} meId={meId} myTurn={myTurn} onMenu={() => setMenu(true)} />
        <AnimatePresence>
          {bingoKey !== null && <Bingo key={bingoKey} />}
        </AnimatePresence>
      </div>

      <div ref={dock} className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2.5 rounded-t-3xl bg-card/80 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 shadow-[0_-8px_24px_rgb(0_0_0/0.18)] backdrop-blur-xl">
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
            <p className="text-callout text-muted-foreground">{mySeat >= 0 ? "You're out. Stick around to see who wins." : "You're watching."}</p>
          </div>
        )}
      </div>

      <ScrabbleMenu open={menu} onOpenChange={setMenu} match={match} state={state} meId={meId} planning={planning} playing={playing} />
      <BagSheet open={bagOpen} onClose={() => setBagOpen(false)} match={match} state={state} rack={rack ?? undefined} />

      {drag && draggedTile && <DragGhost ref={ghost} letter={draftTiles.find((d) => d.id === drag.id)?.letter ?? draggedTile.letter} blank={draggedTile.letter === "?"} />}

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

// BINGO, spelled in tiles over the board for a moment.
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
