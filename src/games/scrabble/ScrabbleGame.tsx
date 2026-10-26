import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ToteSimpleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { settingsOf } from "../../../convex/modes";
import { centre, evaluate, rulesOf, type Placement, type ScrabbleState, type Tile } from "../../../convex/scrabble/engine";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { AsyncButton } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ResignButton, Result, ThinkingDots, useHere } from "@/components/match";
import { OnlineDot } from "@/presence";
import { SEAT_COLORS } from "@/games/seats";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ScrabbleBoard, type BoardHandle, type DraftTile } from "./Board";
import { BagSheet, DockActions, GameMenu, TopBar } from "./Chrome";
import { LetterTile } from "./Tile";
import { Tiles } from "@/Tiles";
import { sfx } from "@/sound";

type Draft = { placed: Placement[]; order: number[] };
const key = (x: number, y: number) => `${x},${y}`;
// A dragged tile floats this far above the finger, so you can see where it's going.
const LIFT = 44;

// A Scrabble game: scores on top, the board in the middle, your rack and actions at the bottom. Lay tiles
// out any time; it's a plan until it's your turn and you play it.
export function ScrabbleGame({ match, meId }: { match: MatchView; meId: Id<"users"> | undefined }) {
  const state = match.state as ScrabbleState;
  const settings = settingsOf(match.mode, match.settings);
  const rules = rulesOf(settings);
  const mySeat = match.players.findIndex((p) => p.userId === meId);
  const playing = match.status === "active" && mySeat >= 0 && !state.out.includes(mySeat);
  const myTurn = playing && state.turn === mySeat;
  const seatColor = useCallback((seat: number) => SEAT_COLORS[match.players[seat]?.color ?? ""] ?? "#999", [match.players]);

  const rack = useQuery(api.scrabble.rack, mySeat >= 0 ? { id: match._id } : "skip");
  const serverDraft = useQuery(api.scrabble.draft, playing ? { id: match._id } : "skip");
  const saveDraft = useMutation(api.scrabble.saveDraft);
  const play = useMutation(api.scrabble.play);

  // --- My plan: tiles laid out on the board, and the order of my rack. ---
  const [draft, setDraft] = useState<Draft>({ placed: [], order: [] });
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !playing || rack === undefined || serverDraft === undefined) return;
    hydrated.current = true;
    if (serverDraft) setDraft(serverDraft);
  }, [playing, rack, serverDraft]);

  // Saved as you go, a moment after you stop moving tiles.
  useEffect(() => {
    if (!hydrated.current || !playing) return;
    // Quick, so other phones see your face-down tiles move almost as you move them.
    const timer = setTimeout(() => void saveDraft({ id: match._id, placed: draft.placed, order: draft.order }).catch(() => {}), 120);
    return () => clearTimeout(timer);
  }, [draft, playing, match._id, saveDraft]);

  const occupied = useMemo(() => new Set(state.tiles.map((t) => key(t.x, t.y))), [state.tiles]);
  const rackById = useMemo(() => new Map((rack ?? []).map((t) => [t.id, t])), [rack]);
  // Tiles that are still mine and on free squares. Someone playing over a planned square sends it home.
  const placed = useMemo(
    () => draft.placed.filter((p, i, all) => rackById.has(p.id) && !occupied.has(key(p.x, p.y)) && p.x < state.size && p.y < state.size && all.findIndex((q) => q.x === p.x && q.y === p.y) === i),
    [draft.placed, rackById, occupied, state.size],
  );
  const bumped = draft.placed.some((p) => rackById.has(p.id) && occupied.has(key(p.x, p.y)));
  const lastMover = state.moves.at(-1)?.seat;
  useEffect(() => {
    if (!bumped) return;
    const who = lastMover !== undefined && lastMover !== mySeat ? match.players[lastMover]?.name : null;
    toast(who ? `${who} played where you'd planned. Those tiles are back in your rack.` : "Some planned tiles went back to your rack.");
    setDraft((d) => ({ ...d, placed: d.placed.filter((p) => !occupied.has(key(p.x, p.y))) }));
  }, [bumped, occupied, lastMover, mySeat, match.players]);

  // The rack in my order, minus what's on the board.
  const inRack = useMemo(() => {
    const ids = (rack ?? []).map((t) => t.id);
    const order = [...draft.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !draft.order.includes(id))];
    return order.filter((id) => !placed.some((p) => p.id === id)).map((id) => rackById.get(id)!);
  }, [rack, draft.order, placed, rackById]);

  const setPlaced = (next: Placement[]) => setDraft((d) => ({ ...d, placed: next }));
  const setOrder = (order: number[]) => setDraft((d) => ({ ...d, order }));

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

  // --- Dragging, from the rack or the board ---
  const board = useRef<BoardHandle>(null);
  const rackEl = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; from: "rack" | "board" } | null>(null);
  const [target, setTarget] = useState<[number, number] | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [hop, setHop] = useState(0);

  const rackSlotAt = (clientX: number, clientY: number) => {
    const el = rackEl.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (clientY < r.top - 24 || clientY > r.bottom + 24) return null;
    const n = Math.max(1, rules.rack);
    return Math.max(0, Math.min(inRack.length, Math.round(((clientX - r.left) / r.width) * n - 0.5)));
  };

  const startDrag = (id: number, from: "rack" | "board", e: ReactPointerEvent) => {
    if (!playing || swapping) {
      if (swapping && from === "rack") setSwapping((s) => (s!.includes(id) ? s!.filter((x) => x !== id) : [...s!, id]));
      return;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let cell: [number, number] | null = null;
    let at: number | null = null;
    // The tile leans into the direction you drag it, and settles when you stop.
    let lastX = x0;
    let tilt = 0;
    const place = (cx: number, cy: number) => {
      tilt = Math.max(-14, Math.min(14, tilt * 0.6 + (cx - lastX) * 0.9));
      lastX = cx;
      if (ghost.current) ghost.current.style.transform = `translate3d(${cx}px, ${cy - LIFT}px, 0) translate(-50%, -50%) rotate(${tilt}deg)`;
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) {
        moved = true;
        setSelected(null);
        setDrag({ id, from });
        sfx("pick");
      }
      place(ev.clientX, ev.clientY);
      const c = board.current?.cellAt(ev.clientX, ev.clientY - LIFT) ?? null;
      const free = c && !occupied.has(key(c[0], c[1])) && !placed.some((p) => p.x === c[0] && p.y === c[1] && p.id !== id) ? c : null;
      if (free?.[0] !== cell?.[0] || free?.[1] !== cell?.[1]) setTarget((cell = free));
      const s = free ? null : rackSlotAt(ev.clientX, ev.clientY - LIFT / 2);
      if (s !== at) setSlot((at = s));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      setTarget(null);
      setSlot(null);
      if (!moved) {
        // A tap: rack tiles get picked up, board tiles go home.
        if (from === "board") recall(id);
        else {
          setSelected((s) => (s === id ? null : id));
          sfx("pick");
        }
        return;
      }
      if (ev.type === "pointercancel") return;
      if (cell) putDown(id, cell[0], cell[1]);
      else if (at !== null) {
        const ids = inRack.map((t) => t.id).filter((x) => x !== id);
        ids.splice(Math.min(at, ids.length), 0, id);
        setOrder([...ids, ...placed.filter((p) => p.id !== id).map((p) => p.id)]);
        if (from === "board") recall(id);
        else sfx("place");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    requestAnimationFrame(() => place(x0, y0));
  };

  // --- The live preview: words, score, and whether the dictionary knows them ---
  const evaluation = useMemo(() => (placed.length && rack ? evaluate(state.tiles, placed, rack, rules) : null), [placed, rack, state.tiles, rules]);
  const words = evaluation?.ok ? evaluation.words.map((w) => w.word) : [];
  const unknown = useQuery(api.scrabble.check, words.length ? { words } : "skip");
  const checking = words.length > 0 && unknown === undefined;
  const bad = unknown?.filter((w) => words.includes(w)) ?? [];
  const tone = !evaluation ? "idle" : !evaluation.ok || bad.length ? "bad" : checking ? "idle" : "ok";
  // Shake (and a soft "nope") the moment a layout stops making real words.
  const [shake, setShake] = useState(0);
  const lastTone = useRef(tone);
  useEffect(() => {
    if (tone === "bad" && lastTone.current !== "bad" && evaluation?.ok) {
      setShake((n) => n + 1);
      sfx("invalid");
    }
    lastTone.current = tone;
  }, [tone, evaluation?.ok]);
  const bubble = useMemo(() => {
    if (!evaluation?.ok) return null;
    const main = evaluation.words[0].cells.at(-1)!;
    return { x: main[0], y: main[1], text: String(evaluation.score) };
  }, [evaluation]);

  // --- The latest move, which every phone animates in ---
  const last = state.moves.at(-1);
  const fresh = useMemo(() => new Set(state.tiles.filter((t) => t.turn === state.moves.length - 1 && last?.kind === "play").map((t) => key(t.x, t.y))), [state.tiles, state.moves.length, last?.kind]);
  const lastCell = useMemo(() => [...fresh].map((k) => k.split(",").map(Number) as [number, number]).sort((a, b) => b[0] + b[1] - a[0] - a[1])[0], [fresh]);
  const scored = last?.kind === "play" && lastCell ? { key: state.moves.length, x: lastCell[0], y: lastCell[1], text: `+${last.score}`, color: seatColor(last.seat) } : null;

  // Whoever's turn it is, trying tiles out: face down on everyone else's board.
  const planning = useQuery(api.scrabble.planning, match.status === "active" ? { id: match._id } : "skip");
  const upUser = match.status === "active" ? match.players[state.turn]?.userId : undefined;
  const upPlan = upUser && upUser !== meId ? planning?.find((p) => p.userId === upUser) : undefined;
  const ghosts = upPlan ? { cells: upPlan.cells, color: seatColor(state.turn) } : null;
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
  const px = Math.floor(finished ? Math.min(box.w, box.h) : Math.min(box.w, box.h));

  // The board runs right up under the status bar here, so the solid strip that normally covers that band
  // steps aside (see TopEdge).
  useEffect(() => {
    if (finished) return;
    document.documentElement.dataset.fullbleed = "";
    return () => void delete document.documentElement.dataset.fullbleed;
  }, [finished]);
  const [menu, setMenu] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const draggedTile = drag ? rackById.get(drag.id) : undefined;
  const draftTiles: DraftTile[] = placed.map((p) => {
    const tile = rackById.get(p.id)!;
    return { id: p.id, x: p.x, y: p.y, letter: tile.letter === "?" ? (p.letter ?? "?").toUpperCase() : tile.letter, blank: tile.letter === "?" };
  });

  if (finished) {
    return (
      <div className="flex flex-1 flex-col gap-2 pb-1">
        <div ref={area} className="relative aspect-square w-full">
          {px > 0 && (
            <div className="absolute inset-0 flex items-start justify-center">
            <ScrabbleBoard
              ref={board}
              size={state.size}
              px={px}
              view={finished ? undefined : { width: box.w, height: box.h, padTop: box.top, padBottom: box.bottom }}
              tiles={state.tiles}
              draft={draftTiles}
              seatColor={seatColor}
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
            </div>
          )}
        </div>
        <div className="pt-4">
          <Result match={match} meId={meId} />
        </div>
      </div>
    );
  }

  // A game in progress takes the whole screen, Letter League style: the board is the background, with
  // buttons floating over its top and your rack in a see-through dock over its bottom.
  return (
    <div className="relative -mx-4 -mb-[calc(env(safe-area-inset-bottom)+16px)] h-[100dvh] overflow-hidden bg-background [background-image:radial-gradient(color-mix(in_oklch,var(--foreground)_8%,transparent)_1px,transparent_1px)] [background-size:16px_16px]">
      <div ref={area} className="absolute inset-0">
        {px > 0 && (
          <div className="absolute inset-0">
            <ScrabbleBoard
              ref={board}
              size={state.size}
              px={px}
              view={finished ? undefined : { width: box.w, height: box.h, padTop: box.top, padBottom: box.bottom }}
              tiles={state.tiles}
              draft={draftTiles}
              seatColor={seatColor}
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
          </div>
        )}
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
            <Button variant="secondary" className="h-14 w-14 shrink-0 flex-col gap-0.5 rounded-lg px-0 text-caption" onClick={() => setBagOpen(true)} aria-label={`Bag, ${state.bag} left`}>
              <ToteSimpleIcon weight="fill" className="size-[22px]" />
              <span className="font-display tabular-nums">{state.bag}</span>
            </Button>
            <p className="text-callout text-muted-foreground">{mySeat >= 0 ? "You're out. Stick around to see who wins." : "You're watching."}</p>
          </div>
        )}
      </div>

      <GameMenu open={menu} onOpenChange={setMenu} match={match} state={state} meId={meId} planning={planning} playing={playing} />
      <BagSheet open={bagOpen} onOpenChange={setBagOpen} match={match} state={state} rack={rack ?? undefined} />

      {drag &&
        draggedTile &&
        createPortal(
          <div ref={ghost} className="pointer-events-none fixed left-0 top-0 z-50 drop-shadow-xl" style={{ transform: "translate3d(-200px,-200px,0)" }}>
            {/* A held tile jiggles in your fingers. */}
            <motion.span className="block" initial={{ scale: 1 }} animate={{ scale: 1.12, rotate: [0, -4, 4, -3, 3, 0] }} transition={{ scale: { type: "spring", bounce: 0.5, duration: 0.3 }, rotate: { duration: 0.5, repeat: Infinity, repeatDelay: 0.4 } }}>
              <LetterTile letter={draftTiles.find((d) => d.id === drag.id)?.letter ?? draggedTile.letter} blank={draggedTile.letter === "?"} size={52} />
            </motion.span>
          </div>,
          document.body,
        )}

      <BlankPicker
        open={blankFor !== null}
        onClose={() => setBlankFor(null)}
        onPick={(letter) => {
          if (blankFor) putDown(blankFor.id, blankFor.x, blankFor.y, letter);
          setBlankFor(null);
        }}
      />
    </div>
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

// --- Rack and actions ---

const Rack = ({
  ref,
  tiles,
  size,
  selected,
  swapping,
  dragging,
  slot,
  hop,
  onDown,
}: {
  ref: React.Ref<HTMLDivElement>;
  tiles: Tile[];
  size: number;
  selected: number | null;
  swapping: number[] | null;
  dragging: number | null;
  slot: number | null;
  hop: number;
  onDown: (id: number, e: ReactPointerEvent) => void;
}) => {
  // While a tile is dragged over the rack, the others part to show where it'll go.
  const shown = tiles.filter((t) => t.id !== dragging);
  const items: (Tile | null)[] = [...shown];
  if (slot !== null) items.splice(Math.min(slot, items.length), 0, null);
  return (
    <div ref={ref} className="grid h-[62px] items-center gap-1.5 rounded-lg bg-muted/60 px-2" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} aria-label="Your tiles">
      {items.map((t, i) =>
        t === null ? (
          <span key="slot" className="aspect-square rounded-sm border-2 border-dashed border-primary/50" />
        ) : (
          <motion.button
            key={t.id}
            layout
            type="button"
            initial={{ scale: 0.4, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.35, duration: 0.4, delay: i * 0.03 }}
            aria-label={t.letter === "?" ? "Blank tile" : `Tile ${t.letter}`}
            aria-pressed={swapping ? swapping.includes(t.id) : selected === t.id}
            className={cn("grid touch-none place-items-center", (selected === t.id || swapping?.includes(t.id)) && "-translate-y-1.5")}
            style={{ transition: "translate 120ms ease-out" }}
            onPointerDown={(e) => onDown(t.id, e)}
          >
            {/* Shuffling makes every tile hop; a picked-up tile jiggles until you put it somewhere. */}
            <motion.span key={hop} className="grid w-full place-items-center" animate={hop ? { y: [0, -14, 0] } : undefined} transition={{ duration: 0.35, delay: i * 0.035, ease: "easeOut" }}>
              <motion.span
                className="grid w-full place-items-center"
                animate={selected === t.id ? { rotate: [0, -5, 5, -4, 4, 0] } : { rotate: 0 }}
                transition={selected === t.id ? { duration: 0.5, repeat: Infinity, repeatDelay: 0.5 } : { duration: 0.15 }}
              >
                <LetterTile
                  letter={t.letter}
                  size={46}
                  className="w-full max-w-[46px]"
                  style={{
                    height: "auto",
                    aspectRatio: "1",
                    // Keeps the tile's own edge and shadow, and adds the ring.
                    boxShadow:
                      selected === t.id ? "inset 0 -3px 0 #cdb07c, 0 0 0 3px var(--primary), 0 8px 14px rgb(0 0 0 / 0.28)"
                      : swapping?.includes(t.id) ? "inset 0 -3px 0 #cdb07c, 0 0 0 3px var(--tile-hit)"
                      : undefined,
                  }}
                />
              </motion.span>
            </motion.span>
          </motion.button>
        ),
      )}
      {pad(size - items.length)}
    </div>
  );
};

// Empty places in the rack keep the tiles from stretching.
const pad = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => <span key={`pad${i}`} />);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Which letter a blank plays as.
function BlankPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (letter: string) => void }) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Blank tile plays as</DrawerTitle>
        </DrawerHeader>
        <div className="grid grid-cols-7 gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <AnimatePresence>
            {[...ALPHABET].map((l) => (
              <button key={l} type="button" aria-label={l} onClick={() => onPick(l)} className="grid aspect-square touch-manipulation place-items-center rounded-sm transition-transform active:scale-[0.94]">
                <LetterTile letter={l} blank size={44} />
              </button>
            ))}
          </AnimatePresence>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
