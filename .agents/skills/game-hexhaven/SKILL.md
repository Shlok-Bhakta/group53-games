---
name: game-hexhaven
description: The Hexhaven package's feature map. Use for any Hexhaven work: its one async mode and settings, the island geometry (hexes, corners, edges, coast, harbors, the big island for 5 and 6), the rules engine (setup, rolling and production, the 7 and discards, the bandit, building, longest road and biggest army, cards, bank and harbor trades, offers, resigning, winning), hidden cards in secrets, pushes and reminders, the board and dock, the test bots, the link preview and the tests.
---

# Hexhaven

AGENTS.md is the overview and the `framework` skill covers matches, turns, secrets, pushes and the harness; the `ui` skill covers `GameFrame`, sheets and landscape. Hexhaven is our own settle-the-island game in the hex-island genre: the name, the art, the card names and the wording are ours. Code, paths and functions say `hexhaven`.

## Mode and settings

One async mode, `hexhaven:classic` ("Classic", 2 to 6, `minPlayers` 2 so the host taps Start), in `convex/hexhaven/modes.ts`. Settings, turned into engine `Rules` by `rulesOf` in `convex/hexhaven.ts`: `points` Points to win (8, 10, 12, 15; default 10), `limit` Hand limit on a 7 (7 or 9 cards), `friendly` Friendly bandit (never steals from, or sits next to, anyone on 2 public points or fewer, unless every hex does), `balanced` Numbers (Balanced: the 6s and 8s go first on hexes none of which touch, then the rest anywhere; Wild: anywhere). Endings: `points` (reached the points), `last_player`, `resign` (one of two). No time limit: `timeout` does nothing; `remind` pushes whoever it's waiting on every 4 hours, then every 12 after 4 nudges. `src/games/hexhaven/rules.ts` is How to play written from the settings.

## File map

- `convex/hexhaven.ts`: `move` (`{ id, action, seen? }`), `cards` (my hidden cards), `remind`, `hexhavenHooks`, and `load`, `play`, `rulesOf`, `REMIND_MS` for tests. Never rename `hexhaven:move`, `hexhaven:cards` or `hexhaven:remind`.
- `convex/hexhaven/board.ts`: resources (0 timber, 1 brick, 2 wool, 3 grain, 4 ore; `DESERT` -1), `COSTS`, `PIECES` (15 roads, 5 villages, 4 towns), `LAYOUTS` (`standard`: rows 3-4-5-4-3, 19 hexes, 9 harbors, supply 19, 25 cards; `big` for 5 and 6: rows 3-4-5-6-5-4-3, 30 hexes with 2 deserts, 11 harbors, supply 24, 34 cards) and `geometryOf(layout)`, which builds and caches the corners (`verts`, with `hexes`, `edges`, `near`), `edges` (`a`, `b`, `hexes`), `hexVerts`, `hexNear`, the `coast` (coastal edges in order round the island) and the harbor slots (evenly round the coast). Coordinates are integers: a hex centre is `(x, y)` with corners at `(0,±2)` and `(±1,±1)`; draw at `x·√3/2, y/2`.
- `convex/hexhaven/engine.ts`: the rules, pure. `newGame(n, rules, rng)`, `act(game, seat, action, rng)` (clones, applies, throws a sentence a player can read), `actor`, `waitingOn`, `standings`, the `cant*` helpers (`cantVillage`, `cantRoad`, `cantBuild`, `cantDev`, `cantOffer`, `cantAccept`), the spot lists (`villageSpots`, `roadSpots`, `townSpots`, `banditHexes`, `victimsAt`), `rateFor`, `bankOf`, `roadLength`, `publicPoints`, `totalPoints`.
- `convex/hexhaven/text.ts`: `say(event, name)` (the log and push recaps), `handText`, `resName`, `CARD_NAMES`, `CARD_TEXT`.
- `convex/hexhaven/bot.ts`: `botMove(game, seat, rng)` and `nextBotSeat(state, isHuman)`, for tests and playtests only.
- `convex/hexhaven/preview.ts`: the link preview's data, already in drawing units (hex corners, pieces, the bandit) so `og/games/hexhaven.mjs` needs no geometry. Never anyone's cards.
- `src/games/hexhaven/`: `HexhavenGame.tsx` (the screen: top line with dice and Log, the players strip, the board, sheets; what's pickable now, `pickFor`; `useLive` for sounds and the +n floats on your hand), `Board.tsx` (the SVG island and the 44px pick buttons over it), `Dock.tsx` (your hand, the action for this phase, Trade / Cards / End turn, the discard sheet), `TradeSheet.tsx`, `CardsSheet.tsx`, `parts.tsx` (`useHexMove`, `ResIcon`, `HandRow`, `Counts`, `ResPicker`), `art.tsx`, `rules.ts`, `summary.ts`, `palette.ts` (terrain and board colours, which don't follow the theme).
- `og/games/hexhaven.mjs` (colours under `HEXHAVEN` in `og/palette.mjs`): the island as an SVG image with the numbers laid over it as text.

## The rules engine

- A game is `{ s, deck, held, events }`. `s` (`HexState`) is public and goes in `matches.state`; `deck` (the cards left, in order) is the game's secret; `held[seat]` (`{ c, t }`: the card and the turn it was bought) is each player's own secret. Resource hands are open on purpose: everyone sees everyone's (`players[i].res`). Card counts are public (`devs`), the cards aren't; at the end `players[i].points` reveals everyone's total, Monuments included.
- **Phases** (`s.phase.k`): `setup` (`i` in the snake order 0..n-1, n-1..0, `at` = the village just placed, waiting for its road), `roll`, `discard` (`owe` per seat; anyone owing may discard any time; then `bandit`), `bandit` (`then`: back to `roll` for a knight played first, else `main`), `main`, `roads` (Two roads: `left`, `then`), `over` (`winner`).
- `actor`: the setup seat, the first seat still owing a discard counting from whoever's turn it is, else whoever's turn it is. `waitingOn` is everyone it waits on (all discarders).
- **Setup**: a village anywhere two steps from any other, then a road touching it; the second village pays one of each hex round it. After the last road it's seat 0's roll on turn 1.
- **Rolling**: 7 → anyone holding more than `limit` gives back half (rounded down), then the roller moves the bandit to another hex and steals one card at random from someone with a building there and cards in hand (they must pick one when anyone qualifies). Otherwise every hex with the number, but not under the bandit, pays its villages 1 and towns 2. A resource the bank can't cover for everyone pays nobody, unless only one player wants it (they get what's left).
- **Building** (`main` only, your turn): roads join your roads or buildings and don't pass through someone else's building; villages need your road; towns replace your own villages. Pieces are limited.
- **Longest road** (`awards`): recomputed after every build and village; 5 or more and strictly the longest takes it; a tie with the holder keeps it; if the holder is cut and others tie, nobody holds it. **Biggest army**: 3 knights or more and more than the holder. Each is 2 points.
- **Cards**: buy for wool, grain and ore; play one a turn (not a Monument, not one bought this turn), before or after rolling. Knight → bandit; Two roads → `roads` with 2 free roads (or Done); Windfall → any two from the bank; Corner the market → everyone's of one resource.
- **Trades**: the bank at 4:1, 3:1 with any harbor you've settled, 2:1 at that resource's harbor. Offers (`main` only) must involve whoever's turn it is: theirs to one player or anyone, or anyone's to them. Accepting re-checks both hands. Declining an offer to anyone only removes it once everyone who could take it has declined (`no`). Every offer goes at the end of the turn.
- **Winning**: checked after every action by the player whose turn it is, at the start of their turn, and after someone leaves: total points (with their hidden Monuments) at the goal ends it. Only your own turn wins.
- **Resigning**: you're out; your hand goes back to the bank, your pieces stay on the island as obstacles but produce nothing, your offers and discards go, awards are worked out again, and your turn moves on. The last one left wins.
- Every random thing (the island, the deck, dice, the stolen card) comes from the `rng` passed in; the server passes `Math.random`.

## Server

- `start`: `newGame` with `rulesOf`, then `commit` writes the deck and every player's (empty) hand of cards, `passTurn` to `actor` with `remind` as the timer, and the "Hexhaven is on" pushes (`startPushes`).
- `move` → `play`: `seated` (any time, the engine decides), `load` (state plus every secret), `act`, `commit`. `seen` is the `seq` the phone drew; for `buy`, `bank`, `offer`, `plenty` and `corner` (things a double tap would do twice) a different `seq` is refused.
- `commit` only rewrites a secret that changed. Over: `finishBySeats(standings)` with `points`, `resign` or `last_player`.
- `tell`: one push per player, the most pressing: 0 a 7 they must give cards back for, or a fresh decision now theirs ("Your turn to settle", "Your turn" with what just happened); 1 an offer to them; 2 robbed, or cornered; 3 their trade taken or turned down. Never the mover, never anyone out.

## The screen

- `GameFrame` (not fullscreen): the top line (Settling / Turn N, First to N, the last roll's dice popping in, Log), the players strip (points, hand size, cards held, longest road and biggest army marks; tap for their sheet with their open hand and Trade with them), the island (square, `phone-landscape:square-fit`), and the dock (`data-dock`, `data-phase`, `data-mine`): your hand (`data-res`, `data-count`, floating +n/−n when it changes), the action for this phase, then Trade (badge: offers to you), Cards (badge when one's playable) and End turn.
- Picking: `pickFor` decides what's pickable (setup village or road, the bandit's hex, free roads, or the piece chosen from Road / Village / Town). Each spot is a 44px `Button` (`data-pick`, `data-at`) over the SVG; tapping one shows a ghost piece and the dock's confirm ("Settle here", "Build the road", "Build road here", "Rob Chris", "Move the bandit here"). A selection clears when the phase or piece changes or the spot stops being valid.
- Live: pieces someone else builds pop in (Motion on mount for anything not there when the screen opened; villages are a `g` with the translate around the animated path, since Motion's scale replaces an SVG `transform`), the bandit slides, the dice spin in; sounds: shuffle (someone rolled), place (someone built), invalid (robbed), knock (an offer to you), turn, chips (cards in), win or lose.
- Landscape: `aside` holds the top line and players; the dock is the side column.

## Driving it in tests

- Unit: `engine.test.ts` builds games with `newGame(n, rules, fixed())` and scripted dice (`dice(a, b)`), places setup with the first legal spot, and patches `g.s` directly for a known position. `sim.test.ts` has bots play whole games for 2 to 6 players under 4 rule mixes (one resign mid-game) and checks after every action: bank and hands never negative, pieces within limits, card counts matching the hidden hands, the deck count, the distance rule, never waiting on someone out, no empty discard phase, nobody past the goal on their own turn without it ending. `server.test.ts`: `game(t, n, settings)`, `botsUntil(t, id, seats, done)`, pushes as pending `push:sendToUser` jobs, secrets read with `loadGame`.
- `testing:hexhavenBots({ id, human?, steps? })` plays bots for every seat but `human` (offers to bots are answered first); keep `steps` to a few dozen per call (each call is one transaction). `testing:hexhavenPatch({ id, state })` merges fields into the state (`players` with `res`, `phase`, `current`).
- e2e (`e2e/hexhaven.spec.ts`): start with `openLobby(page, "hexhaven", "classic", settings)` and `fillLobby`; the island is `getByRole("group", { name: "The island" })` with `data-pieces` and `data-bandit-at`; spots `[data-pick="village|road|town|hex"]`; dice `[data-roll]`; players `[data-seat]`. `SCREENS=1 npm run test:e2e -- hexhaven` writes `e2e/.state/screens/hexhaven-*.png` (mode, setup, rolled, build, trade, landscape, midgame, log, player, midgame-light).

## Gotchas

- Stored games carry `HexState` as is: never rename its fields or event fields; keep `kind: "hexhaven"`. New fields optional.
- The island's geometry is derived from `layout` every time: changing `LAYOUTS` rows or the corner order reshuffles every stored game's spot and edge indexes. Add a new layout key instead.
- Hidden cards live only in secrets. The state's log never names a bought card (`buy` has no card), and the cards query returns only my own.

## Tests

- `npx vitest run convex/hexhaven`: the island, setup, rolling and production, the bank running short, the 7, the bandit and the friendly bandit, building, longest road, cards, harbors and offers, leaving, the bot simulation, and the server (setup pushes, secrets, stale taps, the 7's pushes, trades, reminders, resigning, the preview, a whole game through the server).
- `npm run test:e2e -- hexhaven`: the card and mode page, settling on two phones to the first roll, building a road, a trade across phones, a 7 with a discard and the bandit, landscape, and the screenshots.
- `node e2e/og-preview.mjs` renders `e2e/.state/og-hexhaven-match.png` and `og-hexhaven.png`.
