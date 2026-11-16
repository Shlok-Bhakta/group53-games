import { useId, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { BOARD, BUYABLE, groupOf, unmortgageOf } from "../../../convex/landlord/board";
import { cantAccept, cantTrade, feesOn, type Deck, type MonoState, type Side, type Trade } from "../../../convex/landlord/engine";
import { money, sideText } from "../../../convex/landlord/text";
import type { MatchView } from "../../../convex/matches";
import { AsyncButton } from "@/components/AsyncButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Group, SectionTitle } from "@/components/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { useLandlordMove } from "./Deed";

const empty = (): Side => ({ cash: 0, props: [], free: [] });
export type TradeStart = { with?: number; want?: number; counter?: Trade };
type Draft = { partner: number; give: Side; get: Side };

function draftFor(start: TradeStart, others: number[]): Draft {
  if (start.counter) return { partner: start.counter.from, give: { ...start.counter.get }, get: { ...start.counter.give } };
  return {
    partner: start.with ?? others[0] ?? -1,
    give: empty(),
    get: start.want !== undefined ? { ...empty(), props: [start.want] } : empty(),
  };
}

export function TradeSheet({
  open,
  start,
  onClose,
  match,
  state,
  seat,
}: {
  open: boolean;
  start: TradeStart;
  onClose: () => void;
  match: MatchView;
  state: MonoState;
  seat: number;
}) {
  const act = useLandlordMove(match._id);
  const others = state.players.flatMap((p, i) => (i !== seat && !p.out ? [i] : []));
  const [draft, setDraft] = useState<Draft>(() => ({ partner: others[0] ?? -1, give: empty(), get: empty() }));
  const [lift, setLift] = useState<number[]>([]);
  const [openedWith, setOpenedWith] = useState<TradeStart | null>(null);
  if (open && openedWith !== start) {
    setOpenedWith(start);
    setDraft(draftFor(start, others));
    setLift([]);
  }
  const { partner, give, get } = draft;
  const setGive = (side: Side) => setDraft((d) => ({ ...d, give: side }));
  const setGet = (side: Side) => setDraft((d) => ({ ...d, get: side }));
  const toMe = state.trades.filter((t) => t.to === seat);
  const fromMe = state.trades.filter((t) => t.from === seat);
  const offer = { from: seat, to: partner, give, get };
  const why = partner >= 0 ? cantTrade(state, offer) : "Nobody left to trade with.";
  const name = (i: number) => match.players[i]?.name ?? "Someone";
  return (
    <Sheet open={open} onClose={onClose} title="Trade" closable>
      {toMe.map((t) => (
        <Offer key={t.id} t={t} state={state} match={match} mine={false} onCounter={() => setDraft(draftFor({ counter: t }, others))} />
      ))}
      {fromMe.map((t) => (
        <Offer key={t.id} t={t} state={state} match={match} mine />
      ))}
      {others.length > 0 && (
        <>
          <SectionTitle>New offer</SectionTitle>
          <div className="-mx-1 flex shrink-0 gap-2 overflow-x-auto p-1" role="radiogroup" aria-label="Trade with">
            {others.map((i) => (
              <Button
                key={i}
                variant="bare"
                size="chip"
                role="radio"
                aria-checked={partner === i}
                onClick={() => setDraft((d) => ({ ...d, partner: i, get: empty() }))}
                className={cn(
                  "shrink-0 gap-2 rounded-full py-1 pl-1 pr-3 transition-colors duration-150",
                  partner === i ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                <PlayerAvatar player={match.players[i]} size={32} seat={seatColor(match.players[i])} />
                <span className="font-semibold">{name(i)}</span>
              </Button>
            ))}
          </div>
          {partner >= 0 && (
            <>
              <Stuff title="You give" state={state} seat={seat} side={give} onChange={setGive} />
              <Stuff title={`${name(partner)} gives`} state={state} seat={partner} side={get} onChange={setGet} />
              <Lifts state={state} props={get.props} lift={lift} onChange={setLift} />
              <AsyncButton
                size="xl"
                className="w-full"
                disabled={!!why}
                onClick={async () => {
                  await act({ k: "offer", to: partner, give, get, lift: lift.filter((p) => get.props.includes(p)) });
                  setDraft((d) => ({ ...d, give: empty(), get: empty() }));
                  setLift([]);
                }}
              >
                Send to {name(partner)}
              </AsyncButton>
              {why && (give.cash || give.props.length || get.cash || get.props.length) ? (
                <p className="text-center text-footnote text-muted-foreground">{why}</p>
              ) : null}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

export function Offer({
  t,
  state,
  match,
  mine,
  onCounter,
}: {
  t: Trade;
  state: MonoState;
  match: MatchView;
  mine: boolean;
  onCounter?: () => void;
}) {
  const act = useLandlordMove(match._id);
  const them = match.players[mine ? t.to : t.from];
  const [lift, setLift] = useState<number[]>([]);
  const why = mine ? null : cantAccept(state, t, lift);
  return (
    <section
      className="flex flex-col gap-3 rounded-lg bg-card p-3"
      aria-label={mine ? `Your offer to ${them.name}` : `${them.name}'s offer`}
    >
      <div className="flex items-center gap-2">
        <PlayerAvatar player={them} size={32} seat={seatColor(them)} />
        <span className="font-semibold">{mine ? `You offered ${them.name}` : `${them.name} offers`}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-callout">
        <dt className="text-muted-foreground">{mine ? "You give" : "You get"}</dt>
        <dd>{sideText(t.give)}</dd>
        <dt className="text-muted-foreground">{mine ? "You get" : "You give"}</dt>
        <dd>{sideText(t.get)}</dd>
      </dl>
      {!mine && <Lifts state={state} props={t.give.props} lift={lift} onChange={setLift} />}
      {mine ? (
        <AsyncButton variant="secondary" className="h-11 w-full" onClick={() => act({ k: "withdraw", id: t.id })}>
          Withdraw
        </AsyncButton>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <AsyncButton variant="secondary" className="h-11" onClick={() => act({ k: "reject", id: t.id })}>
              Decline
            </AsyncButton>
            <AsyncButton variant="secondary" className="h-11" onClick={async () => onCounter?.()}>
              Counter
            </AsyncButton>
            <AsyncButton className="h-11" disabled={!!why} onClick={() => act({ k: "accept", id: t.id, lift })}>
              Accept
            </AsyncButton>
          </div>
          {why && <p className="text-footnote text-muted-foreground">{why}</p>}
        </>
      )}
    </section>
  );
}

function Lifts({ state, props, lift, onChange }: { state: MonoState; props: number[]; lift: number[]; onChange: (l: number[]) => void }) {
  const mortgaged = props.filter((i) => state.props[i]!.mortgaged);
  if (!mortgaged.length) return null;
  const fees = feesOn(state, mortgaged, lift);
  return (
    <div className="flex flex-col gap-1">
      {mortgaged.map((i) => {
        const on = lift.includes(i);
        return (
          <Button
            key={i}
            variant="bare"
            size="chip"
            aria-pressed={on}
            onClick={() => onChange(on ? lift.filter((x) => x !== i) : [...lift, i])}
            className="gap-3 rounded-md bg-muted/60 px-3 text-callout"
          >
            <span className="min-w-0 flex-1">
              Lift {BOARD[i].name}'s mortgage now ({money(unmortgageOf(i))})
            </span>
            <span className={cn("grid size-6 place-items-center rounded-full", on ? "bg-primary text-primary-foreground" : "bg-card")}>
              {on && <CheckIcon weight="bold" size={14} />}
            </span>
          </Button>
        );
      })}
      <p className="px-1 text-footnote text-muted-foreground">You'd pay the bank {money(fees.total)} for the mortgaged ones.</p>
    </div>
  );
}

function Stuff({
  title,
  state,
  seat,
  side,
  onChange,
}: {
  title: string;
  state: MonoState;
  seat: number;
  side: Side;
  onChange: (s: Side) => void;
}) {
  const p = state.players[seat];
  const props = BUYABLE.filter((i) => state.props[i]!.owner === seat);
  const built = (i: number) => groupOf(i).some((j) => state.props[j]!.houses > 0);
  const toggle = (i: number) =>
    onChange({ ...side, props: side.props.includes(i) ? side.props.filter((x) => x !== i) : [...side.props, i] });
  const cashId = useId();
  const cards = (["chance", "chest"] as Deck[]).flatMap((d) => p.free.filter((x) => x === d));
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-baseline justify-between px-1">
        <span className="font-semibold">{title}</span>
        <span className="text-footnote text-muted-foreground tabular-nums">{money(p.cash)} cash</span>
      </div>
      <Group>
        {props.map((i) => {
          const sq = BOARD[i];
          const on = side.props.includes(i);
          return (
            <Button
              key={i}
              variant="bare"
              size="chip"
              disabled={built(i)}
              aria-pressed={on}
              onClick={() => toggle(i)}
              className="min-h-12 w-full gap-3 px-3"
            >
              <span
                className="ll-swatch size-6 shrink-0 rounded-sm"
                data-group={sq.kind === "street" ? sq.group : undefined}
                style={sq.kind === "street" ? undefined : { background: "var(--muted)" }}
              />
              <span className="min-w-0 flex-1 truncate">
                {sq.name}
                {state.props[i]!.mortgaged && <span className="text-muted-foreground"> · mortgaged</span>}
                {built(i) && <span className="text-muted-foreground"> · sell the buildings first</span>}
              </span>
              <span className={cn("grid size-6 place-items-center rounded-full", on ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {on && <CheckIcon weight="bold" size={14} />}
              </span>
            </Button>
          );
        })}
        {cards.map((d, k) => {
          const on = side.free.filter((x) => x === d).length > cards.slice(0, k).filter((x) => x === d).length;
          return (
            <Button
              key={`${d}${k}`}
              variant="bare"
              size="chip"
              aria-pressed={on}
              onClick={() => onChange({ ...side, free: on ? side.free.filter((_, j) => j !== side.free.indexOf(d)) : [...side.free, d] })}
              className="min-h-12 w-full gap-3 px-3"
            >
              <span className="min-w-0 flex-1">Get-out-of-jail card</span>
              <span className={cn("grid size-6 place-items-center rounded-full", on ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {on && <CheckIcon weight="bold" size={14} />}
              </span>
            </Button>
          );
        })}
        <label htmlFor={cashId} className="flex min-h-12 items-center gap-3 px-3">
          <span className="flex-1">Cash</span>
          <Input
            id={cashId}
            inputMode="numeric"
            className="h-10 w-32 text-right tabular-nums"
            value={side.cash ? String(side.cash) : ""}
            placeholder="$0"
            onChange={(e) => onChange({ ...side, cash: Math.max(0, Math.floor(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)) })}
            aria-label={`${title}: cash`}
          />
        </label>
      </Group>
    </section>
  );
}
