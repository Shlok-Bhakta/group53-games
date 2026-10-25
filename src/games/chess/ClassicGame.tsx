import { useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { Chess, type Square } from "chess.js";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ClassicState } from "../../../convex/chess";
import type { MatchView } from "../../../convex/matches";
import { Board, fromName, squareName, type BoardPiece, type Sq } from "./Board";
import { viewFor } from "./geometry";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

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

export function ClassicGame({ match, meId, above, below }: { match: MatchView; meId: Id<"users"> | undefined; above?: ReactNode; below?: ReactNode }) {
  const state = match.state as ClassicState;
  const chess = useMemo(() => new Chess(state.fen), [state.fen]);
  const board = useMemo(() => chess.board(), [chess]);
  const keys = useStableKeys(board);
  const me = match.players.find((p) => p.userId === meId);
  const myColor = (me?.color as "w" | "b" | undefined) ?? "w";
  const myTurn = match.status === "active" && !!me && chess.turn() === myColor;
  const [selected, setSelected] = useState<Sq | null>(null);
  const [promotion, setPromotion] = useState<{ from: Sq; to: Sq } | null>(null);

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

  const targets: Sq[] = selected ? chess.moves({ square: squareName(selected) as Square, verbose: true }).map((m) => fromName(m.to)) : [];
  const last = state.moves.at(-1);
  const lastMove: [Sq, Sq] | null = last ? [fromName(last.lan.slice(0, 2)), fromName(last.lan.slice(2, 4))] : null;
  const king = chess.inCheck() ? kingSquare(chess, chess.turn()) : null;
  const view = useMemo(() => viewFor("two", myColor), [myColor]);

  const play = (from: Sq, to: Sq, promo?: string) => {
    move({ id: match._id, from: squareName(from), to: squareName(to), promotion: promo }).catch((err: Error) => toast.error(err.message.replace(/^.*Uncaught Error: /, "").split("\n")[0]));
  };
  const onMove = (from: Sq, to: Sq) => {
    const piece = chess.get(squareName(from) as Square);
    if (piece?.type === "p" && (to[1] === 7 || to[1] === 0)) setPromotion({ from, to });
    else play(from, to);
  };

  return (
    <>
      {above}
      <Board
        label="Classic chess board"
        pieces={pieces}
        view={view}
        canSelect={(sq) => myTurn && chess.get(squareName(sq) as Square)?.color === myColor}
        selected={selected}
        targets={targets}
        onSelect={setSelected}
        onMove={onMove}
        lastMove={lastMove}
        check={king ? [king] : []}
        disabled={!myTurn}
      />
      {below}
      <MoveList moves={state.moves.map((m) => m.san)} />
      <Drawer open={promotion !== null} onOpenChange={(o) => !o && setPromotion(null)}>
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
                onClick={() => {
                  if (promotion) play(promotion.from, promotion.to, p);
                  setPromotion(null);
                }}
                className="grid aspect-square touch-manipulation place-items-center rounded-lg bg-card transition-transform duration-100 active:scale-[0.97]"
              >
                <img src={`/pieces/${myColor}${p.toUpperCase()}.svg`} alt="" className="size-4/5" />
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
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
