import type { MatchView } from "../../../convex/matches";
import type { HandResult } from "../../../convex/poker/engine";
import { resultText } from "../../../convex/poker/text";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayingCard } from "@/components/ui/playing-card";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { chips } from "./format";

// The last hand in full: the board, everyone who showed and what they had, and who won what.
export function LastHand({ match, result, open, onClose }: { match: MatchView; result: HandResult; open: boolean; onClose: () => void }) {
  const rows = match.players
    .map((p, seat) => ({ p, seat, net: result.net[seat], shown: result.shown[seat], name: result.names[seat] }))
    .filter((r) => r.net !== 0 || r.shown)
    .sort((a, b) => b.net - a.net);
  return (
    <Sheet open={open} onClose={onClose} title={`Hand ${result.hand}`} closable>
      <p className="text-center text-callout text-muted-foreground">{resultText(result, (s) => match.players[s].name)}</p>
      {result.board.length > 0 && (
        <div role="group" className="poker-felt flex justify-center gap-1.5 rounded-lg py-3" aria-label="Board">
          {result.board.map((c) => (
            <PlayingCard key={c} card={c} width={40} />
          ))}
        </div>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card">
        {rows.map((r) => (
          <li key={r.seat} className="flex min-h-16 items-center gap-3 px-3 py-2">
            <PlayerAvatar player={r.p} glow={r.p.glow} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{r.p.name}</p>
              {r.name && <p className="text-footnote leading-tight text-muted-foreground">{r.name}</p>}
            </div>
            {r.shown && (
              <span className="flex gap-0.5">
                {r.shown.map((c) => (
                  <PlayingCard key={c} card={c} width={26} />
                ))}
              </span>
            )}
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-display text-footnote tabular-nums", r.net > 0 ? "bg-[var(--tile-green)] text-[var(--tile-ink)]" : "text-muted-foreground")}>
              {r.net > 0 ? "+" : r.net < 0 ? "−" : ""}
              {chips(Math.abs(r.net))}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
