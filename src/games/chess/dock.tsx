import { useState, type ReactNode } from "react";
import { CheckIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { usePending } from "@/components/AsyncButton";
import { same, type Sq } from "./geometry";

// A chess screen: the board and its players as one block in the middle, and the actions docked at the
// bottom where thumbs are.
export function ChessFrame({ children, dock }: { children: ReactNode; dock: ReactNode }) {
  return (
    <>
      <div className="flex flex-1 flex-col justify-center gap-2 py-2">{children}</div>
      <div className="pt-4">{dock}</div>
    </>
  );
}

export type Dock = (confirm?: ReactNode) => ReactNode;

// A move made on the board in an async game waits here until it's confirmed. It belongs to one position, so
// a move landing, a resignation or a timeout drops it.
export function useMoveDraft<T extends { from: Sq; to: Sq }>(position: string) {
  const [draft, setDraft] = useState<{ position: string; value: T } | null>(null);
  const value = draft?.position === position ? draft.value : null;
  return [value, (next: T | null) => setDraft(next && { position, value: next })] as const;
}

// While a move waits, the board shows the position after it. Squares on screen map back to the real position,
// where the moved piece still stands on its own square, so picking it up again moves it from there.
export function realSquare(draft: { from: Sq; to: Sq } | null, sq: Sq): Sq {
  return draft && same(sq, draft.to) ? draft.from : sq;
}

// The legal targets for a piece picked up while a move waits. The waiting piece can also go back home,
// which cancels the move.
export function draftTargets(draft: { from: Sq; to: Sq } | null, from: Sq, legal: Sq[]): Sq[] {
  if (!draft || !same(from, draft.from)) return legal;
  return [...legal.filter((t) => !same(t, draft.to)), draft.from];
}

const bar = "h-[60px] rounded-lg";
// Confirm stays up, spinning, at least this long, so a double tap on it can't land on Resign once the dock
// swaps back.
const HOLD_MS = 400;

// Sends a confirmed move. `sending` names it until the server has it.
export function useSendMove() {
  const [sending, setSending] = useState<string | null>(null);
  const [, run] = usePending();
  const send = (move: string, action: () => Promise<unknown>) =>
    run(async () => {
      setSending(move);
      try {
        await Promise.all([action(), new Promise((r) => setTimeout(r, HOLD_MS))]);
      } finally {
        setSending(null);
      }
    });
  return [sending, send] as const;
}

// Takes the place of the draw and resign buttons while a move waits.
export function ConfirmMove({ move, busy, onConfirm, onCancel }: { move: string; busy?: boolean; onConfirm?: () => void; onCancel?: () => void }) {
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-2.5">
      <Button variant="secondary" className={`${bar} flex-col gap-1 bg-card text-footnote [&_svg:not([class*='size-'])]:size-[22px]`} disabled={busy} onClick={onCancel}>
        <XIcon weight="bold" /> Cancel
      </Button>
      <Button className={`${bar} gap-2.5 text-body [&_svg:not([class*='size-'])]:size-5`} disabled={busy} aria-busy={busy} onClick={onConfirm}>
        {busy ? <SpinnerGapIcon weight="bold" className="animate-spin" /> : <CheckIcon weight="bold" />}
        Confirm <span className="min-w-0 truncate font-display text-heading">{move}</span>
      </Button>
    </div>
  );
}
