import { Sheet } from "@/components/ui/sheet";
import { LetterTile } from "./Tile";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Which letter a blank plays as.
export function BlankPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (letter: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Blank tile plays as" bodyClassName="grid grid-cols-7 gap-2">
      {[...ALPHABET].map((l) => (
        <button key={l} type="button" aria-label={l} onClick={() => onPick(l)} className="grid aspect-square touch-manipulation place-items-center rounded-sm transition-transform active:scale-[0.94]">
          <LetterTile letter={l} blank size={44} />
        </button>
      ))}
    </Sheet>
  );
}
