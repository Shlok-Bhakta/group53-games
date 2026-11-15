import { useRef, useState, type ReactNode } from "react";
import { CheckIcon, SpinnerGapIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ActionRail } from "@/components/game/GameFrame";
import { toast } from "sonner";
import { errorText } from "@/lib/errors";
import { same, type Sq } from "./geometry";

export type Dock = (confirm?: ReactNode) => ReactNode;

export function useMoveDraft<T extends { from: Sq; to: Sq }>(position: string) {
  const [draft, setDraft] = useState<{ position: string; value: T } | null>(null);
  const value = draft?.position === position ? draft.value : null;
  return [value, (next: T | null) => setDraft(next && { position, value: next })] as const;
}

export function realSquare(draft: { from: Sq; to: Sq } | null, sq: Sq): Sq {
  return draft && same(sq, draft.to) ? draft.from : sq;
}

export function draftTargets(draft: { from: Sq; to: Sq } | null, from: Sq, legal: Sq[]): Sq[] {
  if (!draft || !same(from, draft.from)) return legal;
  return [...legal.filter((t) => !same(t, draft.to)), draft.from];
}

const CONFIRM_HOLD_MS = 400;

export function useSendMove(moves: number) {
  const [sending, setSending] = useState<{ move: string; moves: number; id: number } | null>(null);
  const seq = useRef(0);
  const send = async (move: string, action: () => Promise<unknown>) => {
    const id = ++seq.current;
    setSending({ move, moves, id });
    try {
      await Promise.all([action(), new Promise((r) => setTimeout(r, CONFIRM_HOLD_MS))]);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSending((s) => (s?.id === id ? null : s));
    }
  };
  return [sending && moves <= sending.moves + 1 ? sending.move : null, send] as const;
}

export function ConfirmMove({
  move,
  busy,
  onConfirm,
  onCancel,
}: {
  move: string;
  busy?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  return (
    <ActionRail className="grid-cols-[1fr_2fr] gap-2.5">
      <Button variant="card" size="dock" disabled={busy} onClick={onCancel}>
        <XIcon weight="bold" /> Cancel
      </Button>
      <Button
        className="h-[60px] gap-2.5 rounded-lg text-body [&_svg:not([class*='size-'])]:size-5"
        disabled={busy}
        aria-busy={busy}
        onClick={onConfirm}
      >
        {busy ? <SpinnerGapIcon weight="bold" className="animate-spin" /> : <CheckIcon weight="bold" />}
        Confirm <span className="min-w-0 truncate font-display text-heading">{move}</span>
      </Button>
    </ActionRail>
  );
}
