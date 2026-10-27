import { useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { Chess, type Square } from "chess.js";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ClassicState } from "../../../convex/chess";
import type { MatchView } from "../../../convex/matches";
import { Board, fromName, squareName, type BoardPiece, type Sq } from "./Board";
import { same, viewFor } from "./geometry";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { ChessFrame, ConfirmMove, draftTargets, realSquare, useMoveDraft, useSendMove, type Dock } from "./dock";

type Kind = BoardPiece["kind"];

// Keeps a stable key per physical piece across positions, so moved pieces slide instead of popping.
function useStableKeys(board: ReturnType<Chess["board"]>) {
  const prev = useRef<Map<string, { key: number; color: string; type: string }>>(new Map());
  const next = useRef(0);
  return useMemo(() => {
    const now = new Map<string, { color: string; type: string }>();
    for (const row of board) for (const p of row) if (p) now.set(p.square, { color: p.color, type: p.type });
    const keyed = new Map<string, { key: number; color: string; type: string }>();
    const vanished = [...prev.current.entries()].filter(([sq, p]) => {
      const n = now.get(sq);
      if (n && n.color === p.color && n.type === p.type) {
        keyed.set(sq, p);
        return false;
      }
      return true;
    });
    for (const [sq, p] of now) {
      if (keyed.has(sq)) continue;
      const i = vanished.findIndex(([, v]) => v.color === p.color && v.type === p.type);
      const j = i >= 0 ? i : vanished.findIndex(([, v]) => v.color === p.color && v.type === "p");
      const key = j >= 0 ? vanished.splice(j, 1)[0][1].key : next.current++;
      keyed.set(sq, { key, ...p });
    }
    prev.current = keyed;
    return keyed;
  }, [board]);
}

type Draft = { from: Sq; to: Sq; promotion?: string };

export function ClassicGame({ match, meId, above, below, dock }: { match: MatchView; meId: Id<"users"> | undefined; above?: ReactNode; below?: ReactNode; dock: Dock }) {
  const state = match.state as ClassicState;
  const chess = useMemo(() => new Chess(state.fen), [state.fen]);
  const me = match.players.find((p) => p.userId === meId);
  const myColor = (me?.color as "w" | "b" | undefined) ?? "w";
  const myTurn = match.status === "active" && !!me && chess.turn() === myColor;
  const [selected, setSelected] = useState<Sq | null>(null);
  const [draft, setDraft] = useMoveDraft<Draft & { choosing?: boolean }>(`${match._id}:${match.status}:${state.fen}`);
  const [sending, send] = useSendMove();
  // The position after the waiting move, shown on the board until it's confirmed.
  const preview = useMemo(() => {
    if (!draft || draft.choosing || !myTurn) return null;
    const after = new Chess(state.fen);
    return { chess: after, move: after.move({ from: squareName(draft.from), to: squareName(draft.to), promotion: draft.promotion }) };
  }, [draft, state.fen, myTurn]);
  const shown = preview ? draft : null;
  const display = preview?.chess ?? chess;
  const board = useMemo(() => display.board(), [display]);
  const keys = useStableKeys(board);

  const move = useMutation(api.chess.move).withOptimisticUpdate((store, { id, from, to, promotion }) => {
    const current = store.getQuery(api.matches.get, { id });
    if (!current) return;
    const c = new Chess((current.state as ClassicState).fen);
    try {
      const m = c.move({ from, to, promotion: promotion as "q" | undefined });
      const next: ClassicState = { kind: "classic", fen: c.fen(), moves: [...(current.state as ClassicState).moves, { san: m.san, lan: m.lan, at: Date.now() }] };
      store.setQuery(api.matches.get, { id }, { ...current, state: next, turn: current.players.find((p) => p.userId !== meId)?.userId, drawOffer: undefined });
    } catch {
      // Leave it to the server to reject.
    }
  });

  const pieces: BoardPiece[] = [...keys.entries()].map(([sq, p]) => {
    const [x, y] = fromName(sq);
    return { key: p.key, color: p.color as "w" | "b", kind: p.type.toUpperCase() as Kind, x, y };
  });
  const moved = shown && chess.get(squareName(shown.from) as Square);
  if (shown && moved) pieces.push({ key: "ghost", color: moved.color, kind: moved.type.toUpperCase() as Kind, x: shown.from[0], y: shown.from[1], ghost: true });

  // While a move waits you can still pick up any of your pieces, the waiting one included, and move it instead.
  const pickable = myTurn && !sending;
  const mineIn = (pos: Chess, sq: Sq) => pos.get(squareName(sq) as Square)?.color === myColor;
  const legalFrom = (sq: Sq) => chess.moves({ square: squareName(sq) as Square, verbose: true }).map((m) => fromName(m.to));
  const from = selected && realSquare(shown, selected);
  const targets: Sq[] = from && pickable ? draftTargets(shown, from, legalFrom(from)) : [];
  const last = state.moves.at(-1);
  const lastMove: [Sq, Sq] | null = shown ? [shown.from, shown.to] : last ? [fromName(last.lan.slice(0, 2)), fromName(last.lan.slice(2, 4))] : null;
  const king = display.inCheck() ? kingSquare(display, display.turn()) : null;
  const view = useMemo(() => viewFor("two", myColor), [myColor]);

  const onMove = (at: Sq, to: Sq) => {
    const from = realSquare(shown, at);
    if (shown && same(from, shown.from) && same(to, shown.from)) return setDraft(null);
    const piece = chess.get(squareName(from) as Square);
    setDraft({ from, to, choosing: piece?.type === "p" && (to[1] === 7 || to[1] === 0) });
  };
  const confirm = (d: Draft, san: string) => send(san, () => move({ id: match._id, from: squareName(d.from), to: squareName(d.to), promotion: d.promotion }));

  return (
    <ChessFrame
      dock={dock(
        sending ? <ConfirmMove move={sending} busy /> : shown && preview ? <ConfirmMove move={preview.move.san} onCancel={() => setDraft(null)} onConfirm={() => void confirm(shown, preview.move.san)} /> : undefined,
      )}
    >
      {above}
      <Board
        label="Classic chess board"
        pieces={pieces}
        view={view}
        canSelect={(sq) => pickable && mineIn(display, sq) && mineIn(chess, realSquare(shown, sq))}
        selected={selected}
        targets={targets}
        onSelect={setSelected}
        onMove={onMove}
        lastMove={lastMove}
        check={king ? [king] : []}
        disabled={!pickable}
      />
      {below}
      <MoveList moves={state.moves.map((m) => m.san)} />
      <Drawer open={!!draft?.choosing && myTurn} onOpenChange={(o) => !o && setDraft(null)}>
        <DrawerContent className="pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <DrawerHeader>
            <DrawerTitle>Promote to</DrawerTitle>
          </DrawerHeader>
          <div className="grid grid-cols-4 gap-3 px-4">
            {(["q", "r", "b", "n"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-label={{ q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[p]}
                onClick={() => draft && setDraft({ from: draft.from, to: draft.to, promotion: p })}
                className="grid aspect-square touch-manipulation place-items-center rounded-lg bg-card transition-transform duration-100 active:scale-[0.97]"
              >
                <img src={`/pieces/${myColor}${p.toUpperCase()}.svg`} alt="" className="size-4/5" />
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </ChessFrame>
  );
}

function kingSquare(chess: Chess, color: "w" | "b"): Sq | null {
  for (const row of chess.board()) for (const p of row) if (p && p.type === "k" && p.color === color) return fromName(p.square);
  return null;
}

function MoveList({ moves }: { moves: string[] }) {
  if (moves.length === 0) return <p className="flex h-7 items-center px-1 text-footnote text-muted-foreground">No moves yet. White starts.</p>;
  const pairs = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => [moves[2 * i], moves[2 * i + 1]] as const);
  const last = moves.length - 1;
  return (
    <div className="flex h-7 items-center gap-3.5 overflow-x-auto px-1 font-display text-callout tabular-nums [scrollbar-width:none]" aria-label="Moves" ref={(el) => el?.scrollTo({ left: el.scrollWidth })}>
      {pairs.map(([w, b], i) => (
        <span key={i} className="flex shrink-0 items-center gap-1.5">
          <span className="text-muted-foreground">{i + 1}.</span>
          <span className={cn(2 * i === last && "rounded-sm bg-primary px-1.5 text-primary-foreground")}>{w}</span>
          {b && <span className={cn(2 * i + 1 === last && "rounded-sm bg-primary px-1.5 text-primary-foreground")}>{b}</span>}
        </span>
      ))}
    </div>
  );
}
