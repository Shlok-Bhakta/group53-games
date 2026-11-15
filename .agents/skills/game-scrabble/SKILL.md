---
name: game-scrabble
description: The Scrabble package's feature map. Use for any Scrabble work: its modes and settings, the engine wrapper around bingo-engine, the 21x21 board and Letter League rules, the word list, plans and face-down tiles, the fullscreen board (zoom, pan, view pads, landscape), drag and drop, the show of a word landing, its link preview and its tests.
---

# Scrabble

AGENTS.md (Scrabble, and the Scrabble screen) is the overview; the `framework` skill covers matches, turns, secrets, drafts and the harness; the `ui` skill covers `FullscreenStage`, `FloatingTopBar` and landscape. This is what you need on top of them to change Scrabble.

## Modes

Two modes in `convex/scrabble/modes.ts` (`SCRABBLE_GAME` with the endings `went_out`, `passes`, `rounds`; `SCRABBLE_MODES`), both 2 to 8 seats with `minPlayers: 2`, so the host taps Start (or it starts itself when all 8 seats fill):

| Mode | Kind | Clock |
| --- | --- | --- |
| `scrabble:classic` "Classic" | async | `moveTime(0)`: no limit by default; when set, the last 8-hour reminder skips the turn (`timeout` hook, `timeoutWarning` "or we skip your turn") |
| `scrabble:live` "Live" | realtime | Turn timer (`turnTime` 30/60/90/120/180 s, default 90): `state.deadline`, and `scrabble:turnTimeout` is armed through `passTurn`'s `timer` |

Shared settings: `rack` (Tiles in hand 5/7/9, default 7; a bingo is always the whole rack), `bag` (Tiles in the bag: 50 "Half", 100, 150, 200 percent of the English bag), `board` (15 or 21), `rules` (0 Scrabble, 1 Letter League), `rounds` (0 no limit, 5, 10, 15). `rulesOf(settings)` turns them into the engine's `Rules` (`size`, `rack`, `league`).

## File map

- `convex/scrabble.ts`: the Convex functions and `scrabbleHooks` (registered in `convex/games.ts`). Never rename: `scrabble:play`, `swap`, `pass`, `rack`, `check`, `saveDraft`, `draft`, `planning`, and the internal `turnTimeout` (scheduled). `playTiles(ctx, id, tiles, as?)` is exported for `testing:playAs`.
- `convex/scrabble/engine.ts`: pure, shared by server and phones (validation and the live score preview). `convex/scrabble/dictionary.ts`: `isWord`, server only. `convex/scrabble/words.ts`: the generated word list (lint ignores it). `convex/scrabble/modes.ts`, `convex/scrabble/preview.ts` (`scrabblePreview` for `BOARDS`).
- `src/games/scrabble/`: `ScrabbleGame.tsx` (the screen, the dock, the board's measured view, the sounds for other phones' moves, the BINGO overlay), `Board.tsx` (`ScrabbleBoard`: squares, tiles, plans, ghosts, puffs, score bubbles, gestures), `Rack.tsx`, `DockActions.tsx` (`BagButton`, Swap, Play, Shuffle/Recall), `TopBar.tsx`, `ScrabbleMenu.tsx` (scores, words played with definitions, Resign), `BagSheet.tsx`, `BlankPicker.tsx`, `DragGhost.tsx`, `Tile.tsx` (`LetterTile`, `PREMIUM_STYLE`), `useScrabbleDraft.ts`, `useTileDrag.ts`, `usePreview.ts`, `palette.ts` (the fixed 2L blue and white ink on seat colors), `art.tsx` (`ScrabbleBanner`, `ScrabbleModeArt`), `rules.ts` (`scrabbleRules`, How to play from the settings), `summary.ts` (`scrabbleSummary`: "QUIZ 44" or "swapped" in lists).
- `og/games/scrabble.mjs`: the link preview (board with premiums, tiles edged in seat colors, scores, last word); colors under `SCRABBLE` in `og/palette.mjs`.
- Tests: `convex/scrabble/engine.test.ts`, `convex/scrabble/server.test.ts`, `e2e/scrabble.spec.ts`, `e2e/scrabble-screens.spec.ts`. The sound and music tests live in `e2e/scrabble.spec.ts` too (they were written with Scrabble, but cover `src/sound.ts` for the whole app).

## State and secrets

- `matches.state` is `ScrabbleState`: `size`, `tiles` (`Placed`: x, y, letter, `blank?`, `seat`, `turn` = index of the move that put it down), `scores`, `racks` (counts only), `bag` (count only), `turn` (seat; -1 once over), `round`, `scoreless` (turns in a row nobody scored), `out` (resigned seats, in order), `moves` (`Move`: seat, kind `play|swap|pass|timeout|resign`, score, `words?`, `bingo?`, `count?` tiles laid or swapped, `at`), `deadline` (live only), `adjust?` (end-of-game leftover adjustments).
- Secrets: each player's `{ rack: Tile[] }` (`Tile`: id, letter, "?" for a blank) and the game's `{ bag: string[], nextId }`. Tile ids are handed out by `draw` from `nextId`, so every tile ever drawn has a unique id. Never put letters of a rack or the bag in `matches.state`; `server.test.ts` checks the public view has no `letter`, `rack` or bag array.
- Drafts: `{ placed: Placement[], order: number[] }` with `count = placed.length` (capped at 21 each). `clearPlan` after a play or swap empties `placed` and keeps the rack order for the tiles still held.

## Rules and invariants

- **The engine wrapper.** The rules (legal plays, which words a play forms, scoring with premiums, blanks, the 50-point bingo, letter values, the bag) come from `@bglowacki/bingo-engine` (MIT, pinned to 0.1.0) set up for English (`ENGLISH_ALPHABET`, `SCRABBLE_CLASSIC_RULES`). One engine per `size:rack` is cached in `engineFor`, with `rackSize` and `bingoSize` both the rack setting, and a dictionary that accepts everything: the engine only judges shape. `evaluate(board, placement, rack, rules)` turns our free-form placements (tiles on any squares) into the engine's line-plus-tiles form: it refuses tiles not in the rack, off the board, on taken squares, a blank without a letter (`/^[A-Z]$/`), the same tile twice, and two lines; a single tile reads across if it touches a tile left or right, otherwise down; it fills the gap tiles from the board (a hole is "Leave no gaps"), then `validatePlacement` and `scorePlacement`. The engine's reasons become our sentences in `REASONS`. One-letter "words" are dropped; the main word (the one through every new tile) is moved first, and the phones use its last cell for the score bubble and its text for the Play button.
- `VALUES` (points per letter, "?" the blank), `BINGO`, `bagLetters(percent)` (each letter's count scaled and rounded, never below one: half a bag is 54 tiles), `shuffle(xs, random)`, `rackValue`, `nextSeat` (skips `out`), `standings` (by score, ties share a place, resigned seats last with the last to leave placing higher).
- **Boards.** `Premium` codes: `T` triple word, `D` double word, `t` triple letter, `d` double letter, `*` the centre (a double word), `.` plain. The 15x15 layout is read from the engine's `SCRABBLE_LAYOUT_15X15`. The 21x21 is ours: `OCTANT_21` lists one eighth as distances from the centre (a >= b) and is mirrored eight ways; it's handed to the engine as its `BoardLayout` (`engineLayout`, centre start). `layout(size)` falls back to 15. The word list allows up to 21 letters for the big board.
- **Letter League** (`LEAGUE` in the engine; add further Letter League rules there): `stickyBonuses`, "Wild" scoring: a premium stays with the tile on it, so every later word through that tile scores it again (add an S to a doubled word and it doubles again). Scored by `stickyScore` from the engine's per-word cell breakdown (every cell's premium counts, old or new; blanks score 0), the bingo bonus added on top. Official scoring is the engine's own total.
- **Words.** `convex/scrabble/words.ts` is ENABLE (public domain) plus qi, za, ok, ew, lowercase, one per line, regenerated by `scripts/gen-words.sh`. Server only: never import it from `src/` (it's megabytes). `isWord` builds a `Set` on first use and keeps it for the isolate's life. `play` refuses unknown words ("X isn't in the dictionary." / "Not in the dictionary: X, Y."). Phones ask `scrabble.check(words)` (signed in only, at most 30) for the live preview.
- **Turns.** `advance` records the move, bumps `scoreless` (reset by any scoring play), and starts a new round when the turn passes the first seat still in. It ends the game when `scoreless >= 2 x players still in` ("passes") or past the last round ("rounds"); otherwise `passTurn` pushes the next player "<who> played QUIZ for 44" / swapped / passed / resigned / ran out of time, with the live timer or the 8-hour reminder. Going out (rack empty with the bag empty) ends it as "went_out".
- **End.** `endGame`: every seat still in loses its leftover tile values; whoever went out gains everyone's. Then `finishBySeats` with `standings`, so Elo is `multiElo`.
- **Swap** needs at least as many tiles in the bag as you swap ("Only N left in the bag." / "The bag is empty."); the new tiles are drawn before the old go back in, then the bag is reshuffled. Swap with nothing picked is Pass on the phone.
- **Resign** puts your tiles back in the bag (reshuffled), adds you to `out`, and play goes on; with fewer than two left it ends as `last_player`. If it was your turn the turn moves on; if not, the state changes without `passTurn`, so the player to move keeps their clock.
- Stale timers do nothing: `turnTimeout` checks `moveCount`.

## Features

### Playing a word
User: tap a rack tile (it lifts and jiggles), then a square; or drag it. Tap a placed tile to send it home; drag it to move it; drag over the rack to reorder. Play names the word and score ("Play CAT for 10"); it's disabled while the preview is checking or a word isn't real ("AZR isn't a word", in red, the tiles shake). Out of turn the button reads "Planned: CATS, 6". Blanks open `BlankPicker` ("Blank tile plays as").
- `ScrabbleGame.putDown` refuses taken squares; a blank without a letter opens the picker (a blank moved again keeps its letter). `usePreview` runs `evaluate` on every change and `scrabble.check` on its words; `tone` is idle / ok / bad and colors the plan's outlines and score bubble (`--tile-green`, `--tile-hit`, `--primary`); a layout turning bad bumps `shake` and plays "invalid".
- Play failing on the server shakes too, then rethrows so `AsyncButton` toasts the error.
- Test: `place(page, letter, x, y)` and `tapSquare` in `e2e/scrabble.spec.ts` find a square on screen from the board layer's transform (`squareOnScreen`); rack tiles are buttons named "Tile C" / "Blank tile" (`aria-pressed` when picked or marked for swapping) inside `getByLabel("Your tiles")`; the board is `getByRole("group", { name: "Board" })`.

### Drag and drop (`useTileDrag.ts`)
A pointerdown on a rack tile or a plan tile (`[data-draft]`, caught by the board before panning) starts tracking on `window`. Under 6px it's a tap (rack: pick up/put down; board: recall). Past that the `DragGhost` (portaled to `body`, moved straight in the DOM, leaning with the drag and jiggling) follows the finger, `board.cellAt` gives the free square under it (`target`, outlined), and off the board `rackSlotAt` gives a rack slot (within 24px above or below the rack; the others part to show it). Drop on a square places, on the rack reorders (and recalls a board tile). A cancel drops nothing. `cellAt` only answers inside the open part of the board (see view pads), so a tile let go over the dock lands in the rack, never on the squares under it.
- Test: "tiles drag from the rack onto the board and back" moves the mouse in 8 steps and checks `[data-draft][data-cell="7,7"]`.

### Plans and face-down tiles
Plans work any time, survive reloads and show on any phone. `useScrabbleDraft` takes the server's draft once, when the rack and draft queries have both loaded (`hydrated`, set during render), then saves `{ placed, order }` 120ms after each change (quick, so other phones see your face-down tiles move almost as you do); it never saves the untouched empty draft. `placed` filters out tiles no longer in the rack, squares now taken, off-board squares and duplicates. A planned square someone else plays on sends the tile home with a toast ("Chris played where you'd planned...") and cleans the draft; the server never edits other players' drafts.
- `scrabble.planning` returns, for everyone else planning, `userId`, `count`, `at` and `cells` (squares only, never letters or tile ids). Only whoever's turn it is shows on other boards: `[data-ghost="x,y"]`, tile backs in their color (no text), appearing and vanishing with spring and a puff of six dots (`Puffs`), and the "ghost" sound when they move. The menu shows "planning N" with a pencil next to anyone with a plan.
- Test: e2e checks `[data-ghost]` count, `[data-ghost="7,7"]`, empty text, and zero after the play; `server.test.ts` checks `planning` never leaks letters.

### The board: zoom, pan and the view pads (`Board.tsx`)
`px` is the board's side at scale 1 (the smaller of the stage's width and height), `base = px / size`. Scale runs from 1 to `MAX_CELL` (64px squares); it opens at `START_CELL` (44px) centred on `focus` (the middle of everything on the board plus your plan, or the centre star). The start is applied once per `px:size:width`, so a rotation recentres, but the dock changing height (swap mode) never jumps the view. One finger pans (after 8px), two pinch around their midpoint, a double tap (within 320ms and 30px) zooms to a square or back out (off while a rack tile is picked, so the second tap places it), and the wheel or trackpad zooms or scrolls on desktop. Transforms go straight to the layer's style (`translate3d` plus `scale`, and `--s` so bubbles keep their size); React never re-renders for a pan.
- **View pads.** In a game the board fills the stage and runs under the floating bars; `view` carries `padTop`, `padRight`, `padBottom`, `padLeft`: what covers each edge. `clamp` lets the board move until its edge meets the edge of the open part, and centres it in the open part when smaller; `centredOn`, the "already in view" check for a new word, and `cellAt` all use the open part. `boardView` in `ScrabbleGame.tsx` measures them: portrait, the top bar covers the top (`bar.offsetTop + height + 6`) and the dock the bottom; landscape, the top bar is a rail (taller than wide), so it covers the left (`offsetLeft + width + 6`), and the dock covers the bottom and whatever is right of it (the safe area). A `ResizeObserver` on the stage, the dock and the bar re-measures.
- A word landing out of view glides to it (`reveal`, keyed on the move count) unless a finger is on the board.
- Finished games show the whole board as a square above the result (no `view`, no pads, `rounded-sm`); in landscape it's capped to the screen's height.

### Landscape
`FloatingTopBar` turns itself into a left rail (back on top, the pill, the menu at the bottom). The stage sets `--rail-width` (12rem): the pill takes that width, and the dock starts right of it (`left: max(12px, safe-left) + rail + 8px`, `right: max(12px, safe-right)`, bottom padding `max(10px, safe-bottom)`), keeping its portrait layout (rack over the actions). At 852x393 that leaves the board an open part of about 534x226 between the rail and the dock's right edge, above the dock.
- Test: "on its side, the board sits between the side rail and the dock..." in `e2e/scrabble.spec.ts`: `expectFitsScreen`, the rail taller than wide, the dock right of it, the corner squares (0,0) and (14,14) panned into the open part (`panBoard`, `[data-floating-bar]`, `[data-dock]`), then a word played.

### The show
Every phone animates the latest play: its tiles (`fresh`, the cells of the last move) drop in tile by tile in reading order, 70ms apart in time with the play sound's notes, with a bounce, and stay washed in the player's color; the score floats up in the player's color off the last tile (`scored`, white ink from `palette.ts`, since seat colors are the same in every theme); BINGO is spelled in tiles over the board for 2.2s on a bingo. Sounds (`sfx`): "pick", "place", "recall", "shuffle", "play"/"bingo" (with the tile count and score) on your own play; "land"/"bingo" when someone else's word lands, "turn" when it comes round to you (650ms after a play), "ghost", "invalid", "win"/"lose" at the end, "tick" in the last 5 seconds (`Countdown`). Shuffle makes the rack hop; held tiles jiggle; placing springs. The top pill is edged in the color of whoever's turn it is and shows the last move ("Wes: TEN +3").
- `e2e` reads `window.__sfx` (`sounds(page)`) and `window.__music`.

### Menu, bag, live clock
- `ScrabbleMenu` (a `GameMenu`): scores sorted (`aria-current` on whoever's up, "Your turn"/"Their turn"/"N tiles"/"Resigned"), "N in the bag, round R", Words played (tap a word for its definition from dictionaryapi.dev, cached per word for the session; "No definition found, but it's in the word list."), then the shared settings, how to play, Share, and Resign (`ResignButton`, with what happens to your tiles).
- `BagSheet`: "N in the bag" and every letter you haven't seen (the full bag for the settings minus the board and your rack), greyed at zero; 27 entries with the blank.
- Live: `Countdown` in the pill (`aria-label` "N seconds left"); running out skips the turn.
- Watching or out: the dock shows the bag and "You're watching." / "You're out. Stick around to see who wins."

## Gotchas

- Rack tiles hold their `-translate-y-1.5` lift with an inline `transition: translate 120ms`, overriding the Button's own transition. The rack is a fixed 62px grid with one column per rack slot; empty slots pad it so tiles don't stretch; a 9-tile rack in portrait draws tiles about 34px wide.
- `squareOnScreen` and the screens spec assume a 15x15 board (`layer.offsetWidth / 15`).
- `testing:setRack` gives tiles random large ids (not 0, 1, 2), so look them up with `testing:rackOf` before `testing:playAs`. In unit tests, `server.test.ts`'s own `setRack` gives ids 0, 1, 2... in order.
- Live games are `realtime` kind, so a lobby there expires after 10 minutes like every real-time lobby.
- The physical tile (`stile`, `stile-value`, `stile-blank` in `style.css`) and the face-down backs use the static `--color-tile-cream`, `--color-tile-cream-shade`, `--color-tile-rim` and `--color-tile-blank-print`; premiums use theme tile tokens except 2L, which is fixed blue mixed into `--card`.
- `scrabble.saveDraft` and `scrabble.planning` check the mode starts with `scrabble:`; `saveDraft` quietly ignores finished games and non-players.

## Tests

- `npx vitest run convex/scrabble`: the engine (both layouts, the bag and its scaling, the centre star, legal and illegal shapes, cross words, a lone tile read either way, blanks, bingos on bigger racks, the same tile twice, Letter League scoring, `nextSeat`, standings, `isWord`) and the server (the lobby, the eighth player starting it, challenges, stored settings, a smaller bag, secrets never leaking, plays, the dictionary, rounds, passes, going out, swaps, plans and `planning`, live and async time limits, resigning in bigger games, rematches, pushes and reminders, and the regressions: the same tile twice, swapping more than the bag, blanks and bingos).
- `npm run test:e2e -- scrabble.spec`: the game page and settings, the lobby updating live, two phones playing (plans surviving a reload, face-down tiles, sounds, music, made-up words refused), a Discord link handoff, the fullscreen layout with dock, bag, pass and menu, drag and drop, landscape, the live clock, and the sound and music checks.
- `SCREENS=1 npm run test:e2e -- scrabble-screens`: a four-player game in dark and light (games card, hub, mode page, lobby, game, planning, menu, bag, watching, planning in landscape) into `e2e/.state/screens`. Each shot waits for Convex to settle, no skeletons, fonts, images and `holdsStill`.
- Link previews: `node e2e/og-preview.mjs` renders a live Scrabble card.
