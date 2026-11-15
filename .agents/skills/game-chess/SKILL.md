---
name: game-chess
description: The chess package's feature map. Use when working on any chess mode (Classic, 4-Player, Real-time, Real-time 4-Player), its engines (chess.js classic, the real-time Kung Fu engine, four-player Free-for-all), its screens, its link preview or its tests.
---

# Chess

AGENTS.md is the overview and the `framework` skill covers matches, turns, pushes and the harness. This is what you need on top of them to change chess.

## Modes

Four modes, all `game: "chess"`, defined in `convex/chess/modes.ts` (`CHESS_GAME` with every ending's wording, `CHESS_MODES`):

| Mode | Kind | Seats | Board | Settings |
| --- | --- | --- | --- | --- |
| `chess:classic` "Classic" | async | 2 | `two` | Time to move (`moveTime(0)`: none by default, 1-3 days, losing on time); `draws` |
| `chess:four` "4-Player" | async | 4 | `four` | Time to move (`moveTime(48, false)`: 1-3 days, default 2, no "none"); `reasons.fifty` reads "Fifty quiet rounds" |
| `chess:realtime` "Real-time" | realtime | 2 | `two` | Cooldown (2/3/5/10 s, default 5) and Piece speed (ticks per square: Slow 45, Normal 30, Fast 15); `draws` |
| `chess:realtime4` "Real-time 4-Player" | realtime | 4 | `four` | the same two |

`minPlayers === players` everywhere, so every chess game starts itself once full. Endings (`reason`): checkmate, stalemate, repetition, insufficient, fifty (classic; draws except checkmate), king, both_kings, no_progress, last_king (real-time), last_player and fifty (four-player), plus the shared resign, timeout, agreement.

## File map

- `convex/chess.ts`: the Convex functions and `chessHooks`. Never rename these: `chess:move`, `chess:fourMove`, `chess:ready`, `chess:rtMove`, `chess:rtState`, `chess:rtTick` (scheduled), and `chess:finalize`, an empty internal mutation kept because scheduled jobs from older deploys pointed at it. Exports the stored state types `ClassicState`, `RealtimeState`, `FourState`, plus `initialState`, `seatColors`, `variantOf`, `classicEnding`, `MAX_LAG_TICKS`.
- `convex/chess/realtime.ts`: the real-time engine (both variants). Pure, shared by server and phones.
- `convex/chess/four/board.ts`: four-player geometry (shared by both four-player engines). `convex/chess/four/classic.ts`: the turn-based four-player engine (`initialFour`, `move4`, `retire4`, `legalTargetsFrom`, `inCheck`, `liveColors`, `fourBoards`).
- `convex/chess/schema.ts`: `rtCommands` (index `by_match_tick`) and `rtSnapshots` (index `by_match`, one row per real-time game). `convex/chess/preview.ts`: `chessPreview` for `BOARDS`. `convex/chess/modes.ts`.
- `src/games/chess/`: `ChessMatch.tsx` (`ChessGame`, the screen for every mode: player bars, the four-player seats and status line, the dock's Controls), `ClassicGame.tsx`, `FourGame.tsx`, `RealtimeGame.tsx` (each owns its `GameFrame`), `Board.tsx` (turn-based board for 8x8 and 14x14), `rt/RtBoard.tsx`, `rt/useEngine.ts`, `rt/Overlay.tsx` (real-time), `dock.tsx` (the confirm-before-send move), `history.tsx` (the move line), `geometry.ts` (`View`, `viewFor`, taps), `landscape.tsx` (`BesideTheBoard`, and `usePhoneLandscape` re-exported from `src/components/game/landscape.ts`), `palette.ts` (board colors that don't follow the theme), `ChessBanner.tsx` and `ModeArt.tsx` (card art), `rules.ts`, `summary.ts`, `text.ts` (`COLOR_NAMES`).
- `og/games/chess.mjs` (link preview card; pieces fetched from `PIECES_URL`, the `web` container's `/pieces`), colors under `CHESS` in `og/palette.mjs`.
- Pieces: `public/pieces/{w,b}{K,Q,R,B,N,P}.svg`, and `public/pieces/four/{red,blue,yellow,green,dead}X.svg` made by `node scripts/gen-four-pieces.mjs` (recolors the white set). The four armies' colors are `SEAT_COLORS` (`src/games/palette.ts`) and match the piece art, so they're the same in every theme.
- Tests: `convex/chess/realtime.test.ts`, `realtime4.test.ts`, `four.test.ts` (server, convex-test), `four/classic.test.ts`; `e2e/chess.spec.ts`, `e2e/four.spec.ts`, `e2e/chess-screens.spec.ts`. Chess also drives `e2e/load.mjs`, `e2e/og-preview.mjs` and much of the framework's regression tests.

## Classic (`chess:classic`)

- State `{ kind: "classic", fen, moves: { san, lan, at }[] }`; `lan` is from + to (+ promotion), e.g. `e7e8q`. White is seat color `w` and moves first; the start hook pushes white "You're white" and arms the 8-hour reminder.
- `chess:move` validates with chess.js on the server (turn from the FEN, `seated(..., { modes: ["chess:classic"] })`), clears `drawOffer`, and either finishes (`classicEnding`) or `passTurn`s with a push naming the move ("Chris played Nf3. Check!").
- Draws: Offer draw in the dock (`matches.offerDraw`); a second offer from the other side accepts. A move clears a standing offer.
- The client keeps a stable key per physical piece across positions (`useStableKeys`: a piece that vanished from one square and appeared on another of the same color and kind, or a pawn that promoted, keeps its key) so moved pieces slide (220ms left/top transition) instead of popping. The optimistic update (`playMoveOptimistically`) plays the move locally with chess.js; if chess.js refuses it, nothing changes and the server's error toasts.

## The confirm-before-send move (Classic and 4-Player)

A move on the board never goes straight to the server (`dock.tsx`).
- `useMoveDraft(position)`: the draft belongs to one position key (`id:status:fen` classic, `id:status:JSON(state)` four), so any change (a move landing, a resignation, a timeout) drops it without an effect.
- While it waits, the board shows the position after it (`preview`), a faint copy of the piece at home (`ghost: true`, `data-ghost`, 30% opacity, takes no taps), and the move highlighted. `realSquare(draft, sq)` maps the draft's destination back to the real square, so picking that piece up again moves it from home; `draftTargets` adds its home square as a target (moving back cancels the draft) and drops the draft square. Moving any other piece of yours replaces the draft. No Cancel needed for either.
- The dock swaps draw/resign for `ConfirmMove` (Cancel 1fr, Confirm 2fr, naming the move in `font-display`). Its height matches the dock buttons, so the board never shifts (tested).
- `useSendMove(moves)`: Confirm spins for at least `CONFIRM_HOLD_MS` (400ms) so a double tap can't land on Resign as the dock swaps back; it names the move until the server has it or until another move lands after it (the reply), whichever is first, so the board takes taps on your next turn even mid-hold.
- A promotion asks in a `Sheet` ("Promote to", queen/rook/bishop/knight buttons named for tests) and the chosen piece is previewed until Confirm.
- Real-time never drafts: moves go at once.

## The move line and history (`history.tsx`, async modes)

- `useHistory(game, count)`: `at` moves into the game. Live (`at === count`) follows new moves; stepped back, it stays where it is when a move lands, so the board never changes under someone looking back.
- `MoveLine`: Previous/Next arrows (named "Previous move"/"Next move") either side of a horizontal list (`aria-label="Moves"`), scrolled to keep the current move in view (centered while stepping, the end when live; instant on first paint, smooth after). The arrow keys step too. Empty line: "No moves yet. White starts." / "Red moves first, then play goes clockwise."
- `MoveChip`: tap a move to see the board just after it (`ply + 1`); the current one carries `aria-current="step"` and `data-current`; later ones fade to 40%. Four-player chips show a seat dot.
- `BackToNow`: while stepped back, an invisible button over the whole board ("Back to the current position") returns to now. The board takes no moves while in the past.
- Classic's past boards replay `moves[].lan` through chess.js. Four-player's come from `fourBoards(state)` (computed once on the first step back), which trusts the recorded moves and puts back who'd gone out by each ply; replaying through `move4` took over a second for 200 moves. `fourBoards()[i]` is the board after `i` moves, with only the board, who's out and whose turn it was; points and the result are the game's.

## Four-player geometry (`four/board.ts`, `geometry.ts`)

- 14x14 minus the 3x3 corners (`onBoard`). `x` is the file (0 = a ... 13 = n, `FILES14`), `y` the rank (0 = rank 1). Red at the bottom, then clockwise: blue left, yellow top, green right; turn order is the same clockwise order (`COLORS4`).
- Every army is red's setup rotated about the center: `rotate(color, x, y)` maps red's frame into `color`'s (quarter turns from `TURNS`), `unrotate` the inverse, `rotateDir` for vectors (`forward`). Red's back rank is d1..k1 with the queen on g1 and king on h1 (`BACK_RANK`). `relativeRank` counts from a player's own side: pawns start on 1 and promote, always to a queen, on 7 (their 8th rank, the middle line, `PROMOTION_RANK`).
- Castling in red's frame (`CASTLES`): king h1 to j1 with rook k1 to i1, or king h1 to f1 with rook d1 to g1. Real-time four-player has no castling.
- `viewFor(variant, myColor)` returns a `View` (`toScreen`, `fromScreen`, `onBoard`, `name`) that puts your army at the bottom (two-player flips for black; four-player unrotates by your color). It works on fractional squares, so pieces in flight map smoothly. Spectators see red's (or white's) side.
- Taps on the 14x14 board: squares are under 30px, so a tap snaps to the nearest square that would do something (a selectable piece, or a target) within `TAP_REACH` (0.85 squares) of the finger (`nearest`, `pointToScreen`). An exact hit on a candidate always wins. On 8x8 there's no snapping. `Board` takes `selectable` (every square `canSelect` accepts) for that.
- Seats sit in the empty corner on their army's left (`SIDES` and `CORNER` in `ChessMatch.tsx`, counted clockwise from mine at the bottom): avatar (with a turn ring as a box-shadow; the wrapper is `flex` so an inline avatar's descender doesn't make the ring an oval, tested), name, then points, Ready, the out reason or the color. `data-seat=<color>`.

## Four-player turn-based rules (`four/classic.ts`, chess.com Free-for-all)

- Check against every live opponent. With no legal move on your turn you're out: checkmate gives +20 to the most recent mover whose pieces attack your king (else the last mover); stalemating yourself gives you +20. Resigning or timing out also puts you out (`retire4`; resign can come out of turn, and play goes on).
- Out armies turn grey (`dead`), stay on the board, block, attack nothing, and score nothing when taken.
- Captures: P 1, N 3, B 5, R 5, Q 9, promoted queens 1 (`POINTS`, `promoted`). Checking two kings at once +5 (+1 with a queen), three +20 (+5 with a queen).
- Ends when one player is left (`last_player`) or after 50 rounds (50 plies per player still in, `quiet`) with no capture or pawn move (`fifty`, +10 to everyone still in). Standings: most points, ties to whoever lasted longer.
- Server: `chess:fourMove` (`move4` returns null for an illegal move), `applyFour` saves and pushes the next player ("Chris played Qxe4. You're in check!"), anyone just knocked out ("You were checkmated", "You're stalemated: +20", "You timed out"; nobody for a resignation), and finishes with standings by color. Timeouts: the shared reminder chain, six missed reminders (48 hours by default) call `timeout`, which retires them like a resignation.

## Real-time engine (`convex/chess/realtime.ts`)

Kung Fu Chess as on rtchess.org, both variants.
- 30 ticks/s (`TICK_MS`). Positions are in `CELL` (120) units per square. Pace (`State.pace`, from settings by `paceFromSettings`: speed in ticks per square, cooldown seconds x 30): default 30 ticks a square and a 150-tick cooldown; games from before pace was a setting have no `pace` and use `DEFAULT_PACE`.
- No turns: any ready piece moves any time; travel time is Chebyshev distance x pace (diagonals cost the same); landing starts the cooldown (`readyAt`). Castling (two-player only) is the king moving two squares; king and rook leave and land together (2 squares' time kingside, 3 queenside).
- Collisions (`stepTick`, in this order each tick: collisions at this tick's positions, then landings, then cooldowns ending, then premoves firing, then the no-progress check): two opposing pieces collide when their centers are under half a square apart on both axes (`HIT`), and at least one is moving. A moving piece takes a resting one; two moving, the one that started first wins; same start tick, both die. Knights jump: they can't collide until 75% through their flight (`KNIGHT_LANDING`).
- `legalTargets`: only resting pieces block; you can't target a square your own piece rests on or is heading to; no check. `premoveTargets`: a busy piece's geometry from where it will rest, ignoring blockers; legality is checked when it fires.
- Commands (`Command`: `tick`, `color`, `pieceId`, `toX`, `toY`, `kind`): `move` starts a ready piece or queues a premove on a busy one (replacing any earlier premove); `cancel` drops a premove; `resign` (four-player only) takes the sender's army out at that tick. A command stamped `t` applies before tick `t` is processed. Within a tick they apply in `commandOrder` (tick, color rank, piece id, cancels last), so everyone agrees. Illegal commands are ignored identically everywhere (`applyCommand` returns false), which is why the server never validates moves.
- Premoves fire the tick their piece is ready, if still legal; otherwise they're dropped.
- Endings: taking a king wins (`king`); both kings on one tick is a draw (`both_kings`); 90 seconds (`NO_PROGRESS_TICKS`) with no capture or pawn move is a draw (`no_progress`). No check, no en passant, pawns always promote to a queen (two-player on the last rank; four-player on their 8th rank).
- Four-player: losing your king (or resigning) puts you out (`out`, in order, several per tick possible): the army freezes where it stands (positions rounded to squares), turns `dead` (grey stone anyone can capture). Last king standing wins (`last_king`); the ranking is still-live colors first, then by elimination tick, latest first; no king left is `both_kings` with everyone who fell last sharing first (`rtTick` turns that into shared first place).
- `simulate(commands, toTick, from?)` replays up to (not including) `toTick`, from a state or a fresh variant; you may continue from a state as long as no command earlier than its `tick` was added (`State.tick` is the next tick to process). `predictEnd` finds the tick the game would end on with no more commands (it always ends, by the no-progress rule).
- **Deterministic, bit for bit.** No Convex or browser imports, no `Math.random`, `Date.now`, `**`, or non-portable `Math` (lint enforces it for `convex/chess/realtime.ts` and `convex/chess/four/**`). It only uses `+ - * /`, `abs`, `min`, `max`, `round`, `floor`, which are exact everywhere. `structuredClone` copies states. Any change here changes how every stored game replays: keep `convex/chess/realtime*.test.ts` green and add a case.

## Real-time netcode (`convex/chess.ts`, `RealtimeGame.tsx`)

Built this way after the first version lagged; never undo it.
- `chess:ready`: each phone calls it once its board is up (retrying with backoff from 500ms to 5s until it lands). When the last player is in, `startAt` is set `REALTIME_COUNTDOWN_MS` (3s) ahead, the first `rtSnapshots` row is inserted with the game's pace, and `rtTick` is scheduled. Until then `unstarted` is true and `matches.sweep` calls the game off after 3 minutes.
- **A move is one insert.** `chess:rtMove` adds a row to `rtCommands`. It never writes the match, so two players moving at once can't conflict. It's stamped with the tick the player acted on (`clientTick`), honoured within `[server - MAX_LAG_TICKS (20), server + 3]` (`honouredTick`), so the mover's optimistic update (appending the command to `rtState`'s commands) matches the server exactly and nothing jitters. It refuses a move before the countdown ends or to a square off the board, and doesn't check the move is legal.
- `chess:rtTick` runs every 500ms: it advances the snapshot to `now - MAX_LAG_TICKS - 2` (`settledTick`; nothing can be stamped earlier any more) reading only commands in the settled range (new moves never land there, so it doesn't conflict with them), and finishes the game once the result falls inside the settled part. Standings for four players are the ranking mapped to players.
- `chess:rtState` returns the variant, the snapshot and every command since it. Games from before the command table kept `state.commands` on the match: they replay from those with no snapshot.
- Resigning real-time four-player is a `resign` command at the current tick (so it lands in the same timeline); before the clock starts it cancels the game. Two-player resign finishes at once.
- The phone (`useEngine`): replays snapshot + commands, continuing from the last frame's state when the command list only grew at or after it (else from the snapshot). The frame loop (`requestAnimationFrame` in `RealtimeGame`) moves pieces and cooldown bars directly in the DOM (`pieceEls`, `cooldownEls`) and only sets React state when `structureOf(state)` changes (piece kinds, statuses, squares, premoves, outs, result, capture count). Remote moves arrive after they started; they ease in over `CATCH_UP_TICKS` (10) from where they were first seen. The clock is `useServerClock` (slews, never jumps). Pieces are drawn where they rest on first render so nothing starts in the corner (tested).
- `useHoldUpdates` holds a new build's reload while a seated player's game is active: a reload mid-game would cost seconds of play.
- Never put per-move simulation, or writes another player also makes, back into the move mutation.

## Real-time screen

- `RtBoard` (`role="grid"`, "Real-time chess board" / "4-player real-time chess board", `data-playing` once the countdown's over and you can move): rtchess's colors (`RTCHESS_MARKS`): blue tints for a move's from and to, green selection and targets, an orange dashed square for premove targets and orange arrows (`data-premove`) for queued premoves, a yellow cooldown bar rising from each resting piece's foot, a red ring burst on each capture. Pieces: `data-piece="<color|dead><Kind>"`, `data-status` (`ready`/`moving`/`cooldown`), drop shadow while moving.
- Taps: tap your piece then a target, or drag it (a ghost follows the finger once it moves 6px). Tapping a piece with a queued premove cancels it. Picking a busy piece offers premove targets. On 14x14 your piece and targets snap within `TAP_REACH`.
- `Overlay`: "Waiting for Chris to open the board", then the countdown (`data-countdown`), over a blurred board.
- First three real-time games show a one-line how-it-works hint (`localStorage.rtHintGames`). Out of a four-player game: "Your king fell. Your army is stone now; watch who survives."

## Screen layout and landscape

- `ChessGame` builds the dock (`Dock` = a function given Confirm, or nothing): Result when finished, `Controls` for players (Offer draw and Resign two-player; Resign only four-player; "You're out" note once out; a "Draw offered" banner with No/Accept), "You're watching." for spectators. Buttons sit in `ActionRail`.
- Portrait: opponent bar, board, my bar (two-player; "Your move" chip fades in place, never flies between bars, since a chip crossing the board catches taps), then the move line; four-player: the board with seats in its corners, the status line ("Chris is on it", `TurnText`), the move line.
- Landscape (`usePhoneLandscape`, the `phone-landscape` media query): each game renders its bars, status and move line once, as GameFrame's `aside`, instead of in the board block, so nothing is duplicated in the DOM (tests use text and label locators that would see both). The board wrapper takes `phone-landscape:square-fit` (four-player also drops its `-mx-2.5`); move chips get a 44px minimum width. Portrait must stay pixel-identical: check with the screens parity.

## Link preview

`chessPreview` (`convex/chess/preview.ts`): the board as rows of piece codes (`wK`, `four/redK`, `four/deadQ`; `null` off the cross, `""` empty), whose move it is, and four-player points. Real-time previews simulate the snapshot plus commands up to now. `og/games/chess.mjs` draws it; check with `node e2e/og-preview.mjs` (writes `e2e/.state/og-match.png` for a classic game, `og-four.png`, and `og-chess.png` for the game's page).

## Driving it in tests

- Start games with `admin().action(anyApi.testing.startMatch, { mode: "chess:classic" | "chess:realtime", a, b, settings? })` (a is white) or `testing.startFour({ mode: "chess:four" | "chess:realtime4", players, settings? })` (red, blue, yellow, green in order). They insert an active game directly: no start hook, so no opening pushes or first reminder. Use the lobby (`Find a game`, `Join a game`, challenges) when that's what's under test.
- `realtimePair(phones, { cooldown?, speed? })` gives two phones on a started real-time game, both `data-playing`. Fast settings (`{ cooldown: 2, speed: 15 }`) make multi-move tests quick.
- Squares are `[data-square=e4]` (four-player `a..n`, `1..14`); tap `from` then `to` (`tapMove`). Targets are `[data-target]`, the draft's ghost `[data-ghost]`, real-time premove arrows `[data-premove]`. Real-time pieces are placed by transform, so check a piece by comparing its box with the square's (`pieceOn`, `restsOn`, `readyOn` in the specs). The turn-based board's `data-disabled` says it isn't taking moves.
- Confirm is `getByRole("button", { name: /^Confirm/ })` (its name includes the move), Cancel `{ name: "Cancel", exact: true }`. Moves line `getByLabel("Moves")`, current move `[aria-current=step]`.
- Server state: `getMatch(id)` (`state.moves`, `state.fen`, `state.startAt`), `testing:rtCommands({ id })` for the stored real-time commands.
- Wait for the countdown with `[data-countdown]` and for play with `[data-playing]`; for a piece in flight `[data-status=moving]`.
- Landscape: `page.setViewportSize(LANDSCAPE)`, `simulateSafeAreas(page, SAFE_LANDSCAPE)`, then `ready` and `expectFitsScreen` (`e2e/landscape.ts`).

## Gotchas

- `chess:finalize` looks dead; it isn't removable without checking no scheduled job references it.
- `RealtimeState.commands` and `State.pace` being optional are for old games; don't make them required.
- `seatColors` order is turn order: `["w", "b"]` and `COLORS4`. `commandOrder`'s color ranks must stay as they are or old games replay differently.
- The four-player client asks `rtState` only to know who's out (`useRtOut`), from the settled snapshot, so it trails live play by under a second.
- Board marks that don't follow the theme live in `src/games/chess/palette.ts`; the squares follow the theme through `--board-light`/`--board-dark`, target dots and shadows use `shade`.
- The real-time engine is imported by phones, the server and `preview.ts`: keep it free of anything but `./four/board.ts`.

## Tests

- `npx vitest run convex/chess`: the real-time engine (`realtime.test.ts`: moves, collisions, knights, castling, premoves, promotion, both kings, no progress, `predictEnd`, continuing from snapshots; `realtime4.test.ts`: the four-player variant), the four-player rules (`four/classic.test.ts`, including `fourBoards` against a slow replay and its speed), and the server (`four.test.ts`: challenges, queueing, moves, resign and timeout carrying on, standings and Elo, rematch seats, the reminder chain).
- `npm run test:e2e -- chess four`: `e2e/chess.spec.ts` (the push gate, a classic game through the queue with drafts, ghosts, drag, resign and the leaderboard, Back from a cold open, history, checkmate, promotion, challenges from Home, real-time countdown and simultaneous moves and premoves, king capture ending the game through the scheduler, your own move never jumping back, the header, mashing Find a game, pieces resting before the start, rematches, spectators, landscape) and `e2e/four.spec.ts` (mode cards, a challenge accepted three ways, a full four-player game with resignation and history, a four-way rematch, the queue, real-time four-player, the cold-start deep link). One real-time test is timing-sensitive: rerun a failure before calling it real.
- `SCREENS=1 npm run test:e2e -- chess-screens` writes `e2e/.state/screens/chess-*.png`; compare with `node scripts/screens-diff.mjs <before> <after> <diff>` after any visual change.
- `node --experimental-strip-types e2e/load.mjs` plays real-time and classic games over real websockets and reports move latency.
