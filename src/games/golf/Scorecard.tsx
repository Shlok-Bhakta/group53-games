import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { scoreName } from "../../../convex/golf/engine";
import { totals, vsPar, type GolfState } from "../../../convex/golf/round";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";

// The card: a row per hole with everyone's strokes, totals at the foot. Holes still to come show their par
// once they're built. Scrolls sideways with a big table.
export function Scorecard({ match, st, meId }: { match: MatchView; st: GolfState; meId: Id<"users"> | undefined }) {
  const seats = match.players.map((p, i) => ({ p, i }));
  const t = totals(st, match.players.length);
  const par = st.scores.reduce((a, _, n) => a + (st.holes[n]?.par ?? 0), 0);
  return (
    <div className="shrink-0 overflow-x-auto rounded-lg bg-muted/50" role="region" aria-label="Scorecard">
      <table className="w-full min-w-max border-collapse text-callout">
        <thead>
          <tr className="text-footnote text-muted-foreground">
            <th className="sticky left-0 bg-muted/50 px-2.5 py-2 text-left font-semibold">Hole</th>
            <th className="px-1.5 py-2 font-semibold">Par</th>
            {seats.map(({ p, i }) => (
              <th key={p.userId} className="px-1 py-2" aria-label={p.name}>
                <span className={cn("mx-auto block w-fit rounded-full p-0.5", st.out.includes(i) && "opacity-40")} style={{ boxShadow: `0 0 0 2px ${seatColor(p)}` }}>
                  <PlayerAvatar player={p} size={24} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {st.holes.map((h, n) => (
            <tr key={n} className={cn("border-t border-border/60", n === st.hole && "bg-primary/10")}>
              <td className="sticky left-0 max-w-[6.5rem] truncate bg-muted/50 px-2.5 py-2 font-display">
                {n + 1} <span className="text-footnote font-sans text-muted-foreground">{h?.name ?? ""}</span>
              </td>
              <td className="px-1.5 py-2 text-center text-muted-foreground">{h?.par ?? ""}</td>
              {seats.map(({ p, i }) => {
                const x = st.scores[n]?.[i];
                const under = x != null && h && x < h.par;
                return (
                  <td key={p.userId} className={cn("px-1 py-2 text-center font-display tabular-nums", under && "text-primary", p.userId === meId && "font-bold")} aria-label={x != null && h ? `${p.name}: ${x}, ${scoreName(x, h.par)}` : undefined}>
                    {x ?? (st.scores[n] ? "–" : "")}
                    {st.sunk[n] && x != null && !st.sunk[n][i] && <span className="text-caption text-muted-foreground">↑</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td className="sticky left-0 bg-muted/50 px-2.5 py-2 font-display">Total</td>
            <td className="px-1.5 py-2 text-center text-muted-foreground">{par || ""}</td>
            {seats.map(({ p, i }) => (
              <td key={p.userId} className="px-1 py-2 text-center font-display tabular-nums">
                <span className="block">{st.scores.length ? t[i] : ""}</span>
                {st.scores.length > 0 && <span className="block text-caption text-muted-foreground">{vsPar(t[i], par)}</span>}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
