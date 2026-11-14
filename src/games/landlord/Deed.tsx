import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { BOARD, groupOf, houseCostOf, mortgageOf, unmortgageOf, type Square } from "../../../convex/landlord/board";
import { cantBuild, cantMortgage, cantSell, cantUnmortgage, hotelAt, ownsGroup, rentOf, type Action, type MonoState } from "../../../convex/landlord/engine";
import { money } from "../../../convex/landlord/text";
import type { MatchView } from "../../../convex/matches";
import { AsyncButton } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";

// A square's deed: what it costs, what it charges at each stage (the one it's at now lit up), who owns it.
// On your own: build, sell, mortgage and lift the mortgage, each saying why not when it can't.

export function useLandlordMove(id: MatchView["_id"]) {
  const move = useMutation(api.landlord.move);
  // Resigning goes through the shared matches.resign.
  return (action: Exclude<Action, { k: "resign" }>) => move({ id, action });
}

export function DeedSheet({ pos, onClose, match, state, mySeat, busy, onTrade }: { pos: number | null; onClose: () => void; match: MatchView; state: MonoState; mySeat: number; busy: boolean; onTrade: (seat: number, pos: number) => void }) {
  const sq = pos === null ? null : BOARD[pos];
  return (
    <Sheet open={pos !== null} onClose={onClose} title={sq?.name ?? ""} closable>
      {pos !== null && sq && <DeedBody pos={pos} sq={sq} match={match} state={state} mySeat={mySeat} busy={busy} onTrade={onTrade} />}
    </Sheet>
  );
}

function DeedBody({ pos, sq, match, state, mySeat, busy, onTrade }: { pos: number; sq: Square; match: MatchView; state: MonoState; mySeat: number; busy: boolean; onTrade: (seat: number, pos: number) => void }) {
  const act = useLandlordMove(match._id);
  const prop = state.props[pos];
  const owner = prop && prop.owner >= 0 ? match.players[prop.owner] : undefined;
  const mine = prop?.owner === mySeat && mySeat >= 0;
  if (!prop || !("price" in sq)) return <p className="text-callout text-muted-foreground">{about(sq)}</p>;
  const rows = rentRows(sq, state, pos);
  const top = hotelAt(state.rules);
  // Only asked of your own: a spectator's seat (-1) is the bank's too.
  const why = mine ? { build: cantBuild(state, mySeat, pos), sell: cantSell(state, mySeat, pos), mortgage: cantMortgage(state, mySeat, pos), lift: cantUnmortgage(state, mySeat, pos) } : null;
  return (
    <>
      <div className="flex items-center gap-3">
        {sq.kind === "street" && <span className="ll-swatch size-10 shrink-0 rounded-sm" data-group={sq.group} />}
        <div className="min-w-0 flex-1">
          <div className="text-callout text-muted-foreground">
            {money(sq.price)} · mortgage {money(mortgageOf(pos))}
            {sq.kind === "street" && ` · houses ${money(sq.house)}`}
          </div>
          {owner ? (
            <div className="flex items-center gap-2 pt-1 font-semibold">
              <PlayerAvatar player={owner} size={24} seat={seatColor(owner)} /> {mine ? "Yours" : owner.name}
              {prop.mortgaged && <span className="text-footnote font-normal text-muted-foreground">· mortgaged</span>}
            </div>
          ) : (
            <div className="pt-1 font-semibold">For sale</div>
          )}
        </div>
      </div>
      <ol className="flex flex-col overflow-hidden rounded-lg bg-muted/50" aria-label="Rent">
        {rows.map((r) => (
          <li key={r.label} className={cn("flex min-h-11 items-center justify-between px-3 text-callout", r.now && "bg-primary/12 font-semibold text-primary")}>
            <span>{r.label}</span>
            <span className="tabular-nums">{r.value}</span>
          </li>
        ))}
      </ol>
      {mine && (
        <div className="grid grid-cols-2 gap-2">
          {sq.kind === "street" && (
            <>
              <Act label={prop.houses === top ? `Hotel ${money(houseCostOf(pos))}` : `House ${money(houseCostOf(pos))}`} why={why!.build} disabled={busy} onClick={() => act({ k: "build", pos })} />
              <Act label={`Sell one +${money(houseCostOf(pos) / 2)}`} why={why!.sell} disabled={busy} onClick={() => act({ k: "sell", pos })} secondary />
            </>
          )}
          {prop.mortgaged ? (
            <Act label={`Lift mortgage ${money(unmortgageOf(pos))}`} why={why!.lift} disabled={busy} onClick={() => act({ k: "unmortgage", pos })} wide />
          ) : (
            <Act label={`Mortgage +${money(mortgageOf(pos))}`} why={why!.mortgage} disabled={busy} onClick={() => act({ k: "mortgage", pos })} secondary wide />
          )}
        </div>
      )}
      {owner && !mine && mySeat >= 0 && !state.players[mySeat].out && (
        <Button variant="secondary" size="xl" className="w-full" onClick={() => onTrade(prop.owner, pos)}>
          Ask {owner.name} for it
        </Button>
      )}
    </>
  );
}

function Act({ label, why, onClick, disabled, secondary, wide }: { label: string; why: string | null; onClick: () => Promise<unknown>; disabled?: boolean; secondary?: boolean; wide?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", wide && "col-span-2")}>
      <AsyncButton size="xl" variant={secondary ? "secondary" : "default"} className="w-full" disabled={!!why || disabled} onClick={onClick}>
        {label}
      </AsyncButton>
      {why && <p className="px-1 text-footnote text-muted-foreground">{why}</p>}
    </div>
  );
}

function rentRows(sq: Square, state: MonoState, pos: number) {
  const prop = state.props[pos]!;
  const live = prop.owner >= 0 && !prop.mortgaged;
  if (sq.kind === "street") {
    const full = live && ownsGroup(state, prop.owner, pos);
    const h = prop.houses;
    const rows = [
      { label: "Rent", value: money(sq.rent[0]), now: live && h === 0 && !full },
      { label: "With the whole group", value: money(sq.rent[0] * 2), now: full && h === 0 },
    ];
    for (let i = 1; i <= hotelAt(state.rules); i++) rows.push({ label: `${i} house${i > 1 ? "s" : ""}`, value: money(sq.rent[i]), now: live && h === i });
    rows.push({ label: "Hotel", value: money(sq.rent[5]), now: live && h === 5 });
    return rows;
  }
  const n = prop.owner >= 0 ? groupOf(pos).filter((i) => state.props[i]!.owner === prop.owner).length : 0;
  if (sq.kind === "rail") return [1, 2, 3, 4].map((k) => ({ label: `${k} station${k > 1 ? "s" : ""}`, value: money(25 * 2 ** (k - 1)), now: live && n === k }));
  return [
    { label: "1 utility", value: "4 × the roll", now: live && n === 1 },
    { label: "Both", value: "10 × the roll", now: live && n === 2 },
  ].map((r) => ({ ...r, value: r.value + (r.now ? ` (${money(rentOf(state, pos, 7))} on a 7)` : "") }));
}

function about(sq: Square) {
  switch (sq.kind) {
    case "go":
      return "Collect $200 every time you pass.";
    case "jail":
      return "Just visiting, unless you were sent here. Get out with doubles, $50 or a card; after three tries you pay and go.";
    case "parking":
      return "Nothing happens here, unless you're playing with the jackpot.";
    case "gotojail":
      return "Straight to jail, without passing Start.";
    case "tax":
      return `Pay ${money(sq.amount)}.`;
    case "chance":
    case "chest":
      return `Draw a ${sq.name} card.`;
    default:
      return "";
  }
}
