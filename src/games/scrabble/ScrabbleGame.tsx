import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowCounterClockwiseIcon, ArrowsClockwiseIcon, HandIcon, PencilSimpleIcon, ShuffleIcon, SkipForwardIcon } from "@phosphor-icons/react";
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
import { LetterTile } from "./Tile";

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
    const timer = setTimeout(() => void saveDraft({ id: match._id, placed: draft.placed, order: draft.order }).catch(() => {}), 400);
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
  };
  const recall = (id: number) => setPlaced(placed.filter((p) => p.id !== id));

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
    const place = (cx: number, cy: number) => {
      if (ghost.current) ghost.current.style.transform = `translate3d(${cx}px, ${cy - LIFT}px, 0) translate(-50%, -50%)`;
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) {
        moved = true;
        setSelected(null);
        setDrag({ id, from });
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
        else setSelected((s) => (s === id ? null : id));
        return;
      }
      if (ev.type === "pointercancel") return;
      if (cell) putDown(id, cell[0], cell[1]);
      else if (at !== null) {
        const ids = inRack.map((t) => t.id).filter((x) => x !== id);
        ids.splice(Math.min(at, ids.length), 0, id);
        setOrder([...ids, ...placed.filter((p) => p.id !== id).map((p) => p.id)]);
        if (from === "board") recall(id);
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
  const bubble = useMemo(() => {
    if (!evaluation?.ok) return null;
    const main = evaluation.words[0].cells.at(-1)!;
    return { x: main[0], y: main[1], text: String(evaluation.score) };
  }, [evaluation]);

  // --- The latest move, which every phone animates in ---
  const last = state.moves.at(-1);
  const fresh = useMemo(() => new Set(state.tiles.filter((t) => t.turn === state.moves.length - 1 && last?.kind === "play").map((t) => key(t.x, t.y))), [state.tiles, state.moves.length, last?.kind]);
  const focus = useMemo<[number, number]>(() => {
    if (!state.tiles.length && !draft.placed.length) return [centre(state.size), centre(state.size)];
    const pts = [...state.tiles, ...draft.placed];
    return [Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length), Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length)];
    // Only where to look when the board first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated.current]);

  // --- Board size: as big as fits between the scores and the rack ---
  const area = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(0);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setPx(Math.floor(Math.min(el.clientWidth, el.clientHeight || el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const finished = match.status === "finished";
  const draggedTile = drag ? rackById.get(drag.id) : undefined;
  const draftTiles: DraftTile[] = placed.map((p) => {
    const tile = rackById.get(p.id)!;
    return { id: p.id, x: p.x, y: p.y, letter: tile.letter === "?" ? (p.letter ?? "?").toUpperCase() : tile.letter, blank: tile.letter === "?" };
  });

  return (
    <div className="flex flex-1 flex-col gap-2 pb-1">
      <Scoreboard match={match} state={state} meId={meId} />
      <StatusLine match={match} state={state} meId={meId} myTurn={myTurn} />
      <div ref={area} className={cn("relative flex justify-center", finished ? "aspect-square w-full" : "min-h-[240px] flex-1")}>
        {px > 0 && (
          <div className={cn("absolute inset-0 flex justify-center", finished ? "items-start" : "items-center")}>
            <ScrabbleBoard
              ref={board}
              size={state.size}
              px={px}
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
              onCellTap={onCellTap}
              onDraftDown={(id, e) => startDrag(id, "board", e)}
            />
          </div>
        )}
      </div>

      {finished ? (
        <div className="pt-4">
          <Result match={match} meId={meId} />
        </div>
      ) : playing ? (
        <>
          <Rack
            ref={rackEl}
            tiles={inRack}
            size={rules.rack}
            selected={selected}
            swapping={swapping}
            dragging={drag?.from === "rack" ? drag.id : null}
            slot={slot}
            onDown={(id, e) => startDrag(id, "rack", e)}
          />
          <Actions
            match={match}
            myTurn={myTurn}
            placed={placed}
            evaluation={evaluation}
            bad={bad}
            checking={checking}
            swapping={swapping}
            setSwapping={setSwapping}
            bagCount={state.bag}
            onShuffle={() => setOrder(shuffled(inRack.map((t) => t.id)))}
            onRecall={() => setPlaced([])}
            onPlay={async () => {
              const score = await play({ id: match._id, tiles: placed });
              setDraft((d) => ({ ...d, placed: [] }));
              if (evaluation?.ok && evaluation.bingo) toast.success(`Bingo! +${score}`);
            }}
          />
        </>
      ) : mySeat >= 0 ? (
        <p className="py-3 text-center text-callout text-muted-foreground">You're out. Stick around to see who wins.</p>
      ) : (
        <p className="py-3 text-center text-callout text-muted-foreground">You're watching.</p>
      )}

      {drag &&
        draggedTile &&
        createPortal(
          <div ref={ghost} className="pointer-events-none fixed left-0 top-0 z-50 drop-shadow-xl" style={{ transform: "translate3d(-200px,-200px,0)" }}>
            <LetterTile letter={draftTiles.find((d) => d.id === drag.id)?.letter ?? draggedTile.letter} blank={draggedTile.letter === "?"} size={52} />
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

function shuffled<T>(xs: T[]) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Scores ---

function Scoreboard({ match, state, meId }: { match: MatchView; state: ScrabbleState; meId: Id<"users"> | undefined }) {
  const planning = useQuery(api.scrabble.planning, match.status === "active" ? { id: match._id } : "skip");
  return (
    <LayoutGroup id={`scores-${match._id}`}>
      <ol className="-mx-4 flex h-[60px] snap-x gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Scores">
        {match.players.map((p, seat) => (
          <Score key={p.userId} player={p} seat={seat} state={state} isMe={p.userId === meId} active={match.status === "active"} planning={planning?.find((x) => x.userId === p.userId)?.count ?? 0} />
        ))}
      </ol>
    </LayoutGroup>
  );
}

function Score({ player, seat, state, isMe, active, planning }: { player: MatchView["players"][number]; seat: number; state: ScrabbleState; isMe: boolean; active: boolean; planning: number }) {
  const { online } = useHere(player.userId);
  const up = active && state.turn === seat;
  const out = state.out.includes(seat);
  const color = SEAT_COLORS[player.color ?? ""];
  return (
    <li className={cn("relative flex min-w-[96px] shrink-0 snap-start items-center gap-2 rounded-lg px-2.5", out && "opacity-45")} aria-current={up ? "true" : undefined} data-seat={seat}>
      {up && <motion.span layoutId="turn" className="absolute inset-0 rounded-lg bg-card ring-2 ring-primary" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
      <span className="relative shrink-0">
        <PlayerAvatar name={player.name} image={player.image} frame={player.frame} frameColor={player.frameColor} size={32} />
        <span className="absolute -bottom-0.5 -right-0.5 [--dot-ring:var(--background)]">
          <OnlineDot online={online} />
        </span>
      </span>
      <span className="relative min-w-0">
        <span className="flex items-center gap-1 text-footnote font-semibold">
          <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="max-w-[72px] truncate">{isMe ? "You" : player.name}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <motion.span key={state.scores[seat]} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="font-display text-body tabular-nums" aria-label={`${state.scores[seat]} points`}>
            {state.scores[seat]}
          </motion.span>
          {planning > 0 && !isMe && (
            <span className="flex items-center gap-0.5 text-caption font-semibold text-muted-foreground" aria-label={`Planning ${planning} tiles`}>
              <PencilSimpleIcon weight="fill" size={11} />
              {planning}
            </span>
          )}
        </span>
      </span>
    </li>
  );
}

// Whose turn it is, live, and the clock on live games.
function StatusLine({ match, state, meId, myTurn }: { match: MatchView; state: ScrabbleState; meId: Id<"users"> | undefined; myTurn: boolean }) {
  const up = match.status === "active" ? match.players[state.turn] : undefined;
  const { here } = useHere(up?.userId ?? ("" as Id<"users">));
  const last = state.moves.at(-1);
  const lastBy = last ? match.players[last.seat] : undefined;
  const lastText =
    !last || !lastBy ? null
    : last.kind === "play" ? `${lastBy.userId === meId ? "You" : lastBy.name}: ${last.words!.map((w) => w.word).join(", ")} +${last.score}`
    : `${lastBy.userId === meId ? "You" : lastBy.name} ${last.kind === "swap" ? `swapped ${last.count}` : last.kind === "pass" ? "passed" : last.kind === "timeout" ? "ran out of time" : "resigned"}`;
  return (
    <div className="flex h-12 flex-col justify-center px-1">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-display text-body" aria-live="polite">
          {!up ? "Final scores" : myTurn ? "Your turn" : here ? `${up.name} is on it` : `Waiting for ${up.name}`}
          {up && !myTurn && here && (
            <span className="ml-2 inline-flex align-middle">
              <ThinkingDots />
            </span>
          )}
        </p>
        {state.deadline !== null && match.status === "active" && <Countdown deadline={state.deadline} mine={myTurn} />}
      </div>
      <p className="truncate text-footnote text-muted-foreground">
        {lastText}
        {lastText && " · "}
        {state.bag} in the bag, round {state.round}
      </p>
    </div>
  );
}

function Countdown({ deadline, mine }: { deadline: number; mine: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const urgent = left <= 10;
  return (
    <span
      className={cn("rounded-full px-2.5 py-1 font-display text-callout tabular-nums", urgent ? "bg-[var(--tile-hit)] text-[var(--tile-hit-ink)]" : mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
      aria-label={`${left} seconds left`}
    >
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
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
  onDown,
}: {
  ref: React.Ref<HTMLDivElement>;
  tiles: Tile[];
  size: number;
  selected: number | null;
  swapping: number[] | null;
  dragging: number | null;
  slot: number | null;
  onDown: (id: number, e: ReactPointerEvent) => void;
}) => {
  // While a tile is dragged over the rack, the others part to show where it'll go.
  const shown = tiles.filter((t) => t.id !== dragging);
  const items: (Tile | null)[] = [...shown];
  if (slot !== null) items.splice(Math.min(slot, items.length), 0, null);
  return (
    <div ref={ref} className="grid h-[60px] items-center gap-1.5 rounded-lg bg-card px-2" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} aria-label="Your tiles">
      {items.map((t, i) =>
        t === null ? (
          <span key="slot" className="aspect-square rounded-sm border-2 border-dashed border-primary/50" />
        ) : (
          <motion.button
            key={t.id}
            layout
            type="button"
            transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
            aria-label={t.letter === "?" ? "Blank tile" : `Tile ${t.letter}`}
            aria-pressed={swapping ? swapping.includes(t.id) : selected === t.id}
            className={cn("grid touch-none place-items-center", (selected === t.id || swapping?.includes(t.id)) && "-translate-y-1.5")}
            style={{ transition: "translate 120ms ease-out" }}
            onPointerDown={(e) => onDown(t.id, e)}
          >
            <LetterTile
              letter={t.letter}
              size={46}
              className="w-full max-w-[46px]"
              style={{
                height: "auto",
                aspectRatio: "1",
                outline: selected === t.id ? "3px solid var(--primary)" : swapping?.includes(t.id) ? "3px solid var(--tile-hit)" : undefined,
              }}
            />
          </motion.button>
        ),
      )}
      {pad(size - items.length)}
    </div>
  );
};

// Empty places in the rack keep the tiles from stretching.
const pad = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => <span key={`pad${i}`} />);

function Actions({
  match,
  myTurn,
  placed,
  evaluation,
  bad,
  checking,
  swapping,
  setSwapping,
  bagCount,
  onShuffle,
  onRecall,
  onPlay,
}: {
  match: MatchView;
  myTurn: boolean;
  placed: Placement[];
  evaluation: ReturnType<typeof evaluate> | null;
  bad: string[];
  checking: boolean;
  swapping: number[] | null;
  setSwapping: (s: number[] | null) => void;
  bagCount: number;
  onShuffle: () => void;
  onRecall: () => void;
  onPlay: () => Promise<void>;
}) {
  const swap = useMutation(api.scrabble.swap);
  const pass = useMutation(api.scrabble.pass);
  const small = "h-14 w-14 shrink-0 flex-col gap-0.5 rounded-lg px-0 text-caption [&_svg:not([class*='size-'])]:size-[22px]";

  if (swapping) {
    return (
      <div className="flex gap-2">
        <Button size="xl" variant="secondary" onClick={() => setSwapping(null)}>
          Cancel
        </Button>
        <AsyncButton
          size="xl"
          className="flex-1"
          disabled={swapping.length === 0 || swapping.length > bagCount}
          icon={<ArrowsClockwiseIcon weight="bold" />}
          onClick={async () => {
            await swap({ id: match._id, tileIds: swapping });
            setSwapping(null);
          }}
        >
          {swapping.length === 0 ? "Pick tiles to swap" : swapping.length > bagCount ? `Only ${bagCount} in the bag` : `Swap ${swapping.length}`}
        </AsyncButton>
      </div>
    );
  }

  const label =
    !evaluation ? (myTurn ? "Play" : "Your turn's next")
    : !evaluation.ok ? evaluation.error
    : bad.length ? (bad.length === 1 ? `${bad[0]} isn't a word` : `${bad.length} aren't words`)
    : checking ? `${evaluation.score} points`
    : myTurn ? `Play ${evaluation.words[0].word} for ${evaluation.score}`
    : `Planned: ${evaluation.words[0].word}, ${evaluation.score}`;
  const canPlay = myTurn && !!evaluation?.ok && bad.length === 0 && !checking;

  return (
    <div className="flex items-stretch gap-2">
      {placed.length > 0 ? (
        <Button variant="secondary" className={small} onClick={onRecall} aria-label="Recall tiles">
          <ArrowCounterClockwiseIcon weight="bold" />
          Recall
        </Button>
      ) : (
        <Button variant="secondary" className={small} onClick={onShuffle} aria-label="Shuffle tiles">
          <ShuffleIcon weight="bold" />
          Shuffle
        </Button>
      )}
      {myTurn ? (
        <>
          <Button variant="secondary" className={small} disabled={bagCount === 0} onClick={() => setSwapping([])} aria-label="Swap tiles">
            <ArrowsClockwiseIcon weight="bold" />
            Swap
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary" className={small} aria-label="Pass">
                <SkipForwardIcon weight="bold" />
                Pass
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Pass this turn?</AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep thinking</AlertDialogCancel>
                <AlertDialogAction onClick={() => void pass({ id: match._id }).catch((e) => toast.error(errorText(e)))}>Pass</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        <ResignButton
          match={match}
          className={small}
          detail={match.players.length > 2 ? "Your tiles go back in the bag and the others play on. You place last." : "The other player wins and gets the rating points."}
        />
      )}
      <AsyncButton size="xl" className="min-w-0 flex-1 px-3" disabled={!canPlay} icon={myTurn ? <HandIcon weight="fill" /> : undefined} onClick={onPlay}>
        <span className="truncate">{label}</span>
      </AsyncButton>
    </div>
  );
}

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
