import { useMemo, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import type { Color4 } from "../../../convex/chess/four/board";
import { inCheck, legalTargetsFrom, liveColors, move4, type FourState } from "../../../convex/chess/four/classic";
import { Board, type BoardPiece } from "./Board";
import { same, viewFor, type Sq } from "./geometry";
import { cn } from "@/lib/utils";
import { ChessFrame, ConfirmMove, draftTargets, realSquare, useMoveDraft, useSendMove, type Dock } from "./dock";

// The armies' colors, matching the piece art (scripts/gen-four-pieces.mjs). They're the pieces' own colors,
// so they stay the same in every theme.
import { SEAT_COLORS } from "../seats";
export { SEAT_COLORS };

export function FourGame({ match, meId, overlay, below, dock }: { match: MatchView; meId: Id<"users"> | undefined; overlay?: ReactNode; below?: ReactNode; dock: Dock }) {
  const state = match.state as FourState;
  const me = match.players.find((p) => p.userId === meId);
  const myColor = me?.color as Color4 | undefined;
  const view = useMemo(() => viewFor("four", myColor), [myColor]);
  const myTurn = match.status === "active" && !!myColor && state.turn === myColor;
  const [selected, setSelected] = useState<Sq | null>(null);
  const position = useMemo(() => `${match._id}:${match.status}:${JSON.stringify(state)}`, [match._id, match.status, state]);
  const [draft, setDraft] = useMoveDraft<{ from: Sq; to: Sq }>(position);
  const [sending, send] = useSendMove();
  // The position after the waiting move, shown on the board until it's confirmed.
  const preview = useMemo(() => (draft && myTurn ? move4(state, draft.from, draft.to) : null), [state, draft, myTurn]);
  const shown = preview ? draft : null;
  const display = preview ?? state;

  const move = useMutation(api.chess.fourMove).withOptimisticUpdate((store, { id, fromX, fromY, toX, toY }) => {
    const current = store.getQuery(api.matches.get, { id });
    if (!current) return;
    const next = move4(current.state as FourState, [fromX, fromY], [toX, toY]);
    if (!next) return;
    const turn = next.turn ? current.players.find((p) => p.color === next.turn)?.userId : undefined;
    store.setQuery(api.matches.get, { id }, { ...current, state: next, turn, moveCount: current.moveCount + 1 });
  });

  const pieces: BoardPiece[] = display.pieces.map((p) => ({ key: p.id, color: p.color, kind: p.kind, x: p.x, y: p.y, dead: p.dead }));
  const moved = shown && state.pieces.find((p) => !p.dead && p.x === shown.from[0] && p.y === shown.from[1]);
  if (shown && moved) pieces.push({ key: "ghost", color: moved.color, kind: moved.kind, x: moved.x, y: moved.y, ghost: true });

  // While a move waits you can still pick up any of your pieces, the waiting one included, and move it instead.
  const pickable = myTurn && !sending;
  const mineIn = (s: FourState, [x, y]: Sq) => s.pieces.some((p) => p.color === myColor && !p.dead && p.x === x && p.y === y);
  const mine = pickable ? display.pieces.map((p): Sq => [p.x, p.y]).filter((sq) => mineIn(display, sq) && mineIn(state, realSquare(shown, sq))) : [];
  const from = selected && realSquare(shown, selected);
  const targets = from && pickable ? draftTargets(shown, from, legalTargetsFrom(state, from[0], from[1])) : [];
  const last = state.moves.at(-1);
  const checked = liveColors(display)
    .filter((c) => inCheck(display, c))
    .map((c) => display.pieces.find((p) => p.kind === "K" && p.color === c && !p.dead))
    .filter((k) => !!k)
    .map((k): Sq => [k.x, k.y]);

  const onMove = (at: Sq, to: Sq) => {
    const from = realSquare(shown, at);
    setDraft(shown && same(from, shown.from) && same(to, shown.from) ? null : { from, to });
  };
  const text = preview?.moves.at(-1)?.text;
  const confirm = (d: { from: Sq; to: Sq }, text: string) => send(text, () => move({ id: match._id, fromX: d.from[0], fromY: d.from[1], toX: d.to[0], toY: d.to[1] }));

  return (
    <ChessFrame
      dock={dock(sending ? <ConfirmMove move={sending} busy /> : shown && text ? <ConfirmMove move={text} onCancel={() => setDraft(null)} onConfirm={() => void confirm(shown, text)} /> : undefined)}
    >
      <div className="-mx-2.5">
        <Board
          label="4-player chess board"
          pieces={pieces}
          view={view}
          canSelect={(sq) => mine.some((m) => same(m, sq))}
          selectable={mine}
          selected={selected}
          targets={targets}
          onSelect={setSelected}
          onMove={onMove}
          lastMove={shown ? [shown.from, shown.to] : last ? [last.from, last.to] : null}
          check={checked}
          disabled={!pickable}
        >
          {overlay}
        </Board>
      </div>
      {below}
      <FourMoves state={state} />
    </ChessFrame>
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
