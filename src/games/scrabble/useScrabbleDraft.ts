import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import type { Placement, ScrabbleState, Tile } from "../../../convex/scrabble/engine";

export type Draft = { placed: Placement[]; order: number[] };
export const key = (x: number, y: number) => `${x},${y}`;

const NOTHING_PLANNED: Draft = { placed: [], order: [] };

export function useScrabbleDraft({
  match,
  state,
  mySeat,
  playing,
  rack,
}: {
  match: MatchView;
  state: ScrabbleState;
  mySeat: number;
  playing: boolean;
  rack: Tile[] | null | undefined;
}) {
  const serverDraft = useQuery(api.scrabble.draft, playing ? { id: match._id } : "skip");
  const saveDraft = useMutation(api.scrabble.saveDraft);

  const [draft, setDraft] = useState<Draft>(NOTHING_PLANNED);
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && playing && rack !== undefined && serverDraft !== undefined) {
    setHydrated(true);
    if (serverDraft) setDraft(serverDraft);
  }

  useEffect(() => {
    if (!hydrated || !playing || draft === NOTHING_PLANNED) return;
    const timer = setTimeout(() => void saveDraft({ id: match._id, placed: draft.placed, order: draft.order }).catch(() => {}), 120);
    return () => clearTimeout(timer);
  }, [draft, hydrated, playing, match._id, saveDraft]);

  const occupied = useMemo(() => new Set(state.tiles.map((t) => key(t.x, t.y))), [state.tiles]);
  const rackById = useMemo(() => new Map((rack ?? []).map((t) => [t.id, t])), [rack]);
  const placed = useMemo(
    () =>
      draft.placed.filter(
        (p, i, all) =>
          rackById.has(p.id) &&
          !occupied.has(key(p.x, p.y)) &&
          p.x < state.size &&
          p.y < state.size &&
          all.findIndex((q) => q.x === p.x && q.y === p.y) === i,
      ),
    [draft.placed, rackById, occupied, state.size],
  );
  const bumped = draft.placed.some((p) => rackById.has(p.id) && occupied.has(key(p.x, p.y)));
  const lastMover = state.moves.at(-1)?.seat;
  const [bumpedBy, setBumpedBy] = useState<{ who: string | null } | null>(null);
  if (bumped) {
    setBumpedBy({ who: lastMover !== undefined && lastMover !== mySeat ? (match.players[lastMover]?.name ?? null) : null });
    setDraft((d) => ({ ...d, placed: d.placed.filter((p) => !occupied.has(key(p.x, p.y))) }));
  }
  useEffect(() => {
    if (!bumpedBy) return;
    toast(
      bumpedBy.who
        ? `${bumpedBy.who} played where you'd planned. Those tiles are back in your rack.`
        : "Some planned tiles went back to your rack.",
    );
  }, [bumpedBy]);

  const inRack = useMemo(() => {
    const ids = (rack ?? []).map((t) => t.id);
    const order = [...draft.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !draft.order.includes(id))];
    return order.filter((id) => !placed.some((p) => p.id === id)).map((id) => rackById.get(id)!);
  }, [rack, draft.order, placed, rackById]);

  const setPlaced = (next: Placement[]) => setDraft((d) => ({ ...d, placed: next }));
  const setOrder = (order: number[]) => setDraft((d) => ({ ...d, order }));

  return { draft, setDraft, occupied, rackById, placed, inRack, setPlaced, setOrder };
}
