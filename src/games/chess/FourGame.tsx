import { useMemo, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import type { Color4 } from "../../../convex/chess/four/board";
import { inCheck, legalTargetsFrom, liveColors, move4, type FourState } from "../../../convex/chess/four/classic";
import { Board, type BoardPiece } from "./Board";
import { viewFor, type Sq } from "./geometry";
import { errorText } from "@/lib/errors";
import { cn } from "@/lib/utils";

// The armies' colors, matching the piece art (scripts/gen-four-pieces.mjs). They're the pieces' own colors,
// so they stay the same in every theme.
import { SEAT_COLORS } from "../seats";
export { SEAT_COLORS };

export function FourGame({ match, meId, overlay, below }: { match: MatchView; meId: Id<"users"> | undefined; overlay?: ReactNode; below?: ReactNode }) {
  const state = match.state as FourState;
  const me = match.players.find((p) => p.userId === meId);
  const myColor = me?.color as Color4 | undefined;
  const view = useMemo(() => viewFor("four", myColor), [myColor]);
  const myTurn = match.status === "active" && !!myColor && state.turn === myColor;
  const [selected, setSelected] = useState<Sq | null>(null);

  const move = useMutation(api.chess.fourMove).withOptimisticUpdate((store, { id, fromX, fromY, toX, toY }) => {
    const current = store.getQuery(api.matches.get, { id });
    if (!current) return;
    const next = move4(current.state as FourState, [fromX, fromY], [toX, toY]);
    if (!next) return;
    const turn = next.turn ? current.players.find((p) => p.color === next.turn)?.userId : undefined;
    store.setQuery(api.matches.get, { id }, { ...current, state: next, turn, moveCount: current.moveCount + 1 });
  });

  const pieces: BoardPiece[] = state.pieces.map((p) => ({ key: p.id, color: p.color, kind: p.kind, x: p.x, y: p.y, dead: p.dead }));
  const mine = myTurn ? state.pieces.filter((p) => p.color === myColor && !p.dead).map((p): Sq => [p.x, p.y]) : [];
  const targets = selected && myTurn ? legalTargetsFrom(state, selected[0], selected[1]) : [];
  const last = state.moves.at(-1);
  const checked = liveColors(state)
    .filter((c) => inCheck(state, c))
    .map((c) => state.pieces.find((p) => p.kind === "K" && p.color === c && !p.dead))
    .filter((k) => !!k)
    .map((k): Sq => [k.x, k.y]);

  return (
    <>
      <div className="-mx-2.5">
        <Board
          label="4-player chess board"
          pieces={pieces}
          view={view}
          canSelect={(sq) => mine.some(([x, y]) => x === sq[0] && y === sq[1])}
          selectable={mine}
          selected={selected}
          targets={targets}
          onSelect={setSelected}
          onMove={(from, to) =>
            void move({ id: match._id, fromX: from[0], fromY: from[1], toX: to[0], toY: to[1] }).catch((err) => toast.error(errorText(err)))
          }
          lastMove={last ? [last.from, last.to] : null}
          check={checked}
          disabled={!myTurn}
        >
          {overlay}
        </Board>
      </div>
      {below}
      <FourMoves state={state} />
    </>
  );
}

function FourMoves({ state }: { state: FourState }) {
  if (state.moves.length === 0) return <p className="flex h-7 items-center justify-center px-1 text-footnote text-muted-foreground">Red moves first, then play goes clockwise.</p>;
  const recent = state.moves.slice(-24);
  return (
    <div className="flex h-7 items-center gap-3.5 overflow-x-auto px-1 font-display text-callout tabular-nums [scrollbar-width:none]" aria-label="Moves" ref={(el) => el?.scrollTo({ left: el.scrollWidth })}>
      {recent.map((m, i) => (
        <span key={state.moves.length - recent.length + i} className={cn("flex shrink-0 items-center gap-1.5 rounded-sm", i === recent.length - 1 && "bg-card px-1.5")}>
          <span className="size-2 rounded-full" style={{ background: SEAT_COLORS[m.color] }} />
          {m.text}
        </span>
      ))}
    </div>
  );
}
