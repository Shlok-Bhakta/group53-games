import type { MatchView } from "../../../convex/matches";
import { settingsOf } from "../../../convex/modes";
import { bagLetters, type ScrabbleState, type Tile } from "../../../convex/scrabble/engine";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { LetterTile } from "./Tile";

// The bag: how many tiles are left, and which letters are still out there (in the bag or in other racks).
export function BagSheet({ open, onClose, match, state, rack }: { open: boolean; onClose: () => void; match: MatchView; state: ScrabbleState; rack: Tile[] | undefined }) {
  const all = bagLetters(settingsOf(match.mode, match.settings).bag);
  const unseen = new Map<string, number>();
  for (const l of all) unseen.set(l, (unseen.get(l) ?? 0) + 1);
  for (const t of state.tiles) {
    const k = t.blank ? "?" : t.letter;
    unseen.set(k, Math.max(0, (unseen.get(k) ?? 0) - 1));
  }
  for (const t of rack ?? []) unseen.set(t.letter, Math.max(0, (unseen.get(t.letter) ?? 0) - 1));
  const letters = [...unseen.keys()].sort((a, b) => (a === "?" ? 1 : b === "?" ? -1 : a.localeCompare(b)));
  const total = [...unseen.values()].reduce((a, b) => a + b, 0);
  return (
    <Sheet open={open} onClose={onClose} title={`${state.bag} in the bag`} bodyClassName="gap-3">
      <p className="text-center text-footnote text-muted-foreground">{total} letters you haven't seen, in the bag or in other racks</p>
      <ul className="grid grid-cols-6 gap-2" aria-label="Unseen letters">
        {letters.map((l) => {
          const n = unseen.get(l)!;
          return (
            <li key={l} className={cn("flex flex-col items-center gap-0.5", n === 0 && "opacity-30")} aria-label={`${l === "?" ? "Blank" : l}: ${n}`}>
              <LetterTile letter={l} size={40} />
              <span className="text-footnote font-semibold tabular-nums">×{n}</span>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
