import { useState } from "react";
import { noHand } from "../../../convex/hexhaven/board";
import { bankOf, cantAccept, cantOffer, rateFor, type HexState, type Offer } from "../../../convex/hexhaven/engine";
import { handText, resName } from "../../../convex/hexhaven/text";
import type { MatchView } from "../../../convex/matches";
import { AsyncButton } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SectionTitle } from "@/components/parts";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { Counts, ResPicker, useHexMove } from "./parts";

export const offersFor = (s: HexState, seat: number) =>
  s.offers.filter((o) => o.from !== seat && (o.to === seat || (o.to < 0 && !o.no.includes(seat))));

export function TradeSheet({
  open,
  onClose,
  match,
  state,
  seat,
}: {
  open: boolean;
  onClose: () => void;
  match: MatchView;
  state: HexState;
  seat: number;
}) {
  const mine = state.current === seat;
  const toMe = offersFor(state, seat);
  const fromMe = state.offers.filter((o) => o.from === seat);
  const main = state.phase.k === "main";
  return (
    <Sheet open={open} onClose={onClose} title="Trade" closable>
      {toMe.map((o) => (
        <OfferCard key={o.id} o={o} state={state} match={match} seat={seat} />
      ))}
      {fromMe.map((o) => (
        <OfferCard key={o.id} o={o} state={state} match={match} seat={seat} />
      ))}
      {!main ? (
        <p className="py-2 text-center text-callout text-muted-foreground">Trading opens once {mine ? "you've" : "they've"} rolled.</p>
      ) : (
        <>
          {mine && <BankTrade match={match} state={state} seat={seat} />}
          <NewOffer match={match} state={state} seat={seat} />
        </>
      )}
    </Sheet>
  );
}

function OfferCard({ o, state, match, seat }: { o: Offer; state: HexState; match: MatchView; seat: number }) {
  const act = useHexMove(match._id, state.seq);
  const mine = o.from === seat;
  const them = match.players[mine ? o.to : o.from];
  const why = mine ? null : cantAccept(state, seat, o);
  return (
    <section
      data-offer={o.id}
      className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3"
      aria-label={mine ? "Your offer" : `${match.players[o.from].name}'s offer`}
    >
      <div className="flex items-center gap-2">
        {them ? <PlayerAvatar player={them} size={32} seat={seatColor(them)} /> : null}
        <span className="font-semibold">
          {mine ? (o.to >= 0 ? `You offered ${them.name}` : "You offered everyone") : `${match.players[o.from].name} offers`}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-callout">
        <dt className="text-muted-foreground">{mine ? "You give" : "You get"}</dt>
        <dd>{handText(o.give)}</dd>
        <dt className="text-muted-foreground">{mine ? "You get" : "You give"}</dt>
        <dd>{handText(o.get)}</dd>
      </dl>
      {mine ? (
        <AsyncButton variant="secondary" className="h-11 w-full" onClick={() => act({ k: "withdraw", id: o.id })}>
          Withdraw
        </AsyncButton>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <AsyncButton variant="secondary" className="h-11" onClick={() => act({ k: "reject", id: o.id })}>
              Decline
            </AsyncButton>
            <AsyncButton className="h-11" disabled={!!why} onClick={() => act({ k: "accept", id: o.id })}>
              Accept
            </AsyncButton>
          </div>
          {why && <p className="text-footnote text-muted-foreground">{why}</p>}
        </>
      )}
    </section>
  );
}

function BankTrade({ match, state, seat }: { match: MatchView; state: HexState; seat: number }) {
  const act = useHexMove(match._id, state.seq);
  const hand = state.players[seat].res;
  const bank = bankOf(state);
  const rates = hand.map((_, r) => rateFor(state, seat, r));
  const [give, setGive] = useState(() =>
    Math.max(
      0,
      rates.findIndex((n, r) => hand[r] >= n),
    ),
  );
  const [get, setGet] = useState(give === 0 ? 4 : 0);
  const n = rates[give];
  const why =
    hand[give] < n
      ? `You need ${n} ${resName(give)}.`
      : give === get
        ? "Pick something else to get."
        : bank[get] < 1
          ? "The bank's out of that."
          : null;
  return (
    <section className="flex flex-col gap-2" aria-label="Trade with the bank">
      <SectionTitle>With the bank</SectionTitle>
      <span className="px-1 text-footnote text-muted-foreground">Give</span>
      <ResPicker label="Give the bank" value={give} onChange={setGive} note={(r) => `${rates[r]}:1`} />
      <span className="px-1 text-footnote text-muted-foreground">Get</span>
      <ResPicker label="Get from the bank" value={get} onChange={setGet} disabled={(r) => r === give} />
      <AsyncButton size="xl" className="w-full" disabled={!!why} onClick={() => act({ k: "bank", give, get })}>
        {`Trade ${n} ${resName(give)} for 1 ${resName(get)}`}
      </AsyncButton>
      {why && <p className="text-center text-footnote text-muted-foreground">{why}</p>}
    </section>
  );
}

function NewOffer({ match, state, seat }: { match: MatchView; state: HexState; seat: number }) {
  const act = useHexMove(match._id, state.seq);
  const mine = state.current === seat;
  const others = state.players.flatMap((p, i) => (i !== seat && !p.out ? [i] : []));
  const [to, setTo] = useState(mine ? -1 : state.current);
  const [give, setGive] = useState(noHand);
  const [get, setGet] = useState(noHand);
  const partner = mine ? to : state.current;
  const why = cantOffer(state, seat, partner, give, get);
  const name = (i: number) => match.players[i]?.name ?? "Someone";
  return (
    <section className="flex flex-col gap-2" aria-label="New offer">
      <SectionTitle>{mine ? "With the others" : `With ${name(state.current)}`}</SectionTitle>
      {mine && (
        <div className="-mx-1 flex gap-2 overflow-x-auto p-1" role="radiogroup" aria-label="Offer to">
          {[-1, ...others].map((i) => (
            <Button
              key={i}
              variant="bare"
              size="chip"
              role="radio"
              aria-checked={to === i}
              onClick={() => setTo(i)}
              className={cn(
                "shrink-0 gap-2 rounded-full py-1 pr-3 transition-colors duration-150",
                i < 0 ? "pl-3" : "pl-1",
                to === i ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {i >= 0 && <PlayerAvatar player={match.players[i]} size={32} seat={seatColor(match.players[i])} />}
              <span className="font-semibold">{i < 0 ? "Anyone" : name(i)}</span>
            </Button>
          ))}
        </div>
      )}
      <span className="px-1 text-footnote text-muted-foreground">You give</span>
      <Counts label="You give" value={give} max={state.players[seat].res} onChange={setGive} />
      <span className="px-1 text-footnote text-muted-foreground">You get</span>
      <Counts label="You get" value={get} onChange={setGet} />
      <AsyncButton
        size="xl"
        className="w-full"
        disabled={!!why}
        onClick={() =>
          act({ k: "offer", to: partner, give, get }).then(() => {
            setGive(noHand());
            setGet(noHand());
          })
        }
      >
        {partner < 0 ? "Offer to everyone" : `Send to ${name(partner)}`}
      </AsyncButton>
      {why && (give.some((n) => n) || get.some((n) => n)) ? <p className="text-center text-footnote text-muted-foreground">{why}</p> : null}
    </section>
  );
}
