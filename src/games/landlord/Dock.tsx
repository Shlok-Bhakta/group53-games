import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BuildingsIcon, HandshakeIcon } from "@phosphor-icons/react";
import { BOARD, JAIL_FINE, priceOf } from "../../../convex/landlord/board";
import { actor, raisable, type MonoState } from "../../../convex/landlord/engine";
import { money, squareName } from "../../../convex/landlord/text";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MatchView } from "../../../convex/matches";
import { AmountSheet } from "@/components/AmountSheet";
import { AsyncButton } from "@/components/AsyncButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Result } from "@/components/match";
import { Button } from "@/components/ui/button";
import { DockNote } from "@/components/game/GameFrame";
import { seatColor } from "@/games/seats";
import { cn } from "@/lib/utils";
import { useLandlordMove } from "./Deed";
import type { Float } from "./show";

// The dock: everyone's cash along the top, then whatever's yours to do (roll, buy, bid, pay up), with your
// properties and trading always a tap away. It only offers a move once the show has caught up.

export function Dock({
  match,
  meId,
  state,
  mySeat,
  busy,
  catching,
  floats,
  onSkip,
  onPlayer,
  onHoldings,
  onTrade,
  over,
}: {
  match: MatchView;
  meId: Id<"users"> | undefined;
  state: MonoState;
  mySeat: number;
  busy: boolean;
  catching: boolean;
  floats: Float[];
  onSkip: () => void;
  onPlayer: (seat: number) => void;
  onHoldings: () => void;
  onTrade: () => void;
  over: boolean;
}) {
  const me = mySeat >= 0 ? state.players[mySeat] : undefined;
  const offers = state.trades.filter((t) => t.to === mySeat).length;
  const tools = me && !me.out && (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="secondary" className="h-11" onClick={onHoldings}>
        <BuildingsIcon weight="bold" /> Properties
      </Button>
      <Button variant="secondary" className="relative h-11" onClick={onTrade}>
        <HandshakeIcon weight="bold" /> Trade
        {offers > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-caption font-bold text-primary-foreground">{offers}</span>}
      </Button>
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <Players match={match} state={state} floats={floats} onPlayer={onPlayer} />
      {over ? (
        <Result match={match} meId={meId} />
      ) : (
        <>
          <div className="min-h-[60px]">
            {catching ? (
              <Button size="xl" variant="secondary" className="h-[60px] w-full" onClick={onSkip}>
                Skip to now
              </Button>
            ) : busy ? (
              <div className="h-[60px]" />
            ) : !me ? (
              <DockNote>You're watching.</DockNote>
            ) : me.out ? (
              <DockNote>You're bankrupt. Stick around to see who wins.</DockNote>
            ) : (
              <Actions match={match} state={state} seat={mySeat} onHoldings={onHoldings} />
            )}
          </div>
          {tools}
        </>
      )}
    </div>
  );
}

// Everyone, in turn order: face, cash (money changing hands floats off it), and who's up.
function Players({ match, state, floats, onPlayer }: { match: MatchView; state: MonoState; floats: Float[]; onPlayer: (seat: number) => void }) {
  const up = state.phase.k === "over" ? -1 : actor(state);
  return (
    <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pt-4" aria-label="Players">
      {state.players.map((p, seat) => {
        const player = match.players[seat];
        return (
          <button
            key={seat}
            type="button"
            onClick={() => onPlayer(seat)}
            className={cn("relative flex min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-full py-1 pl-1 pr-3 transition-colors", seat === up ? "bg-primary/15" : "bg-muted/60", p.out && "opacity-45")}
            aria-label={`${player.name}: ${p.out ? "bankrupt" : money(p.cash)}`}
            data-seat={seat}
          >
            <PlayerAvatar player={player} size={30} seat={seatColor(player, p.out)} />
            <span className="font-display text-callout tabular-nums">{p.out ? "Out" : money(p.cash)}</span>
            <AnimatePresence>
              {floats
                .filter((f) => f.seat === seat)
                .map((f) => (
                  <motion.span
                    key={f.key}
                    className={cn("pointer-events-none absolute -top-3 right-2 font-display text-callout font-bold tabular-nums", f.amount > 0 ? "text-[var(--up)]" : "text-[var(--down)]")}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: -6 }}
                    exit={{ opacity: 0, y: -16 }}
                    transition={{ duration: 0.4 }}
                  >
                    {f.amount > 0 ? "+" : "−"}
                    {money(Math.abs(f.amount))}
                  </motion.span>
                ))}
            </AnimatePresence>
          </button>
        );
      })}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex h-[60px] gap-2 [&>*]:h-full [&>*]:flex-1">{children}</div>;
}

// What's yours to do right now, if anything.
function Actions({ match, state, seat, onHoldings }: { match: MatchView; state: MonoState; seat: number; onHoldings: () => void }) {
  const act = useLandlordMove(match._id);
  const [bidOpen, setBidOpen] = useState(false);
  const p = state.players[seat];
  const ph = state.phase;
  const mine = seat === state.current;
  const waitingOn = ph.k === "over" ? -1 : actor(state);
  const name = (i: number) => match.players[i]?.name ?? "Someone";
  if (ph.k === "debt" && ph.from === seat) {
    const short = ph.amount - p.cash;
    const to = ph.to >= 0 ? name(ph.to) : "the bank";
    return (
      <Row>
        {short > 0 ? (
          <Button size="xl" onClick={onHoldings} className="flex-col gap-0 leading-tight">
            <span>Raise {money(short)}</span>
            <span className="text-footnote font-normal opacity-80">You owe {to} {money(ph.amount)}</span>
          </Button>
        ) : (
          <AsyncButton size="xl" onClick={() => act({ k: "pay" })}>
            Pay {to} {money(ph.amount)}
          </AsyncButton>
        )}
        {short > 0 && raisable(state, seat) < short && (
          <ConfirmButton
            trigger={
              <Button size="xl" variant="secondary" className="max-w-[40%] text-destructive">
                Bankrupt
              </Button>
            }
            title="Go bankrupt?"
            detail={`Selling and mortgaging everything can't cover it. Everything you have goes to ${ph.to >= 0 ? to : "the bank"} and you're out.`}
            keep="Keep trying"
            confirm="Go bankrupt"
            onConfirm={() => act({ k: "bankrupt" })}
          />
        )}
      </Row>
    );
  }
  if (ph.k === "auction" && ph.in.includes(seat)) {
    const leading = ph.leader === seat;
    const next = ph.high + 10;
    return (
      <>
        <Row>
          {leading ? (
            <DockNote className="h-full">You lead at {money(ph.high)}. Waiting on the others.</DockNote>
          ) : (
            <>
              <AsyncButton size="xl" variant="secondary" className="max-w-[34%]" onClick={() => act({ k: "fold" })}>
                Drop out
              </AsyncButton>
              <Button size="xl" variant="secondary" className="max-w-[28%]" onClick={() => setBidOpen(true)} disabled={p.cash <= ph.high}>
                Bid…
              </Button>
              <AsyncButton size="xl" disabled={p.cash < next} onClick={() => act({ k: "bid", amount: next })} className="flex-col gap-0 leading-tight">
                <span>Bid {money(next)}</span>
                <span className="text-footnote font-normal opacity-80">{ph.leader >= 0 ? `${name(ph.leader)} has ${money(ph.high)}` : squareName(ph.pos)}</span>
              </AsyncButton>
            </>
          )}
        </Row>
        <BidSheet open={bidOpen} onClose={() => setBidOpen(false)} pos={ph.pos} high={ph.high} cash={p.cash} onBid={(amount) => act({ k: "bid", amount })} />
      </>
    );
  }
  if (mine && ph.k === "roll") {
    if (p.jail >= 0)
      return (
        <Row>
          {p.free.length > 0 && (
            <AsyncButton size="xl" variant="secondary" onClick={() => act({ k: "cardJail" })}>
              Use card
            </AsyncButton>
          )}
          <AsyncButton size="xl" variant="secondary" disabled={p.cash < JAIL_FINE} onClick={() => act({ k: "payJail" })}>
            Pay {money(JAIL_FINE)}
          </AsyncButton>
          <AsyncButton size="xl" onClick={() => act({ k: "roll" })} className="flex-col gap-0 leading-tight">
            <span>Roll</span>
            <span className="text-footnote font-normal opacity-80">{p.jail === 2 ? "Last try" : "Doubles gets you out"}</span>
          </AsyncButton>
        </Row>
      );
    return (
      <Row>
        <AsyncButton size="xl" onClick={() => act({ k: "roll" })}>
          {state.again ? "Roll again" : "Roll"}
        </AsyncButton>
      </Row>
    );
  }
  if (mine && ph.k === "buy") {
    const price = priceOf(ph.pos);
    return (
      <Row>
        <AsyncButton size="xl" variant="secondary" className="max-w-[40%]" onClick={() => act({ k: "decline" })}>
          {state.rules.auctions ? "Auction it" : "Pass"}
        </AsyncButton>
        {p.cash >= price ? (
          <AsyncButton size="xl" onClick={() => act({ k: "buy" })} className="flex-col gap-0 leading-tight">
            <span>Buy for {money(price)}</span>
            <span className="text-footnote font-normal opacity-80">{BOARD[ph.pos].name}</span>
          </AsyncButton>
        ) : (
          <Button size="xl" onClick={onHoldings} className="flex-col gap-0 leading-tight">
            <span>Raise {money(price - p.cash)} to buy</span>
            <span className="text-footnote font-normal opacity-80">It costs {money(price)}</span>
          </Button>
        )}
      </Row>
    );
  }
  if (mine && ph.k === "bus") {
    const [a, b] = ph.dice;
    return (
      <Row>
        <AsyncButton size="xl" variant="secondary" onClick={() => act({ k: "bus", choice: 0 })}>
          Move {a}
        </AsyncButton>
        <AsyncButton size="xl" variant="secondary" onClick={() => act({ k: "bus", choice: 1 })}>
          Move {b}
        </AsyncButton>
        <AsyncButton size="xl" onClick={() => act({ k: "bus", choice: 2 })}>
          Move {a + b}
        </AsyncButton>
      </Row>
    );
  }
  if (mine && ph.k === "pick") return <DockNote className="text-foreground">Triples! Tap any square to go there.</DockNote>;
  const who = waitingOn >= 0 ? name(waitingOn) : "";
  const doing =
    ph.k === "auction" ? `Auction for ${squareName(ph.pos)}: waiting on ${who}`
    : ph.k === "debt" ? `${who} is raising ${money(ph.amount)}`
    : ph.k === "buy" ? `${who} is deciding on ${squareName(ph.pos)}`
    : `${who}'s turn`;
  return <DockNote>{doing}</DockNote>;
}

function BidSheet({ open, onClose, pos, high, cash, onBid }: { open: boolean; onClose: () => void; pos: number; high: number; cash: number; onBid: (amount: number) => Promise<unknown> }) {
  const min = high + 1;
  const [value, setValue] = useState(Math.min(cash, Math.max(min, priceOf(pos))));
  const v = Math.min(cash, Math.max(min, value));
  return (
    <AmountSheet
      open={open}
      onClose={onClose}
      title={`Bid on ${squareName(pos)}`}
      value={v}
      onChange={setValue}
      min={Math.min(min, cash)}
      max={cash}
      step={5}
      presets={[
        { label: `+${money(10)}`, value: Math.min(cash, high + 10) },
        { label: `+${money(50)}`, value: Math.min(cash, high + 50) },
        { label: "Price", value: Math.min(cash, Math.max(min, priceOf(pos))) },
        { label: "All in", value: cash },
      ]}
      display={money(v)}
      detail={`It's listed at ${money(priceOf(pos))}`}
      confirm={`Bid ${money(v)}`}
      onConfirm={async () => {
        await onBid(v);
        onClose();
      }}
    />
  );
}
