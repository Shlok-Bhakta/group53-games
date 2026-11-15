import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { LetterTile } from "./Tile";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function BlankPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (letter: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Blank tile plays as" bodyClassName="grid grid-cols-7 gap-2">
      {[...ALPHABET].map((l) => (
        <Button
          key={l}
          variant="bare"
          size="choice"
          aria-label={l}
          onClick={() => onPick(l)}
          className="aspect-square rounded-sm active:scale-[0.94]"
        >
          <LetterTile letter={l} blank size={44} />
        </Button>
      ))}
    </Sheet>
  );
}
