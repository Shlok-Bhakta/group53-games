import { BOARD, BUYABLE } from "../../../convex/landlord/board";
import { worth, type MonoState } from "../../../convex/landlord/engine";
import { money } from "../../../convex/landlord/text";
import { settingsOf, type ModeKey } from "../../../convex/modes";
import type { MatchView } from "../../../convex/matches";
import { GameMenu } from "@/components/GameMenu";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ResignButton } from "@/components/match";
import { SectionTitle } from "@/components/parts";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { landlordRules } from "./rules";

// The menu: everyone with their cash, what they're worth and what they own, what's happened while you've been
// here, then what every game's menu has, and resigning at the very bottom.
export function LandlordMenu({ open, onOpenChange, match, state, mySeat, feed }: { open: boolean; onOpenChange: (o: boolean) => void; match: MatchView; state: MonoState; mySeat: number; feed: { key: number; text: string }[] }) {
  const playing = mySeat >= 0 && !state.players[mySeat]?.out && match.status === "active";
  return (
    <GameMenu
      open={open}
      onOpenChange={onOpenChange}
      match={match}
      title="Players"
      rules={landlordRules(match.mode as ModeKey, settingsOf(match.mode, match.settings))}
      footer={playing && <ResignButton match={match} className="h-14 w-full rounded-lg" detail="You go bankrupt to the bank: your properties are auctioned off and the others play on. You place last." />}
    >
      <ol className="flex flex-col gap-1.5" aria-label="Standings">
        {state.players
          .map((p, seat) => ({ p, seat, w: worth(state, seat) }))
          .sort((a, b) => Number(a.p.out) - Number(b.p.out) || b.w - a.w)
          .map(({ p, seat, w }) => (
            <li key={seat} className={cn("flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2", p.out && "opacity-50")}>
              <PlayerAvatar player={match.players[seat]} size={36} seat={seatColor(match.players[seat], p.out)} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {seat === mySeat ? "You" : match.players[seat].name}
                  {p.jail >= 0 && !p.out && <span className="font-normal text-muted-foreground"> · in jail</span>}
                </div>
                <Owned state={state} seat={seat} />
              </div>
              <div className="text-right">
                <div className="font-display text-callout tabular-nums">{p.out ? "Bankrupt" : money(p.cash)}</div>
                {!p.out && <div className="text-footnote text-muted-foreground tabular-nums">worth {money(w)}</div>}
              </div>
            </li>
          ))}
      </ol>
      {feed.length > 0 && (
        <section aria-label="What happened" className="pt-6">
          <SectionTitle className="pb-2">What happened</SectionTitle>
          <ol className="flex flex-col gap-1.5 text-callout">
            {[...feed]
              .reverse()
              .slice(0, 40)
              .map((f) => (
                <li key={f.key} className="rounded-md bg-muted/50 px-3 py-2">
                  {f.text}
                </li>
              ))}
          </ol>
        </section>
      )}
    </GameMenu>
  );
}

// What a player owns, as little swatches in board order.
function Owned({ state, seat }: { state: MonoState; seat: number }) {
  const props = BUYABLE.filter((i) => state.props[i]!.owner === seat);
  if (!props.length) return <div className="text-footnote text-muted-foreground">Nothing yet</div>;
  return (
    <div className="flex flex-wrap gap-0.5 pt-1" aria-label={`${props.length} properties`}>
      {props.map((i) => {
        const sq = BOARD[i];
        return <span key={i} className={cn("ll-swatch h-3 w-2 rounded-[2px]", state.props[i]!.mortgaged && "opacity-35")} data-group={sq.kind === "street" ? sq.group : undefined} style={sq.kind === "street" ? undefined : { background: "var(--muted-foreground)" }} />;
      })}
    </div>
  );
}

// A player, tapped from the dock: what they've got, and a trade with them.
export function PlayerSheet({ seat, onClose, match, state, mySeat, onDeed, onTrade }: { seat: number | null; onClose: () => void; match: MatchView; state: MonoState; mySeat: number; onDeed: (pos: number) => void; onTrade: (seat: number) => void }) {
  const p = seat === null ? null : state.players[seat];
  const player = seat === null ? null : match.players[seat];
  const props = seat === null ? [] : BUYABLE.filter((i) => state.props[i]!.owner === seat);
  return (
    <Sheet open={seat !== null} onClose={onClose} title={player ? (seat === mySeat ? "You" : player.name) : ""} closable>
      {p && player && seat !== null && (
        <>
          <div className="flex items-center gap-3">
            <PlayerAvatar player={player} size={56} seat={seatColor(player, p.out)} />
            <div>
              <div className="font-display text-title tabular-nums">{p.out ? "Bankrupt" : money(p.cash)}</div>
              <div className="text-footnote text-muted-foreground">
                worth {money(worth(state, seat))}
                {p.free.length > 0 && ` · ${p.free.length} get-out-of-jail card${p.free.length > 1 ? "s" : ""}`}
                {p.jail >= 0 && " · in jail"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {props.map((i) => {
              const sq = BOARD[i];
              const prop = state.props[i]!;
              return (
                <button key={i} type="button" onClick={() => onDeed(i)} className="flex min-h-11 touch-manipulation items-center gap-2 rounded-md bg-muted/60 px-2 text-left">
                  <span className="ll-swatch size-4 shrink-0 rounded-[3px]" data-group={sq.kind === "street" ? sq.group : undefined} style={sq.kind === "street" ? undefined : { background: "var(--muted-foreground)" }} />
                  <span className="min-w-0 flex-1 truncate text-callout">{sq.name}</span>
                  <span className="text-footnote text-muted-foreground">{prop.mortgaged ? "M" : prop.houses === 5 ? "H" : prop.houses || ""}</span>
                </button>
              );
            })}
          </div>
          {seat !== mySeat && mySeat >= 0 && !p.out && !state.players[mySeat].out && match.status === "active" && (
            <Button size="xl" variant="secondary" className="w-full" onClick={() => onTrade(seat)}>
              Trade with {player.name}
            </Button>
          )}
        </>
      )}
    </Sheet>
  );
}
