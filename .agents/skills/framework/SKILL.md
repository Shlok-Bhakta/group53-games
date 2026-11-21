---
name: framework
description: The shared game framework and its test harness. Use when working on matches, lobbies, seats, turns, timers, notifications or push, ratings, presence, deep links, or the e2e/test harness (convex/matches.ts, notify.ts, push.ts, ratings.ts, presence.ts, links.ts, hosted.ts, convex/lib/, e2e/fixtures.ts, e2e/backend.mjs, public/sw.js).
---

# Framework

AGENTS.md (Layout, Rules, Testing) is the overview and `new-game` walks through every registry. This is what you need on top of them to change the framework or test through it.

## Match lifecycle

`matches.status`: `waiting` -> `active` -> `finished`, or `cancelled` from `waiting` (and from `active` only by `sweep`).

- **Created** by `queue` (an open lobby) or `challenge` (invited players), both through `create`: settings go through `withSeeds` (a seed left on 0 is rolled now, so everyone sees the one they'll play) then `changedSettings` (only what differs from the defaults is stored). A real-time lobby schedules `expireLobby` after `REALTIME_LOBBY_MS` (10 min).
- **Who may sit** (`canJoin`): not already in, and either invited or the game is `openToCrew` (no invites, or `openSeats`) with an `unclaimedSeats` left. Invited players who haven't answered keep their seat in that count.
- `openSeats` is set when a challenge invites fewer than `players - 1`. Fixed-size games (chess) ping the crew about the leftover seats; flexible ones (`minPlayers < players`) just leave them open with no push, and their challenge pushes don't count empty seats ("with Chris" not "with Chris and 2 more").
- `queue`: returns my own open game of that mode if I have one (a challenge I sent isn't a lobby, so queueing beside it opens one), else joins the oldest open game someone else waits in (with their settings), else opens one with mine and pings the crew.
- `challenge` is idempotent: the same mode and the same set of invitees as one of my waiting games returns that game (double taps, slow networks). It only reads my own waiting games so challenges between other players can't conflict with it.
- **Settings**: the host picks them on the mode page (`useModeSettings`, remembered per mode in localStorage, seeds never) and can still change them in the lobby: `configure` (host only, `waiting` only) merges just the keys sent over the stored ones, so everyone in the lobby sees them change live. Rematches keep them. Read them anywhere with `settingsOf(mode, match.settings)`.
- `addPlayer` pushes everyone already in, and starts the game once full. `startGame` (host only, flexible games, at least `minPlayers`) starts it early; invitees not in yet miss it. The game's own start pushes tell everyone it's on, so `startGame` sends none.
- `decline`: two-player cancels and tells the host (pointing at the mode page). Flexible games drop the invite and tell the host. Fixed bigger games open the seat (`openSeats: true`), tell the players in, and ping the crew, skipping the decliner.
- `leave` (not the host; the host cancels) also drops your invite and opens your seat if the game had invites.
- **`start`** shuffles the seats (rematches keep the order they were given), asks the game's `seats` hook for colors in turn order, patches `status: active, state: null, moveCount: 0`, then calls the game's `start` hook, which sets `state`, `turn` and sends the opening pushes (`startPushes`).
- **`finish`** only acts on an `active` match. It records ratings first (`recordResult`), then patches the result, `endedAt`, and clears `drawOffer` and `turn`, then pushes every player their place and rating swing ("You won (+12)", "You placed 2nd", "You tied for first", "Draw"). `finishBySeats(ctx, match, groups, reason)` takes places as groups of seat indexes, best first (ties share a group); everyone in the first group is a draw.
- **Resign** goes to the game's `resign` hook; games decide whether play goes on (four-player chess, Scrabble, poker) or it ends.
- **Draws**: modes with `draws` only. A second player offering accepts the first's offer (`reason: "agreement"`).
- **Rematches** happen in place on the finished game with everyone looking at it, so no pushes. Every player must say yes within `REMATCH_TTL_MS` (2 min) of the first; leaving the page declines (the client calls `answerRematch` on the way out). When the last yes lands, a new match is inserted with `rematchOf`, seats moved one along (`seatsMovedOneAlong`: in two-player, colors swap), the same settings with any seed rolled again (the old seed stays on the finished game to replay), and started "as seated". Asking again after that returns the new game; after a decline it's a fresh offer.
- **`sweep`** (crons, every few minutes): cancels duplicate challenges (same creator, mode and invitees; the newest stays), waiting games over a day old, real-time lobbies past `REALTIME_LOBBY_MS`, and active games whose `unstarted` hook says not everyone opened the board within `UNSTARTED_CALL_OFF_MS` (3 min).

Invariants: `matches.ts` never names a game (hooks via `hooksFor`, looked up at call time). Hidden information never goes in `matches.state`. `lastActivityAt` is bumped by every lifecycle write (lists sort on it).

## Turns and timers (`convex/lib/turns.ts`)

- Every clock carries the `moveCount` it was set for and does nothing once anyone has moved, so clocks are never cancelled.
- `passTurn(ctx, match, { state, turn, by, push?, timer?, patch?, newDecision? })`:
  - `by` is who moved, or `null` when the game moved for the player on turn (their time ran out).
  - It's `fresh` when the turn changes, the game moved, the player on turn moved, or `newDecision` (poker's next hand dealt to the same player in the same mutation). Fresh bumps `moveCount`, pushes `push` to the next player unless they made the move, and arms their clock.
  - Not fresh (someone off turn resigned and the turn stayed put) changes none of that, so the player to move keeps their reminder and strikes.
  - `timer` (`TurnTimer`: `{ at, fn }`, `fn` an internal mutation taking `{ id, moveCount }`) replaces the 8-hour reminder for live games (Scrabble's `turnTimeout`).
- `armTurn` starts whichever clock without moving; `scheduleReminder(ctx, id, moveCount, strikes)` re-arms `matches.remind`.
- `matches.remind`: fizzles unless the game is active with the same `moveCount` and someone on turn. Strikes count reminders already sent for this move; `timeoutStrikes(match)` is the "Time to move" setting in hours / 8 (0 = no limit). At `strikes + 1 >= limit` it calls the game's `timeout` hook; on the reminder before last the push adds "Move in the next 8 hours <timeoutWarning>". Four-player chess's fixed limit is `TIMEOUT_STRIKES` (6, two days).
- `startPushes(ctx, match, push)`: each player's opening push, or none on a rematch.
- Simultaneous games (everyone acts at once, PvP Wordle) leave `turn` unset and keep `matches.waitingOn` (optional) at everyone they wait on. `awaits(match, userId)` (`lib/seats.ts`) is `turn` or `waitingOn`, and the badge, `attention`, `inbox` and `TurnChip` all use it. Such a game runs its own reminders, since `matches.remind` needs a `turn`; `finish` clears `waitingOn`.

## Lib helpers (`convex/lib/`)

- `seats.ts`: `requireUser` (throws "Sign in first."), `loadMatch` (throws "That game doesn't exist."). In a move, use `seated(ctx, id, { game, modes?, active = true, as? })` or `onTurn` (same, plus "It's not your turn."); `as` acts for a given player instead of whoever's signed in, for test helpers only. `seatOf`, `isPlayer`, `opponentsOf`, `playerWith(match, color)`. `SEAT_COLORS` for games needing one color per seat.
- `secrets.ts`: one row per player (rack, hand) and one with no `userId` for the game (bag, deck). `readSecret(ctx, matchId, userId | undefined, fallback)`, `writeSecret`, `mySecret` (signed-in player's own, null signed out). Only ever return a secret to its owner.
- `drafts.ts`: a player's plan, private except `count` (shown to others as "planning"). `writeDraft(ctx, matchId, userId, data, count)`, `readDraft`, `clearDraft`, `draftsOf` (everyone's in one game, for server use), `myDraft`.
- `people.ts`: `displayName` ("Someone" if gone, for sentences), `namesOf`, `person` (`{ _id, name ("Player"), image }`, to show). `matches.listNames` joins names: "Chris", "Chris and Sam", "Chris, Sam and Alex".

## Push, badge and notifications

- `notify(ctx, userId, { title, body, url, tag? })` skips a player who's online (`presence.lastSeen` within `ONLINE_WINDOW_MS`) with exactly `url` open: they see it live. Otherwise it computes the badge and schedules `push:sendToUser`.
- Use `notifyMatch(ctx, userId, match, { title, body, url? })` for anything about a game: the URL defaults to `matchPath`, and the tag is `matchTag` (`match:<id>`) so a newer push replaces the last on the phone. Lobby pings use `lobby:<id>`. Challenge and lobby pushes point at `acceptPath` so opening them takes the seat.
- `badgeCount` = active games where it's my turn + waiting games I'm invited to and haven't joined. `matches.attention` is the same count for the open app (`useAppBadge`). `public/sw.js` sets it from the push (`setAppBadge`, or clear at 0).
- Test players (`users.isTest`) never get a real push. Off the test backend (`ALLOW_TEST_HELPERS` unset) `notify` returns before any reads; on it, what they'd have got (after the looking-at-it check, with the badge) goes in `testPushes`. A test player creating a game never pings the crew (`pingCrew` checks `isTestUser`).
- `push.ts` runs in Node (web-push) and reads subscriptions through `notifications.subscriptionsFor`; a 404 or 410 from the push service deletes that subscription. Missing VAPID vars log and send nothing. `notifications.subscribe` upserts by endpoint and sends a "Notifications are on" push; `hasEndpoint` lets the client check the server holds this device's subscription.
- Service worker: every push event stays in `waitUntil` until the notification shows (iOS drops silent subscriptions). A tap posts `{ type: "navigate", url }` to an open window and also stores the URL in the Cache API (`group53-pending`, `/__pending-navigation`) for `src/deepLinks.ts`; with no window it opens one.

## The client side of a match

- Routes are generated from `GAME_UI` in `src/App.tsx`: `/<game>` (`GameHub`), `/<game>/mode/:slug` (`ModePage`), `/<game>/:id` (`MatchScreen`, which shows the shared lobby from `src/components/match/` while `waiting`, then the game's `Game`). Every one is wrapped in `NotificationsRequired`, so a link from Discord still enforces push; golf's practice routes and hosted games too (`golfRoute`).
- `?accept=1` on a match URL (`acceptPath`) makes the lobby take the seat on opening (`Lobby.tsx`, `autoJoin`) and drops the parameter.
- `MatchScreen` holds updates while it's open (`useHoldUpdates`, below).
- App badge: `useAppBadge` (`src/shell.tsx`, mounted in `App`) keeps `navigator.setAppBadge` at `matches.attention` while the app is open; pushes carry `badgeCount` for when it isn't. It works on iOS 16.4+ home screen apps once notifications are allowed.

## Deep links on the phone

- Notification taps reach the app through `public/sw.js`, which posts `{type: "navigate"}` to an open window (iOS standalone apps ignore `WindowClient.navigate()`) and leaves the URL in the Cache API, which `src/deepLinks.ts` picks up when the app opens fresh at its start page.
- Links shared in Discord open in a browser, not the app: iOS can't open a home screen web app from a link at all, Android only sometimes (Discord's in-app browser usually keeps the link), and that browser isn't signed in. So a game link opened outside the app shows `LinkHandoff` (above the install steps): the game, then the crew's faces under "Which one's you?". Tapping yours calls `links.handoff`, which pushes the game to your phone; the notification opens the app in it and takes the seat. Android also gets an "Open in the app" `intent://` link, and the manifest asks Chrome to capture links into the installed app (`handle_links`, `launch_handler`).

## Updates (`src/version.tsx`)

Every phone runs the newest build. `version.json` carries the build ID; the app checks it on launch, every minute, on coming back to the foreground and on navigation. A new build covers the app with an animated "Updating" overlay, reloads, and shows "You're up to date" from the bottom once it's back. `useHoldUpdates(true)` holds it: `MatchScreen` holds for as long as a game screen is open, golf's practice holes and open world (`HoldUpdates`) while you're on them, and real-time chess while its game is active, and a held update applies once nothing holds it or the app goes to the background. Before reloading it has the service worker fetch the new page into its saved copy (`refresh-shell` in `public/sw.js`, which answers page loads from that copy), so the reload lands on the new build; if it still doesn't (offline) it offers an Update toast instead of looping. The app never sits blank: the boot check in `index.html`, `vite:preloadError` and the root `CrashBoundary` reload onto a fresh page once per build (`recover`). A websocket down for 3s shows the gray Reconnecting tint (`src/connection.tsx`, `data-offline-for` counts the seconds). Nothing is lost by reloading: games are on the server and plans save within a fraction of a second.

## Presence

- Clients heartbeat every `HEARTBEAT_MS` (10s) while visible; online means a heartbeat within `ONLINE_WINDOW_MS` (30s). Clients re-check that on a timer, since queries don't re-run as time passes.
- `heartbeat` skips writes that change nothing unless the last is over 5s old, so heartbeats don't churn every subscriber. Paths are cut to 100 characters.
- `tap`: `x` is a fraction of viewport width, `y` page pixels from the top, so a tap lands on the same content on another phone. `seq` bumps per tap; phones replay only taps newer than what they saw on first load.
- `time.now` is a mutation (never cached) that clients measure their clock offset against.

## Ratings

Elo per mode, K = 32, start 1200. `placesOf(match)` reads `result.standings`, else a draw is everyone tied and otherwise winners then the rest. `multiElo`: every pair is a game (better place wins, same place draws), weighted K/(n-1); only the order of places matters. A win is first place alone; sharing first is a draw. The leaderboard lists the whole crew, unplayed players at the bottom.

## Deep links and link handoff (`convex/links.ts`)

A game link opened in a browser can't reach the installed app and isn't signed in, so the link page asks who you are. `links.preview(path)` and `links.handoff(path, userId)` work signed out on purpose and only reveal what a Discord preview already shows. The path must be `/<game path>/<match id>` with the match's own game. Handoff answers `no-push` (no subscription), `wait` (one per player per 15s), or `sent`: a push that takes the seat (`acceptPath`) when the game's waiting and they're not in, else opens it.

## Hosted games (`convex/hosted.ts`, `scripts/publish-hosted.mjs`)

Served at `/games/<game>/<build>/<path>` on the site host, one stored file per request, `immutable` for a year (a file never changes under its build), gzip when it shrank. `publish` makes a fully uploaded build live (it must have `index.html`), keeps the one before for phones that have it open, and deletes older files. The build ID is a hash of the paths and contents, so publishing the same folder twice changes nothing. Only the admin key can publish.

## Auth and local sign-in

Discord's provider needs `issuer: "https://discord.com"`; avatars get `?size=256`. The `dev` provider (`devAuth.ts`) signs in as one of `DEV_CREW` (eight names, for a full table) only with `DEV_AUTH=1` and `CONVEX_SITE_URL` on 127.0.0.1/localhost; `devAuth:seed` creates them all so there's someone to challenge.

## Testing

### convex-test (`npm test`)

- `setup()` from `convex/test.setup.ts`; `signedIn(t, name)` returns `{ userId, as }` with `as` a client signed in as them.
- Use fake timers (`vi.useFakeTimers`, `vi.setSystemTime`) and read the scheduler through `ctx.db.system.query("_scheduled_functions")` (see `pending`/`clearPushes` in `regressions.test.ts`). `t.finishInProgressScheduledFunctions()` lets an already-running job finish first.
- Pushes in unit tests are pending `push:sendToUser` jobs; assert on their args.
- One test per framework bug fixed goes in `convex/regressions.test.ts`. Put a reason on assertions with `expect(value, "why").…` rather than a comment.

### e2e (`npm run test:e2e -- <files>`)

Always through `e2e/run.mjs`: it queues on a machine-wide `flock` (ports 3211 and 4573 are shared), builds the app once into `e2e/.state/dist-template` against a placeholder Convex URL (its output in `e2e/.state/build.log`) while it starts the backends, splits the tests between them by `e2e/timings.json` and runs one Playwright per backend, its lines prefixed `[n]` when there's more than one. Backend n (`e2e/backend.mjs`: Docker, the kiwi image by digest with the image ID as fallback) lives on `127.0.0.n`: it waits for that address's 3211 to be free, deploys without a second typecheck or codegen, sets env in one call with `ALLOW_TEST_HELPERS=1`, and writes `backend.json` into `e2e/.state` (n = 1) or `e2e/.state/slot-n`. Its copy of the app, with the placeholder swapped for its URL, is previewed by run.mjs itself on `127.0.0.n:4573`; Playwright gets `E2E_APP_URL`, `E2E_STATE` (read by `backend()` in the fixtures) and `E2E_TIMINGS`, and failures land in `test-results/slot-n`. The containers are killed, not `rm -f`'d (10s each under rootless Docker), even on Ctrl-C. `--shard=i/n` runs one of n slices balanced by `e2e/timings.json`: `e2e/shards.mjs` lists the tests, packs the longest first into the lightest shard and hands Playwright a `--test-list`; a test with no recorded time counts as the median. The `e2e/timings.mjs` reporter writes every run's seconds to `e2e/.state/timings.json` (skipped tests as 0); `node e2e/shards.mjs save [files...]` merges them into `e2e/timings.json` and drops tests that are gone, and `node e2e/shards.mjs plan <n>` prints the split. Never start a backend another way while a run might be going.

Fixtures (`e2e/fixtures.ts`), import `test` and `expect` from there:

- `phones` (auto for every test): wipes the database first (`testing:reset`), hands out `phones.open({ player?, push: "on", installed?, notifications?, colorScheme?, reducedMotion?, context? })`. The first phone is the test's own context; each after gets its own and all close when the test ends. `push: "on"` seeds a subscription so games are unlocked; only tests about the gate use `enablePush(page)`.
- `phone(context, opts)`: an installed-PWA iPhone page, for specs that build their own contexts (screenshots). It fakes the push service and service worker (dispatch `message` events on `navigator.serviceWorker` to test notification taps), tracks Convex traffic in `window.__convexNet`, and records sounds in `window.__sfx`.
- `admin()`: the admin client (internal functions too). Typed by the reference you pass: `internal.testing.x` from `convex/_generated/api` gives real types, `anyApi.testing.x` gives `any`. Queries retry once on "fetch failed"; mutations and actions only when the call never left.
- Waiting: `ready(page)` (an `h1`, no `aria-busy` or skeletons, `convexIdle`, `holdsStill`, no nested cards), `convexIdle(page)`, `holdsStill(page | frame)` (no finite animation running and controls where they were 120ms later; looping animations are ignored), `readyForShot(page)` (fonts and images loaded, then `holdsStill`: call before every review screenshot), `settled(read, windowMs)` (a value that stopped changing), `expect.poll` on `getMatch(id)` or `testing:*` queries, or a `data-*` attribute the screen exposes. Never `waitForTimeout` or `networkidle` (a lint rule enforces it).
- `onScreen(page)`: the top screen; one sliding away is `inert` (role locators skip it already).
- Game steps: `createPlayer(name, profile?)`, `matchIdOf(page)`, `openLobby(host, game, mode, settings)`, `fillLobby(host, guests)`, `resign(page)`, `realtimePair(phones, settings?)`. Start chess through `testing:startMatch`/`startFour`; every other game through `openLobby`/`fillLobby`, which run its real start hook.
- **No cards inside cards**: every page made by `phone()` (so every `phones.open` page) defines `window.__nestedCards()` (each `[data-slot="card"]` inside another, described as both elements) and runs it from a MutationObserver whenever elements are added or a `data-slot` changes, reporting each new one through a context binding, so a nesting that flashed by before a navigation still counts. `ready(page)` fails at once on anything reported or on screen now, and the `phones` fixture fails every test at its end with the list, naming both elements and the path. A page that didn't come from `phone()` isn't checked.
- Pushes: `testing:pushesOf({ userId })` returns what a test player would have been sent (title, body, url, tag, badge); see `e2e/pushes.spec.ts`.

`testing:*` (only with `ALLOW_TEST_HELPERS=1`): `createPlayer`, `insertPlayer`, `getMatch`, `allMatches`, `profileOf`, `seedPush`, `pushesOf`, `startMatch`/`startFour` (chess state only, first player white/red), `setRack`, `rackOf`, `playAs`, `joinAs`, `rtCommands`, `golfWorld`, `landlordBots`, `landlordPatch`, `reset` (call until `done`; refuses while real players exist), `removeTestData` (test players and their games only).

### Tools

- `node --experimental-strip-types e2e/load.mjs [--games 6 --classic 3 --seconds 60 --no-presence] [--prod]`: real websocket clients play real-time and classic chess with presence and taps, measuring move latency, time to reach the opponent, errors and OCC retries from the backend logs. Baseline on prod, 2026-10-25, 12 players: real-time move p50 115ms, p95 207ms; reaching the opponent p50 115ms, p95 209ms. `--prod` turns test helpers on at kiwi for the run and off after (a watchdog does it if the run overruns), and removes its test players.
- `PLAYWRIGHT_BROWSERS_PATH=0 node --experimental-strip-types e2e/playtest.ts`: a staging table for agents on `127.0.0.1:4600`: `GET /p/:name` (the screen as an aria snapshot, URL, errors since last look, and `settled`), `GET /p/:name/wait` (up to 25s until it's their move or the game's over, then waits for the screen to catch up), `POST /p/:name/tap {"role","name","exact"}`, `POST /p/:name/shot`, `GET /status`. Games are listed in `GAMES` at its top. It stops once every game ends (or 40 min), leaves 90s to look at results, and writes `e2e/.state/playtest.json`. Give each player to a cheap agent (Haiku) with curl and a play style, and have them report bugs and confusion; it found the sheets with no close button and a flash that never cleared. `e2e/playtest-wordle.ts` is the same for one PvP Wordle table (`PLAYERS`, `GOAL`, `LIMIT_MIN`), with `POST /p/:name/type {"word"}` to type and enter a guess, `/wait` returning once the game waits on that player (`yourMove`), and `/status` showing coins, solved and who it waits on; it writes `e2e/.state/playtest-wordle.json`.
- `node e2e/og-preview.mjs`: renders link previews for live chess, four-player, Scrabble, poker, Landlord and Stonks games into `e2e/.state/og-*.png`.
- load, playtest and og-preview start their own backend through `startBackend`, so don't run them alongside an e2e run.
- `npm run game:publish -- <game> <dir>`: publishes a hosted game to whatever `.env.local` (or `CONVEX_SELF_HOSTED_*`) points at.
- `scripts/dev.mjs <setup|convex|functions|stonks|test-sidecar|reset>`: the dekit steps. It always names the local backend to the CLI, so a checkout with kiwi's keys never deploys there. `dekit start test/smoke` runs `scripts/dev-smoke.mjs`.
- Golf: `bun scripts/golf-gen.ts [--seeds 1,2,3] [--holes 9] [--terrain 0|1|2] [--style 0|1|2] [--hazards 0|1|2] [--out dir]` draws generated holes (one PNG per seed plus a JSON of every hole) to `e2e/.state/golf-gen`; `bun scripts/golf-solve.ts [hole id ...] [--fast]` beam-searches a line round each hole (scored by walking distance to the cup), plays it with shaky hands for a par estimate, and rewrites `convex/golf/solutions.ts`; `bun scripts/golf-fingerprints.ts` prints the scripted games' fingerprints to compare engines.
- `node scripts/gen-four-pieces.mjs` recolors the white pieces into `public/pieces/four/`. Fixed colors for scripts live in `scripts/palette.mjs`; frame colors in `convex/palette.ts`.
