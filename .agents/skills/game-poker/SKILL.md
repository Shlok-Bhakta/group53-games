---
name: game-poker
description: The poker package's feature map. Use for any poker work: its four modes (Hold'em, Omaha, Short Deck, 5-Card Draw) and settings, the engine (blinds, betting, min-raise, pot limit, side pots, the draw, busts, standings), hand ranking, secrets, lined-up moves, pushes, the table screen and its show (useShow, PACE), cards and chips, landscape, its link preview and its tests.
---

# Poker

AGENTS.md is the overview and the `framework` skill covers matches, turns, pushes and the harness. This is what you need on top of them to change poker.

## Modes

Four async modes, all `game: "poker"`, defined in `convex/poker/modes.ts` (`POKER_GAME`, `POKER_MODES`). `minPlayers` 2, so the host taps Start (or a full table starts itself).

| Mode | Title | Seats | Variant | Default betting |
| --- | --- | --- | --- | --- |
| `poker:holdem` "Hold'em" | Texas Hold'em | 8 | `holdem` (2 hole cards, board) | no limit |
| `poker:omaha` "Omaha" | Omaha | 8 | `omaha` (4 hole, exactly 2 + 3) | pot limit |
| `poker:short` "Short Deck" | Short Deck Hold'em | 8 | `short` (36 cards, 6 and up) | no limit |
| `poker:draw` "5-Card Draw" | five-card draw | 6 | `draw` (5 hole, no board) | no limit |

Settings (same for all, `poker(betting)`): `stack` Chips 500 / 1,000 / 2,000 (default 1,000); `hands` Hands no limit / 5 / 10 / 20 (default no limit: a tournament until one player has everything; with a limit, most chips after the last hand wins, reason `hands` "Last hand played"); `blinds` Blinds go up every 2 / 3 / 5 hands / never (default 3); `blindsBy` Blinds multiply by ×1.25 / ×1.5 / ×2 / ×3 (default 2); `betting` Betting No limit (0) / 2× pot (3) / Pot (1) / ½ pot (2), stored on the state as `limit` `nl` / `2pl` / `pl` / `hpl` (`LIMIT_OF` in `modes.ts`); `moveTime(24)` Time to move. `VARIANT` in `convex/poker.ts` maps a mode to its engine variant. Endings: `last_player`, `hands`, and a heads-up `resign` (below).

## File map

- `convex/poker.ts`: the Convex functions and `pokerHooks`. Never rename: `poker:move`, `poker:plan`, `poker:cards`, `poker:myPlan`. Exports `PokerState` (re-exported), `IDLE_OUT`, `Pre`.
- `convex/poker/engine.ts`: the rules as plain functions on plain data (`newGame`, `deal`, `act`, `leave`, `autoAction`, `raiseBounds`, `sidePots`, `standings`, `blindsFor`, `streetOf`, `potOf`, `toCall`, `alive`, `isOut`, `inHand`, `VARIANTS`). Pure, shared by the server and phones: no Convex or browser imports.
- `convex/poker/cards.ts`: cards and hand ranking (`deckOf`, `shuffle`, `rank5`, `bestHand`, `madeCards`, `CATEGORY`, `RANKS`, `SUITS`). Pure.
- `convex/poker/text.ts`: how moves read (`actionText` "Chris raised to 200", `actionLabel` "Raise", `handInSentence`, `resultText`). Shared.
- `convex/poker/modes.ts`, `convex/poker/preview.ts` (`pokerPreview` for `BOARDS`: hand, board, stacks, pot, who's out, whose move).
- `src/games/poker/`: `PokerGame.tsx` (the screen, the dock choice, `TopLine`), `show.ts` (`useShow`, `PACE`, `dealOrder`, `cardsHeld`), `Table.tsx` (the table, `SpellOut`), `table/Felt.tsx` (`Pile`, `Deck`, `Board`), `table/Seat.tsx` (`Seat`, `statusOf`, `Bet`, `Float`, `Dealer`, `NameLine`, `PayChip`), `table/Mine.tsx` (`MyTile`, `MyHand`, `TurnStatus`), `table/motion.tsx` (`SPRING`, `FLIGHT`, `DECK_W`, `toward`, `Flying`, `Roll`), `BetDock.tsx` (`BetDock`, `RaiseSheet`), `WaitDock.tsx`, `LastHand.tsx`, `replay.ts` (`missedHands`, `finalHands`, `handAt`, `stacksAfter`: pure, tested in `replay.test.ts`), `art.tsx` (`PokerBanner`, `PokerModeArt`), `rules.ts` (`pokerRules`), `summary.ts` (`pokerSummary`: last move and chips for lists), `format.ts` (`chips` 1,250, `sum`).
- Shared, outside the package: `PlayingCard` and `PokerChip` (`src/components/ui/playing-card.tsx`), the `poker-felt`, `poker-plate`, `poker-dealer`, `poker-chip`, `poker-tile`, `poker-up`, `playing-card*` utilities and the `@theme static` card colours in `src/style.css` (the felt is the theme's `--tile-green` mixed into `--card`; `src/themes.test.ts` checks text on it is readable). Poker has no `palette.ts`: every fixed colour lives in those CSS utilities.
- `og/games/poker.mjs` (the preview card; suits are SVG paths because satori's fonts have none and its emoji fallback draws clubs black), colours under `POKER` in `og/palette.mjs`.
- Tests: `convex/poker/engine.test.ts`, `convex/poker/server.test.ts`, poker cases in `convex/regressions.test.ts`; `e2e/poker.spec.ts`, `e2e/poker-screens.spec.ts`; `e2e/og-preview.mjs`; `e2e/playtest.ts` can seat agents at a table.

## Cards and hand ranking (`cards.ts`)

- A card is two characters, rank then suit: `As`, `Td`, `7c`. `rankOf` gives 2..14. `deckOf(short)` is 52 cards, or Short Deck's 36 (sixes up).
- `rank5(cards, short)` ranks up to five cards. Fewer than five can still pair up (a phone names "Pair of Aces" before the flop), but only five make a straight or flush. `score` is the category's order then five kickers in base 15; `name` is the full name ("Full house, Kings full of 7s", "Royal flush").
- Short Deck follows Triton rules: a flush beats a full house and three of a kind beats a straight (`SHORT_ORDER`), and the wheel is A-6-7-8-9.
- `bestHand(variant, hole, board)`: Hold'em and Short Deck the best five of hole plus board; Omaha exactly two of four hole cards and three from the board (null before the flop); draw just the five. Null with no cards.
- `madeCards(hand)`: the cards that make the hand, to ring them (the pair, not its kickers; all five for a straight, flush or straight flush; nothing for a high card).

## The engine's rules (`engine.ts`)

- State (`PokerState`, in `matches.state`): `hand`, `button`, `sb`/`bb`, `start` (stacks when this hand was dealt), `stacks`, `bets` (in front of each seat this street), `paid` (into the pot this hand, bets included), `dealt`, `folded`, `acted` (the bet level each seat last acted at this street, null until they act), `current` (the bet to match), `minRaise`, `street`, `board`, `turn` (-1 once the hand is over), `drew` (draw: cards swapped), `idle` (timeouts in a row), `log` (this hand's `LogEntry`s), `last` (the last `HandResult`), `recent` (optional: the last `RECENT_HANDS` (5) results, newest last, `last` among them), `out` (`Exit`s in order).
- `LogEntry.amount`: chips put in for a blind or call, the total bet for a bet or raise, cards swapped for a draw; `auto` means the move timer moved for them; `allIn`.
- `HandResult`: `shown` and `names` per seat (set for everyone at the showdown), `won` (what each took), `net` (that minus what they put in), `pots` with winners, `showdown`, and (optional, set by `endHand` since 2026-11-27) where the hand started: `start`, `button`, `dealt`, `blinds` (what each posted), `sb`, `bb`, and `forced` (nobody chose anything: only blinds and timeouts), so a phone can replay a hand it never saw (`handAt`).
- `Exit.stack`: the stack when the hand began (a bust) or when they left (a resignation), used to place players knocked out in the same hand.
- Streets: Hold'em family Pre-flop, Flop (3), Turn (1), River (1); draw Before the draw, Draw, After the draw. `streetOf` clamps the index: games stored before a fix had the street one past the last after a showdown (that blanked the app once). The showdown happens on the last street and the street never moves past it.
- `blindsFor(hand, every, by)`: starts at 10/20 whatever the stacks (so more chips is a longer game), multiplies by `by` every `every` hands (0 never), rounded to 5s, and every level goes up by at least 5. The server never lets blinds come down (`nextBlinds`): games from when blinds scaled with stacks stay where they got to.
- `deal`: needs two players alive (in, with chips). The first hand's button is the first live seat, then it moves to the next live seat. Heads-up the button posts the small blind and acts first before the flop (last after it). Hole cards are dealt from the button's left. Blinds short of the full amount go all in.
- `needs` (who still has to act): in a draw, everyone in who hasn't drawn; with everyone else all in, only a bet bigger than yours needs an answer (a big blind all in for less than the small blind doesn't); otherwise owing chips, or not having acted while someone else can still bet.
- When nobody needs to act the bets are gathered and the next street dealt; if nobody can bet at all (everyone all in) the board runs out to the showdown.
- `raiseBounds`: null unless it's your turn on a betting street, you have more than the call, and someone else can still act. A raise is at least the last raise again (`minRaise`), except all in. A short all in doesn't reopen raising: a seat that already acted can only call or fold unless the bet has risen by a full raise since (`acted`). A pot limit caps it at its share (`POT_CAP`: 1, ½ or 2) of the pot after calling (`current + floor(cap × (sum(paid) + owe))`), never below the min raise.
- `act`: refuses a move off turn, a check owing chips, a call owing nothing, a raise out of bounds ("Raise to between 40 and 960"). In the draw, picks are deduped and range-checked; new cards come off the deck before the old ones go to the muck, so you never draw your own back, and an empty deck reshuffles the muck (`take`).
- `autoAction`: what a timeout does: check if free, else fold; keep every card in a draw.
- `leave` (resign): folds you if you're in the hand, your chips leave with you (`out` reason `resign`), and play carries on from whoever's turn it is.
- Showdown: `refundUncalled` gives back the part of the biggest bet nobody matched, unless its owner folded (a resigned player's bet stays in the pot). `sidePots` splits by levels among the seats still in, and folded chips above the last level go in the last pot. Ties split evenly, odd chips going round from the button's left. Everyone else folding (`award`) gives the last one in everything without showing.
- `endHand`: anyone at 0 is out (`bust`), the smaller starting stacks first so they place lower.
- `standings`: everyone still in by chips (ties share), then everyone out, last to go first; two busted in the same hand with the same starting stack tie.

## Server (`convex/poker.ts`)

- **Secrets**: the deck and muck are the game's secret (`Shoe`); each player's cards are theirs (`Hand`: `{ cards, hand }`), rewritten when they change or a new hand starts. `matches.state` only ever holds cards shown at a showdown, so nobody can read another hand off the network. `load`/`save` move between a `Table` (`{ state, hidden }`) and the database. `poker:cards` returns my own (`mySecret`), with the hand number so a phone never shows last hand's cards against this hand's board; spectators and signed-out get nothing.
- `start`: a `newGame` with the settings, then `proceed`, which deals hand 1. Rematches keep settings.
- `proceed` runs after every move, in one mutation, up to `MAX_AUTOMATIC_STEPS` (200): it plays any lined-up move of whoever's next, deals the next hand the moment one ends (shuffled deck, `nextBlinds`), and ends the game when fewer than two are alive (`last_player`, or `resign` heads-up when this hand's leaver resigned, `resignedHeadsUp`) or after the last hand (`hands`). Then it saves, `passTurn`s (no push from it; `newDecision` when the hand, street or seat changed, so the same seat on a new street gets a fresh clock) and calls `tell`.
- `tell` (poker's own pushes, one per player, the most useful): the first hand sends `startPushes` ("Texas Hold'em is on", "You're first to act. 10 to call, 30 in the pot."). Later: anyone knocked out ("You're out"), showdown winners who came out ahead ("You won 340" with their hand), and, if `fresh`, the player to act with the latest move as the title and what's asked ("20 to call, 60 in the pot.", "Check or bet.", "Pick the cards to swap."). Whoever made the move isn't pushed unless lined-up moves brought the action back to them. `notify` skips anyone already looking.
- `pokerHooks.timeout`: `autoAction` for the seat on turn (marked `auto`); `IDLE_OUT` (3) timeouts in a row take you off the table (`leave`, plus a "You've left the table" push). `timeoutWarning`: "or we check or fold for you". A real move resets the count.
- `pokerHooks.resign`: `leave`, ignored if already out.

## Moves, lined-up moves and stale taps

- `poker:move { id, hand, street, kind, to?, discard? }` (`onTurn`): refused with "The hand moved on. Have another look." if `hand` or `street` isn't what's on the server, so a tap that lands after the hand moved on under the thumb never acts on a hand the player hasn't seen.
- `poker:plan { id, hand, street, kind?, amount? }` (`seated`, any status): clears any plan, then with a `kind` (`checkfold`, `check`, `call` with the amount seen) stores it as a draft (`Pre`, tied to that hand and street; `count` 0). A stale plan (hand or street moved on) is dropped silently, so it can never fold a hand you haven't looked at. If it's already your turn it plays now.
- `plannedMove(state, seat, pre)`: Check/Fold checks if free, else folds; Check only if free; Call checks if free, calls if the bet is still at most the amount lined up, else nothing. A plan that no longer fits (someone bet into your check) is cleared and the action waits for you.
- `poker:myPlan` reads my draft; `WaitDock` sets it with an optimistic update so the button lights at once (`aria-pressed`).

## The screen

- Portrait (`PokerGame` in `GameFrame tight`): `TopLine` (Hand N or "Hand N of M", Blinds, and Last hand), then the `Table`: the felt (street name, the pot's `Pile` of chips in the seats' colours and a "Pot" plate that rolls, the `Deck`, the five `Board` slots, "FORCE PUSH PAYS 2 TO 1"), everyone else along the bottom rail starting on my left so play runs left to right (avatar size by crowd: 42, 36 from 4, 30 from 6), then my tile, then my cards big with my hand named live. Spectators get `TurnStatus` instead.
- `Seat` (`data-seat`, `data-up`, `data-out`, `role=group` named "Chris, 930 chips, Fold"): avatar on the felt's edge with frame and glow, the online dot outside the dimmed part (someone folded can still be here), cards fanned behind (`Backs`, `data-back`), the dealer chip, a label for the last move this street or Out / All in / Fold, the bet above (`Bet`, `data-bet`, named "Chris has 40 in"), the winnings floating up (`Float`), and a tile with name, badge and chips. Shown cards at a showdown keep to the seat's width as far as their corners stay readable.
- `MyTile` ("You, 930 chips"): avatar, chips, my bet, and the "Your move" chip ("Pick cards to swap" in the draw) or whose move it is. "Your move" is only ever on my tile, never in `TurnStatus`.
- `MyHand` ("Your cards", `data-card` on each face): a place is held for every card from the start so nothing moves as they land; bigger on phones at least 780 tall (`ROOMY_HEIGHT`); fanned; dims when folded. In the draw each card is a button (`Button variant="bare" size="piece"`, "Swap card 1", `aria-pressed`) and picked ones lift; picks belong to the hand and street they were made on.
- The ring (`rung`): a finished hand rings the winning five (`best`); until then my made cards (`madeCards`).
- Docks: finished and caught up, the shared `Result`; while the show is busy, a 60px spacer; spectators "You're watching."; out, "You're out. Stick around to see who wins."; my turn in the draw, Swap N / Keep all five; my turn, `BetDock` (Fold when owing, Check or Call N / All in N, Bet or Raise opening `RaiseSheet`, an `AmountSheet` with `raiseSizes` (`sizes.ts`): Min, ⅓, ½, ⅔ and ¾ pot, Pot, 2× pot (each only below the table's cap), then All in, or the cap's own name (Pot, 2× pot, ½ pot) when the limit stops short of all in, in two rows past four, a slider snapping to big blinds except at its ends); otherwise `WaitDock` (Check/Fold and Check or Call N / Call all in to line up, and Resign; "Folded", "All in" or "Swapping" when there's nothing to line up). Every dock's buttons sit in `ActionRail`.
- Last hand (`LastHand`, a closable `Sheet` titled "Hand N"): "Earlier hand" and "Later hand" page through `recent` (it opens on the newest), the result line, the board on felt, and everyone who showed or won or lost chips with their hand, cards and net.
- The result sound (win / lose) waits for the last hand to finish playing, like the result itself.
- Landscape (`usePhoneLandscape` from `src/components/game/landscape.ts`): `TopLine` renders once as GameFrame's `aside` instead of above the table, so text locators never see two. The table becomes a row: the felt and its rail take the room left of the side column (the board's cards size to its width), and my tile (wrapping its status chip to a second row) and my cards sit in a column beside it (`w-44`); four or five cards wrap into rows (`handLayout`: 2x2 at 56, 3+2 at 50) instead of one fan. The side column is GameFrame's chrome, the `TopLine`, and the dock's `ActionRail` stacked. Portrait is unchanged: check with the screens parity.

## The show (`show.ts`)

The table draws a `Show`, not the state: one mutation can end a hand and deal the next, so the phone plays what happened in order and catches up to the newest state when it's done. Nobody waits on it; moves still go straight to the server.
- `useShow(state, { mySeat, nameOf, fresh })` returns the `Show` plus `behind` (the state moved on and the show hasn't started on it yet). The `Table` exposes `data-busy` (`busy || behind`) for tests.
- `PACE` (1.2) scales every timing (sleeps, every Motion duration and delay in the table). Change it there only.
- A new state never interrupts what's playing; the runner (`run`, at most 200 steps) picks up the newest when it gets there. The effect runs on the state's JSON (`content`), since every update is a new object with the same numbers. Once the screen unmounts nothing more plays or sounds (`alive`).
- What plays, in order:
  - a fresh game (hand 1, at most the blinds logged, under `FRESH_MS` 4s since it started) starts undealt and plays its first deal; opened later it's already on the table;
  - a deal (`deal`): the deck shakes (shuffle), cards fly out one at a time round the table from the button's left (`dealOrder`, `dealtCards`, gap at most 75ms or 1.5s in all), my cards turn over one by one (`faceUp`), then the blinds' chips sound and my turn chimes;
  - a new street (`nextStreet`): the street's bets sweep to the pile (`sweep`: the finishing move's sound, then the chips fly to `[data-pile]`), then the new cards turn over one at a time (`reveal`), then the moves already made on it sound;
  - a hand ending (`endHand`): the sweep, then at a showdown everyone's cards turn over, any board still to come runs out, the winning five lift (others dim), a flush or better is spelled over the board in green tiles (`bigHand`, "ROYAL FLUSH"), then the banner (`resultText`) and the payout (`PayChip`s fly from the pile to each winner, `Float` shows their net, stacks roll), then the next deal, or the settled final hand if the game's over;
  - every hand the phone missed, in order (`missedHands`), a fold's board included (shown before the payout): one mutation can end a hand and then deal and finish another with no decisions (a short stack all in on the blinds after a bust; lined-up moves), so the hand on screen ends first, then each later finished hand in `recent` is dealt from `handAt` and ended with its board run out, then the current deal or the settled finish. Before this, the phone jumped to the newest state and the hand everyone cared about (the all in that busted someone) never showed. Results from before `recent` existed can't be rebuilt and are skipped as before;
  - a move on the same street: drawn at once, its sound (fold recall, check knock, draw shuffle, chips by size), and an all-in bet or raise spells ALL IN with the last tile a crooked red hit, which never holds anything up (it clears itself after 1.15s x PACE).
- `busy` is true from a deal's start or a street or hand's end until it's done: the dock shows a spacer and `turn` is -1, so nobody acts on a table that hasn't caught up. `PokerGame` also keeps the cards of the hand on screen (`held`, by hand number), since the server can be a hand ahead.
- With reduced motion it jumps straight to the end (`settled`). While the page is hidden it plays nothing and waits (`usePageVisible`), so coming back plays what happened in the meantime. A finished game opened by a player who hasn't seen its end (`matches.endSeen`, see the framework skill) replays it (`replay` on `useShow`, `finalHands`): the last hand, or the trailing run of `forced` hands plus the hand before them (the short stack doubling up on the blinds and then busting goes back to the hand that made it short), then the result and its sound. `MatchScreen` only marks the end seen while the page is visible. Opened again it stays on its last hand. `PokerGame` waits for `meId` on a finished game so the choice is made with it. My cards in a replayed hand come from its showdown (`held` fills from `recent`).
- Motion rules (`table/motion.tsx`): a card is the real card from its first frame, in its final place, and flies there from the deck (`Flying`, `BoardCard`); it only flies on arriving (the props are captured in a ref at mount), and cards already out when the table first appears don't fly. Whatever flies away (folded backs to the deck, bets to the pile) holds where it lands, invisible, until it's removed: snapping back for even a frame shows as a blip. A fold before the backs ever showed sends nothing. `Roll` counts numbers to their new value. `SPRING` overshoots a little, `FLIGHT` lands softly; `DECK_W` (28) is the scale a card flies from or to.
- Sounds (`sfx`, all `live`): shuffle, deal, flip, chips, knock, recall, sweep, play (big hand), slam (all in), payout, turn, win, lose, pick (choosing a card to swap).

## Driving it in tests

- Unit: `convex/poker/engine.test.ts` builds tables with `newGame` and `deal(state, blinds, stacked("As Ad Kc Kd ..."), () => 0)` (a deck with those cards on top: holes from the button's left, then the board). `convex/poker/server.test.ts`: `game(t, n, mode, settings)` queues players and starts it, `up(t, id, seats)` gives whoever's on turn and `move(kind, extra)` with the hand and street they see; pushes are read from `_scheduled_functions` (`push:sendToUser`).
- e2e: poker games go through `openLobby(page, "poker", "holdem" | "omaha" | "short" | "draw", { Hands: "5" })` and `fillLobby` (never `testing:startMatch`). `twoPlayerGame` in `poker.spec.ts` returns whoever acts first (the button, heads-up) as `first`. Use `getMatch(id)` for `state.turn`, `state.hand`, `state.current`, `state.bets`, `state.stacks`, `state.out`, `moveCount`, and poll `moveCount` after a tap.
- Pass `reducedMotion: true` to `phones.open` for anything not about the show (a showdown plays about ten seconds otherwise). With motion on, wait for `[data-table][data-busy=false]` before looking at a settled table.
- Locators: the table `getByRole("group", { name: "Poker table" })`, board cards `getByRole("group", { name: "Board" }).locator("[data-card]")`, my cards `getByRole("group", { name: "Your cards" })`, a seat `getByRole("group", { name: /^Chris, / })` (`data-out`, `[data-back]`, `[data-frame]`), buttons by name: "Call 10", "Check" (exact), "Fold", "Raise"/"Bet" then "Min"/"Pot"/"All in" then "Raise to 40"/"All in 960", "Check/Fold" (`aria-pressed`), "Swap card 1", "Swap 2", "Keep all five", "Last hand". Dock buttons sit in `getByRole("group", { name: "Actions" })`.
- `window.__sfx` lists the effects asked for; `window.__soundLab.sfx(pack, name)` renders one offline for the level check.
- Landscape: `simulateSafeAreas(page, SAFE_LANDSCAPE)` and `rotate(page, "landscape")` once the game's open, then `ready` and `expectFitsScreen` (`e2e/landscape.ts`).
- Screens: `SCREENS=1 npm run test:e2e -- poker-screens` shoots a six-player table (`PLAYERS=8` for a full one) in dark and light and films a hand (`poker-hand.webm`, failing on a frame gap over 2s). `SCREENS=1` on `poker.spec` adds the finished table, Omaha, the menu, the draw and the landscape shots. Seating and deals are random, so those shots differ run to run.
- `node e2e/og-preview.mjs` writes `e2e/.state/og-poker-match.png` and `og-poker.png`.

## Gotchas

- Never put cards in `matches.state` outside a showdown result; never return a secret to anyone but its owner.
- `streetOf`'s clamp and `idle?.` optional reads are for old stored games; keep them.
- The dealer chip and a seat's cards once shared a React key, so the dealer kept last hand's cards on top of this hand's: keys carry the hand (`backs${hand}`, `dealer${hand}`).
- A busted player must show no backs at any moment of the next deal (tested frame by frame for six seconds).
- React reports render crashes with `console.error`, not as page errors: e2e watches both (`watchErrors`).
- Poker sounds must sit no louder than the rest of each pack (`e2e/poker.spec.ts` averages four renders of each, since noise peaks vary).
- The dealer's D is `text-caption` (11px); it was 10px, under the smallest type size, like a card's printed letters. If it should be 10px again it belongs in the `poker-dealer` utility, not markup.

## Tests

- `npx vitest run convex/poker` (and `convex/regressions.test.ts`): rankings, made cards, Short Deck and Omaha, blinds, heads-up order, folds, min-raise and short all ins, pot limit, side pots, busts and standings, run-outs, resigning, the draw and reshuffle, refunds, timeouts, split pots and odd chips; the server's dealing and privacy, blind schedules, pushes, plans (playing, not fitting, stale, bringing the action back), the draw, endings, timeouts, folded cards never public, stale taps.
- `npm run test:e2e -- poker`: `e2e/poker.spec.ts` (the Poker page and its four games, frames, badges, online dots and sounds, sound levels, a hand on two phones through raise, lined-up check, shove and fold, the last hand ending the game, an all-in bust ending it with the result sound after the payout, cards leaving the table, the dealer's cards, a busted seat with no cards, Omaha's four cards fitting, the draw swap, landscape for Hold'em and the draw) and `e2e/poker-screens.spec.ts` with `SCREENS=1`.
