---
name: new-game
description: Step-by-step guide for adding a new game to Group 53 Games, from its modes and server file to its screen, link preview, tests and feature-map skill. Use only when Shlok runs /new-game.
disable-model-invocation: true
---

# Adding a game

AGENTS.md (Games framework, Design system, Testing) is the overview, and the `framework` skill covers matches, turns, pushes and the test harness in depth. Read both first. This guide is the order to build a game in and every place it has to be registered.

A game is a package. Its parts live only in these places, and games never import each other:

| Where | What |
| --- | --- |
| `convex/<game>.ts` | Its Convex functions (moves, queries, timers) and its `GameHooks`. Never move or rename one once shipped: function names are file paths that scheduled jobs and phones still running the old build call. |
| `convex/<game>/**` | Pure modules shared with phones: the engine, `modes.ts`, `preview.ts`, `schema.ts`, text helpers. No `_generated/server` (types from `_generated/dataModel` are fine), no `convex/lib`, no browser APIs. |
| `src/games/<game>/**` | Its screen, art, rules text, summary, palette. |
| `e2e/<game>*.spec.ts` | Its e2e specs (and `<game>-screens.spec.ts` for review shots). |
| `og/games/<game>.mjs` | Its link preview card. |
| `.agents/skills/game-<game>/SKILL.md` | Its feature map. |

Shared code reaches a game only through the registries below. Each registry is typed by `GameKey`, so once the game is in `GAMES`, leaving it out of any typed one fails `npx tsc -b`.

Call the game `<game>` (lowercase, one word: it's the mode prefix, the URL path and the file names) and its modes `<game>:<slug>`.

## 1. Modes and settings: `convex/<game>/modes.ts`

Export `<GAME>_GAME` and `<GAME>_MODES`, typed from `convex/modeKit.ts`:

```ts
import { moveTime, type GameDef, type ModeDef, type Setting } from "../modeKit";

export const WORDLE_GAME = {
  name: "PvP Wordle",
  path: "/wordle",
  reasons: { solved: { label: "Solved it", push: "solved it", won: "by solving it first" } },
} as const satisfies GameDef;

export const WORDLE_MODES = {
  "wordle:classic": { game: "wordle", name: "Classic", title: "PvP Wordle", kind: "async", players: 8, minPlayers: 2, board: "five", slug: "classic", blurb: "...", settings: [moveTime(24)] },
} as const satisfies Record<`wordle:${string}`, ModeDef>;
```

Then register it in `convex/modes.ts`: add `<game>: <GAME>_GAME` to `GAMES` and spread `...<GAME>_MODES` into `MODES`. Keep `as const` on both, so `GameKey` and `ModeKey` stay literal unions. Everything else in `modes.ts` (settings helpers, paths, `reasonOf`) is shared and needs no change.

What the fields mean:

- `kind`: `async` takes turns over hours (a push when it's your move, a reminder every 8 hours); `realtime` needs everyone on screen at once.
- `title` is how the mode reads in a sentence ("Your 4-player chess game is on"). `name` is the mode's one name everywhere (Classic, Live).
- `players` is the most seats, `minPlayers` how many it needs. Equal: the game starts by itself once full. Different: the host taps Start in the lobby (`matches.startGame`), and it also starts by itself when every seat fills.
- Optional: `draws` (two-player only; players can offer a draw), `wants` (the crew push reads "Chris wants <wants>"; defaults to `title`), `reasons` (endings worded differently in this mode, over the game's).
- **Endings.** `matches.result.reason` is a key in the mode's `reasons`, then the game's, then the shared ones (`resign`, `timeout`, `last_player`, `agreement`). `label` is the result on screen, `push` ends the result push ("Classic chess vs Chris: checkmate."), and `won`, only where it reads well, follows the winner's name in a link preview ("Chris won by checkmate").
- **Settings** (`Setting`): values are always numbers, so they compare and store simply. `short` says a changed value in a few words, `{}` standing for the option's label ("9 tiles"). `kind: "seed"`: any whole number up to `SEED_MAX`, 0 (the default) meaning roll one when the game's made (`withSeeds` in `matches.create`; a rematch rolls a new one; never remembered on the phone). `kind: "mask"`: any of the options, at least one, stored as a bit per option with `value` the bit (`maskOn`, `everyOptionOn`). `when: { key, is }`: only shown, and only matters, while another setting has one of those values.
- `matches.settings` stores only what differs from the defaults (`changedSettings`). Always read with `settingsOf(mode, match.settings)`: anything unknown or not one of the options falls back to the default, so old games and hand-made requests still read sensibly. Changing a default changes every stored game that left it alone.
- Async move timers: `moveTime(defaultHours, allowNoLimit)` gives the shared "Time to move" setting; `matches.remind` counts 8-hour reminders against it and calls the `timeout` hook when it's spent.
- `modes.ts` is imported by the client and the server, so nothing in `<game>/modes.ts` may import anything heavy or server-only.

## 2. Tables: `convex/<game>/schema.ts`

Only if the game needs its own tables. Export `<game>Tables = { ... }` of `defineTable(...)` and spread it into `defineSchema` in `convex/schema.ts`. Prefix table names with the game (`golfWorlds`, `landlordLog`).

- Game state goes in `matches.state` (everyone can read it), hidden information in `secrets`, plans in `drafts`; only add tables for things that don't fit (a command log, history, per-player records).
- It's a live database: once shipped, never rename a table, a field or an index, never retype or drop a field without a migration, and make new fields `v.optional`.
- Anything written often costs disk (Convex keeps every old version of a row for `DOCUMENT_RETENTION_DELAY`, 3 days): prefer inserting rows over rewriting one, and work out what a day of writes costs.
- `testing:reset` wipes every table in the schema by itself. `testing:removeTestData` doesn't: if a table has rows owned by players (`userId`, `by`), add it to its lists in `convex/testing.ts`.

## 3. The engine: `convex/<game>/engine.ts`

The rules as pure functions over plain data, shared by the server and phones: `newGame(...)`, `step(state, seat, action)` or similar, and the queries the screen needs ("can I do this, and if not why"). Seats are indexes in turn order.

- No Convex, no `Date.now()`, no `Math.random()` inside the rules: pass time and randomness in (a seeded rng, a shuffled deck from the server). Real-time engines must be deterministic bit for bit across V8 and JavaScriptCore: no `Math.sin/cos/atan2/hypot/pow/exp/log` or `**`; use `convex/golf/dmath.ts`.
- The public state the engine returns goes in `matches.state`; anything a player mustn't see (the deck, the bag, someone's hand) is returned separately and stored as a secret.
- Text for pushes and logs that phones also show goes in `convex/<game>/text.ts`.

## 4. The server: `convex/<game>.ts`

Built on `convex/lib/`, so the file is only the game's rules:

- **Moves** use `onTurn(ctx, id, { game: "<game>" })` (or `seated` for actions off turn), apply the engine, then `passTurn(ctx, match, { state, turn, by, push, timer?, patch? })`. `passTurn` saves the move, bumps `moveCount`, pushes the next player (unless they made it) and arms their clock. A move by someone off turn that leaves the turn in place (a resignation) changes none of that, so the player to move keeps their reminder and strikes. Moves must carry what the player saw (a hand number, a move count) when a stale tap could land on a newer state, and refuse it.
- **Secrets**: `readSecret`, `writeSecret`, `mySecret` (`convex/lib/secrets.ts`): per player (`userId` set) or the game's (none). Only ever returned to its owner. Never put hidden information in `matches.state`.
- **Drafts**: a player's plan for their next move, saved as they go so it's there when they come back (`writeDraft`, `myDraft`, `clearDraft`). Private, but `count` lets others see someone's planning.
- **Pushes**: `notifyMatch(ctx, userId, match, { title, body })` for anything about a game (it fills in the path and the per-match tag so pushes replace each other). When something happens to a player, push them. `notify` already skips someone looking at that URL.
- **Ending**: `finishBySeats(ctx, match, groups, reason)` (places as groups of seat indexes, best first; ties share a group) or `finish`; ratings, standings and the result pushes are shared.
- **Paths**: `matchPath(match)`, `acceptPath(match)`, `modePath(mode)`. Never hard-code `/<game>/...`.
- **Real-time**: never put per-move simulation, or writes another player also makes, in the move mutation. A move is one insert into a command table stamped with the tick it was made on; a scheduled tick settles a snapshot; clients replay snapshot plus commands (see `convex/chess.ts` and `convex/golf.ts`).
- Every mutation that creates something is idempotent (double taps, retries).
- Crons go in `convex/crons.ts`, HTTP routes in `convex/http.ts`.

### Hooks: `<game>Hooks: GameHooks`

Export them from `convex/<game>.ts` and add them to `hooksFor` in `convex/games.ts`. `matches.ts` calls them and never names a game. `hooksFor` builds its table inside the function on purpose: game files import `matches.ts`, which imports `games.ts`, so at module load the hooks may not exist yet. Never move that table to the top level.

- `seats(mode, n)`: seat colors in turn order (`SEAT_COLORS.slice(0, n)` from `convex/lib/seats.ts` when one color each is enough).
- `start(ctx, match)`: every seat is filled and colored; set up `state`, whose turn it is, and the first pushes (`startPushes`, which sends none on a rematch). Write the secrets here.
- `resign(ctx, match, userId)`: decide whether play goes on without them or the game ends.
- `timeout(ctx, match, userId)`: an async move timer ran out on the player to move. `timeoutWarning` ends the last reminder: "Move in the next 8 hours <timeoutWarning>". A game with no limit makes `timeout` a no-op and the warning "".
- `unstarted(match)` (real-time only): still waiting for everyone to open the board; `matches.sweep` calls it off after 3 minutes.

## 5. The link preview: `convex/<game>/preview.ts` and `og/games/<game>.mjs`

`convex/<game>/preview.ts` exports `<game>Preview: PreviewBoard` (type from `convex/previews.ts`): `(ctx, match, players) => { seats, points, board, toMove, <game>: {...} }`. Add it to `BOARDS` in `convex/previews.ts`. `previews.match` is read by the og service with the admin key, signed out, and its output is as public as a Discord unfurl: only what everyone at the table can see (the board, stacks, the pot), never anyone's cards or rack. `toMove` is a seat color or null.

`og/games/<game>.mjs` exports an object: `key`, `paths` (the game's page paths), `page` (`title`, `description`), `card` (the tile card for the game's page: `word`, `states`, `tileSize`, `blurb`, optional `cta`, `blurbWidth`), `modeTitles` (mode key to how it reads on the card), `text(m, { names, mode, title, seats })` returning `{ title, status }` (`m.status` waiting, finished or active; cancelled is shared), `board(m, { side, crowded })` returning a satori tree, and optionally `crowded(m)`, `seatScore(m, seat)` and `version(m)` (whatever changes the picture beyond status, move count and board, so Discord refetches). Shared pieces are in `og/layout.mjs` (`h`, `img`, `svgDataUrl`, `tiles`, `avatar`, `frame`, `renderPng`) and `og/match.mjs` (`moverName`, `moverOf`, `seatsSoFar`, `scoreText`, `LIVE_NOW`). Every color goes in `og/palette.mjs` under the game's own key; no color literals in the game file. Register the game in `og/server.mjs`: `MATCH_GAMES` (match cards) and `PAGE_GAMES` (its page). `og/Dockerfile` copies `*.mjs` and `games/`, so new files there need nothing more. satori has no conic gradients, no arrow or suit glyphs, and can't decode GIFs: draw symbols as SVG paths.

## 6. The screen: `src/games/<game>/`

Add the game to `GAME_UI` in `src/games/index.tsx` (`Record<GameKey, GameUI>`; routes, the Games card, the hub and mode pages come from it):

- `key`, `path`, `name` (from `GAMES`), `blurb` (the Games card).
- `banner()`: the card art, playing in once (about a second, no idle loop). `modeArt(mode)`: each mode card's art.
- `rules(mode, settings)`: how to play as these settings have it, one string per rule (`src/games/<game>/rules.ts`).
- `Game`: the screen for a started or finished game, `{ match, meId }`. A big screen goes through `downloadedWhenOpened(() => import("./<game>/<Game>Game"))` so it only downloads when a game opens.
- `summary: GameSummary` (`src/games/<game>/summary.ts`): `lastMove(match)` for list rows ("Nf3", "QUIZ 42"), `points(match, seat)` for standings in games that keep score (null otherwise), `pointsUnit` ("pts", "chips", "strokes"). Import only engine types here, never components.
- Optional: `fullscreen(match)` (the game draws its own top bar and takes the whole screen; `MatchScreen` leaves out the nav bar), `extra()` (more on the game's page under the modes), `setup(...)` (under a mode page's settings and in the lobby; `editable` only for the host).

A game announced before it's built has a coming-soon card in `SOON` (PvP Wordle does, and a page-only `og/games/wordle.mjs`): drop it from `SOON` once the game's in `GAME_UI`, and give its og module the match parts.

The lobby, settings picker, result, standings, rematch, resign confirmation, game menu (`GameMenu`), mode pages and hub are shared; don't rebuild them. Build the screen from the design system (AGENTS.md, Design system): `GameFrame` and `DockNote` (or `FullscreenStage`, `FloatingTopBar`, `FloatButton`, `FloatPill` for fullscreen), `TurnText`, `PlayerAvatar`, `Button`/`IconButton` (no naked `<button>`), `AsyncButton`/`usePending` for every async tap, `ConfirmButton` for anything destructive, `Sheet` for small focused things, `Segmented` for a few options. Theme tokens only; colors that must not follow the theme (a physical board, a canvas) go in `src/games/<game>/palette.ts`. Phones first: 44px tap targets, 56px primary actions, heights under the board fixed so nothing shifts it, nothing sticky at the top, reduced motion respected. Make it live: other players' moves, presence ("is on it") and animations triggered by someone else's action, because every Convex query is a live subscription. Sounds go through `sfx(...)` from `src/sound.ts`, never louder than the pack's own.

## 7. Tests

All of these are required before the game ships.

- **Engine unit tests**, `convex/<game>/engine.test.ts`: every rule and edge case, pure. For a game with bots, a simulation that plays hundreds of whole games under every mix of settings and checks the invariants after every action (see `convex/landlord/sim.test.ts`).
- **Server tests**, `convex/<game>/server.test.ts` (convex-test, `setup()` and `signedIn()` from `convex/test.setup.ts`, fake timers): a game through `matches.queue` and `matches.startGame` (which run the real start hook), moves, refusing moves off turn and stale taps, secrets never in `matches.state` and only returned to their owner, pushes (pending `push:sendToUser` jobs), timeouts and reminders, resigning, the result and standings, and the preview (`internal.previews.match`). `convex/test.setup.ts` globs `./**/*.ts`, so files in the package are found without changes.
- **e2e on two phones**, `e2e/<game>.spec.ts`: the Games card and mode page with its settings, a game opened with `openLobby` and filled with `fillLobby` (never `testing:startMatch`, which builds chess only), moves on one phone appearing on the other, both phones agreeing, the result. Wait on what you can observe (`ready`, `holdsStill`, `settled`, `expect.poll` on `testing:getMatch`, `data-*` attributes the screen exposes), never on time. Add `testing:*` helpers in `convex/testing.ts` when a test needs a known setup (`setRack`, `landlordBots`); each starts with `assertTestDeployment()`.
- **Landscape**: check the screen with `e2e/landscape.ts` once it exists.
- **Review screenshots**: `e2e/<game>-screens.spec.ts` behind `SCREENS=1`, dark and light, and look at them.
- **Link preview**: `node e2e/og-preview.mjs` (add the game to it) and look at the card.

## 8. The feature map: `.agents/skills/game-<game>/SKILL.md`

Frontmatter `name: game-<game>` and a `description` saying when to use it. Then, in plain dense prose: what the game is and its modes; the file map across `convex/`, `src/games/`, `e2e/`, `og/`; the rules and invariants that must never break; each user-facing feature with how to reach it as a user, how to drive it in tests (fixtures, `testing:*` helpers, `data-*` attributes, `window.__` hooks) and what proves it works; the gotchas; the tests and how to run them. Add the game's paragraph to AGENTS.md too.

## 9. Verify and ship

`npm run verify` runs every check (format, lint, dead code, typecheck, unit tests, build, the sidecar's tests, e2e); the pre-push hook won't push a commit that hasn't passed it, so commit first. The rules lint enforces: no comments except `// platform: ...` for constraints forced by something outside our control, theme tokens only, the 7 type sizes and the radius steps, no naked buttons or avatar images, no cards inside cards, no `waitForTimeout`. Ship backend before frontend: additive changes are safe in one deploy; removing or renaming a function, or making an argument required, needs the frontend that stops using it shipped first.
