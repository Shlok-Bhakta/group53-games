# Group 53 Games

Small multiplayer games for one friend group from Discord, all in one app. Live: Chess (classic, four-player, and real-time versions of both), Scrabble (2 to 8 players, async or live with a turn timer), Poker (Hold'em, Omaha, Short Deck and 5-Card Draw, async), Golf (turn-based or live, on handmade or generated courses, plus practice holes and an open world), Monopoly (the classic property-trading game, async; `landlord` in the code), Stonks (a stock-market game: $10,000 each to trade anything on Yahoo Finance, live) and Journey Across Mereddia (Chris's single-player RPG, hosted outside the bundle). PvP Wordle is next.

## Who this is for

- **At most 5 players, maybe 10.** Never design for scale. A full table scan, a query that returns everyone, or a cron that touches every row is fine. Use this headroom to make the games richer, not to optimize.
- **Phones only.** Everyone plays from the installed PWA on iOS or Android. Desktop only needs to not break. Design for thumbs: tap targets at least 44px, primary actions 56px, nothing important in tiny menus, and confirm anything destructive.
- **Everyone is a software developer.** Programmer jokes and references land, and so do themes like Catppuccin, Gruvbox and Nord.
- **Low friction.** Every extra tap or screen costs players. Prefer one-tap actions, sensible defaults, and flows that resume where people left off.

## Design principles

- **Lean on Convex's live updates.** Every query is a live subscription: when the database changes, every connected client re-renders instantly. Build features on that. Show other players' moves the moment they happen, presence ("Chris is typing a guess"), live scoreboards, attacks landing on your board in real time, and animations triggered by someone else's action. If a feature could be live, make it live.
- **Spend compute freely.** The group is tiny, so server work is basically free. Recompute derived state on every change, fan out notifications generously, render images on demand, and schedule as many functions as needed. The one thing that isn't free is rewriting rows often (see Convex storage under On kiwi).
- **Make it interactive and PvP.** Games should let players affect each other: sabotage, steal, block, taunt. Async is fine, since games run over a day rather than in one sitting, but whatever is happening should feel live. Nothing may favor whoever has the most free time.
- **Notifications are core.** Push is how players hear they've been hit or that it's their turn. Games stay locked until push is on. When something happens to a player, notify them.
- **Discord is home.** Players sign in with Discord, links get shared in Discord, and link previews show live game state (`og/`).

## Stack

- React 19, Vite, React Router, Tailwind v4 and shadcn/ui (Radix, from the single `radix-ui` package), Motion, Phosphor icons.
- Self-hosted Convex on kiwi with SQLite, plus Convex Auth with the Discord provider.
- Web push through `web-push` in a Node action (`convex/push.ts`).
- `og/`: a small Node service that renders Discord and Open Graph previews with satori and resvg.
- `stonks/`: a small Rust service (the stonks sidecar), the only thing that talks to Yahoo, streaming prices into Convex.
- Checks: TypeScript, ESLint with our own rules (`eslint/plugin.js`), Prettier, knip, Vitest with convex-test, Playwright, all run by `npm run verify`.

## Layout

Every game is a package. Its parts live only here, and games never import each other:

| Where | What |
| --- | --- |
| `convex/<game>.ts` | Its Convex functions and its `GameHooks`. Never move or rename one once shipped: a function's name is its file path, and scheduled jobs and phones on the old build still call it. |
| `convex/<game>/**` | Pure modules shared with phones: the engine, `modes.ts`, `preview.ts`, `schema.ts`, text, and the game's tests (`engine.test.ts`, `server.test.ts`...). No `_generated/server`, no `convex/lib`, no browser APIs. |
| `src/games/<game>/**` | Its screens, art, rules text, `summary.ts`, `palette.ts`. |
| `e2e/<game>*.spec.ts` | Its e2e specs (`<game>-screens.spec.ts` for review shots). |
| `og/games/<game>.mjs` | Its link preview card. |
| `.agents/skills/game-<game>/SKILL.md` | Its feature map: read it before working on the game. |

Shared code reaches a game only through the registries. Typed by `GameKey`, so a game in `GAMES` but left out fails to compile: `convex/modes.ts` (`GAMES`, `MODES`, built from each game's `modes.ts`), `convex/games.ts` (`hooksFor`), `convex/previews.ts` (`BOARDS`), `src/games/index.tsx` (`GAME_UI`, plus the plain `GameCard`s and `SOON`). The other files allowed to import a game: `convex/schema.ts` (each game's tables), `convex/testing.ts`, `convex/crons.ts`, `convex/http.ts`, `src/App.tsx`, and `og/server.mjs` (`MATCH_GAMES`, `PAGE_GAMES`).

Shared, game-agnostic code:
- `convex/matches.ts` (lobbies, the queue, challenges, seats, start, resign, draws, `finish`, rematches, `sweep`, and the `lobby`, `attention` and `inbox` queries); it never names a game. `convex/lib/` (`seats`, `turns`, `secrets`, `drafts`, `people`), `notify.ts`, `push.ts`, `ratings.ts` (Elo per mode), `presence.ts`, `links.ts`, `hosted.ts`, `profiles.ts`.
- `src/components/` (`ui/` the shadcn kit, `game/` what game screens share, `match/` the lobby and result), `src/pages/` (Home, Games, Crew, You, `GameHub`, `ModePage`, `MatchScreen`), `src/shell.tsx` (the native-feeling stack), `src/sound.ts`, `src/style.css` (the only stylesheet, with every theme).

The games:
- `chess`: `chess:classic`, `chess:four`, `chess:realtime`, `chess:realtime4`.
- `scrabble`: `scrabble:classic` (async), `scrabble:live`.
- `poker`: `poker:holdem`, `poker:omaha`, `poker:short`, `poker:draw`.
- `golf`: `golf:turns`, `golf:live`, plus practice holes and Driftwood Bay, the open world, outside matches.
- `landlord`: `landlord:classic`, shown as Monopoly.
- `stonks`: not in `GAMES`; one shared game with no lobby at `/stonks`, a plain `GameCard`.
- `mereddia`: hosted (its build in Convex file storage, its source on the `mereddia-hosted` branch); `main` has its card and an iframe page.
- `wordle`: a coming-soon card (`SOON`) and a page-only og card.

Routes come from `GAME_UI`: `/<game>` (the game's page), `/<game>/mode/:slug` (a mode's page), `/<game>/:id` (a match: the shared lobby, then the game's screen). Paths always come from `matchPath`, `acceptPath` and `modePath`; never hard-code one.

## Rules

Enforced, so a break fails `npm run verify` (and CI):
- **No comments.** Say it with names, types and tests; lasting knowledge goes in a skill or here. Only a constraint forced by something we can't change stays, as `// platform: ...` (plus tool directives like `@vite-ignore`). `scripts/strip-comments.mjs` strips the rest. (`group53/no-comments`)
- **Theme tokens only** (`bg-card`, `text-muted-foreground`, `var(--tile-green)`). Colors that must not follow the theme live in a `palette.ts` (or `@theme static` in `style.css`). (`no-raw-color`)
- **7 type sizes, 4 radius steps, nothing sticky at the top.** (`design-tokens`)
- **No naked `<button>`**: `Button`/`IconButton` or a part built on them. **No raw avatar `<img>`**: `PlayerAvatar`. (`no-raw-button`, `no-raw-avatar`)
- **No async `onClick`**: `AsyncButton` or `usePending`, which lock while running so a double tap can't do it twice. (`no-async-onclick`)
- **No filler text**: no subtitles under titles, no sentences under headings, no empty-state prose. (`no-subtext`)
- **No cards inside cards.** (`no-nested-cards`, and every e2e page checks it live)
- **Tailwind-native CSS only**, in `src/style.css`. (`tailwind-css`)
- **Package boundaries**: no game imports another; shared code imports a game only from a registry; the app imports only types from a Convex function file; `convex/<game>/` stays pure. (`package-boundaries`, and no browser globals in `convex/*/**`)
- **Determinism**: no non-portable `Math` (`sin`, `cos`, `atan2`, `hypot`, `pow`...), `**`, `Math.random`, `Date.now` or `performance.now` in `convex/golf/**`, `convex/chess/realtime.ts` and `convex/chess/four/**`; use `convex/golf/dmath.ts`. Golf's fingerprints are checked under V8 and JavaScriptCore.
- **Imports**: `motion/react` (not framer-motion), Phosphor (not lucide or react-icons), `Sheet` (not vaul), `radix-ui`. No `any`, no `@ts-ignore` or `@ts-expect-error`, inline type imports, our naming convention, no `eslint-disable`.
- **e2e waits on what it can observe**, never `waitForTimeout` or `networkidle`. (`e2e-waits`)
- Prettier formatting, no dead code (knip), `tsc -b`, every theme's tokens and WCAG AA contrast (`src/themes.test.ts`), 44px tap targets and screens that fit in landscape (e2e).
- **The checks are Shlok's.** Agents never edit the lint rules, verify, the git hooks, CI, CODEOWNERS, knip, Prettier, tsconfig, vitest or playwright config, never skip a hook (`--no-verify`), never write verification stamps and never force-push. If a rule is wrong for a real case, stop and tell Shlok the rule, the case and the change. `.claude/hooks/guard.mjs` refuses these as a PreToolUse hook once `.claude/settings.json` registers it.

Judgment, that no check catches:
- Hidden information never goes in `matches.state`, which everyone can read: it goes in `secrets`, returned only to its owner.
- Real-time moves are one insert into a command table, stamped with the tick the player acted on. Never put per-move simulation, or writes another player also makes, in the move mutation.
- Mutations that create things are idempotent (double taps, retries). Moves carry what the player saw (a hand, a move count) when a stale tap could land on a newer state, and refuse it.
- Stored data is live: never rename a table, field or index, or a field of stored game state; new fields are optional; dropping or retyping one needs a migration.
- Before adding anything that rewrites a row often, work out what a day of it costs (Convex storage, below).
- Push the player something happened to; `notify` already skips whoever's looking.
- Phones first: 56px primary actions, heights under the board fixed, `ConfirmButton` for anything destructive, reduced motion respected, nothing looping while idle (except live signals, chosen card frames, the real-time countdown and a held tile), and text kept below the band iOS 26 blurs under the status bar (`TOP_CLEAR`).
- Need something twice, or a second game needs it? Move it into shared code instead of copying.
- Order of changes across a deploy (below).
- Add tests with every feature, and look at the review screenshots before shipping UI.

## Skills

The skills live in `.agents/skills/` (`.claude/skills` points there). Each game's loads by itself when the task touches that game; read the others when the work does.

| Skill | Read it for |
| --- | --- |
| `framework` | matches, lobbies, seats, settings, turns and timers, pushes and the badge, ratings, presence, deep links and link handoff, updates, hosted games, auth, and the test harness (convex-test, e2e fixtures, `testing:*`, load and playtest tools) |
| `ui` | any screen or component: the design system, the shadcn kit and shared parts, the app's screens, sheets, landscape, sound, themes, platform quirks, screenshot parity |
| `game-chess` | all four chess modes, the real-time engine and netcode, four-player rules |
| `game-scrabble` | Scrabble's engine wrapper, boards, Letter League, words, plans, the fullscreen board |
| `game-poker` | the poker engine, hand ranking, lined-up moves, the table and its show |
| `game-golf` | rounds, the world and its netcode, determinism, items, the generator and solver, practice and the open world |
| `game-landlord` | the Monopoly engine, the log and the show, the camera, trades, bots |
| `game-stonks` | the board, paper trading and the fill rule, storage costs, prewarming, the Rust sidecar |
| `game-mereddia` | Mereddia and the hosted-game pattern, publishing a build |
| `new-game` | adding a game, step by step. Manual only: Shlok runs `/new-game` |

## Running it locally

`dekit` on a fresh clone runs the whole app, with only Node and Docker installed (`dekit.yaml`, `scripts/dev.mjs`, how to use it in `README.md`): the Convex backend in Docker, `convex dev`, Vite on 5173, `og` on 8788, the sidecar, and `test/*` tasks. It doesn't touch kiwi, even in a checkout whose `.env.local` has kiwi's keys: `scripts/dev.mjs` names the local backend to the CLI outright, and environment variables beat that file.

- **Sign-in without Discord.** `VITE_DEV_AUTH=1` (set on `web`) shows `DEV_CREW` instead of the Discord button, keeps each tab's session in `sessionStorage` so each tab is its own player, and skips `InstallGate` and `NotificationsRequired`. It's absent from every real build. `DEV_AUTH=1` on the deployment turns on the `dev` Convex Auth provider (`convex/devAuth.ts`), which also requires `CONVEX_SITE_URL` to be on this machine, so it stays off on kiwi even if the variable gets set there. Never set either on kiwi. These players aren't `isTest`, so they behave like real ones.
- **Ports.** The dev backend doesn't publish its site port: tokens are checked from inside the container, and it leaves host port 3211 for `npm run test:e2e`, which can run while dekit's up.
- **The sidecar** runs with `cargo run` in `rust:1-alpine` inside the backend's network (`--network container:`), so it needs no Rust installed and no port tricks. Its build lives in the `group53-dev-target` volume, shared with `test/sidecar`.
- `dekit start test/smoke` (`scripts/dev-smoke.mjs`) checks the running stack in a real browser. After changing the boot steps, try them on a real fresh clone.

## Testing

Add tests with every feature. Each game's skill lists its tests and how to drive the game in them; the `framework` skill has the harness.

- `npm test`: Vitest. Convex functions run under convex-test (`convex/test.setup.ts`, which finds every `convex/**/*.ts`): shared ones in `convex/*.test.ts`, each game's in `convex/<game>/`. `convex/regressions.test.ts` keeps one test for each framework bug fixed. `src/themes.test.ts` fails if a theme is missing a token or has text under WCAG AA. `src/games/golf/determinism.test.ts` needs `bun`.
- `npm run test:e2e` (`e2e/run.mjs`, queued on a machine-wide lock): Playwright at iPhone size against throwaway Convex backends in Docker (`e2e/backend.mjs`, the same image as kiwi), one Playwright per backend. Locally it runs up to 4 backends at once (half the cores; `--slots=n` or `E2E_SLOTS` to change it, 1 on CI), each on its own loopback address (`127.0.0.n`, site port 3211, the app previewed on 4573), so a full run takes about 6 minutes. The app is built once and pointed at each backend. `npm run test:e2e -- chess` runs one spec, `npm run test:e2e -- --shard=2/12` one of 12 equal slices, cut by the per-test seconds in `e2e/timings.json` (`node e2e/shards.mjs plan 12` shows them; every run writes its own to `e2e/.state/timings.json`, and `node e2e/shards.mjs save [files...]` merges them in). Fixtures (`e2e/fixtures.ts`) make signed-in players through `convex/testing.ts`, emulate the installed PWA and fake push.
- Writing e2e tests: every phone after the first comes from the `phones` fixture. Wait on what you can observe (`ready(page)`, `holdsStill`, `settled`, polling `getMatch`, a `data-*` attribute the screen exposes). Start chess through `testing:startMatch`/`startFour`; every other game through `openLobby`/`fillLobby`, which run its real start hook.
- First run: `npm run test:e2e:install` downloads Chromium. The backend image is `ghcr.io/convex/convex-backend` (Convex moved it from `ghcr.io/get-convex`, which no longer pulls; kiwi's `compose.yaml` still names the old one, with the same digest). If the registry is unreachable, copy it from kiwi: `ssh kiwi docker save ghcr.io/get-convex/convex-backend:latest | docker load`.
- `SCREENS=1 npm run test:e2e -- screens` (and each game's `<game>-screens`) writes review screenshots to `e2e/.state/screens` in dark and light; `node scripts/screens-diff.mjs <before> <after> <diff>` compares two runs. Look at them before shipping UI changes.
- `convex/testing.ts` only works where `ALLOW_TEST_HELPERS=1`. Never leave it set on kiwi: only `e2e/load.mjs --prod` turns it on, for the length of a run, and switches it off again (a watchdog does even if the run hangs). Test players carry `users.isTest`: they never receive pushes and never trigger pushes to real players. `testing:reset` refuses to run while real players exist.
- `node --experimental-strip-types e2e/load.mjs` is a real load test (real websockets, presence, simultaneous real-time and classic chess); `--prod` runs it against kiwi. `e2e/playtest.ts` seats agents at a staging table. `node e2e/og-preview.mjs` renders link previews.

## Shipping

Whatever lands on `main` deploys itself.

1. Work on a branch.
2. `npm run verify` (`scripts/verify.mjs`) runs every check in order: format, lint, dead code, typecheck, unit tests, build, the sidecar's tests, e2e. It needs `bun` and Docker, and skips nothing. A full pass on a clean tree stamps that commit; the pre-push hook (`.githooks/pre-push`) won't push a commit without one, so commit first (a run with uncommitted changes doesn't count). `npm run verify -- --only=lint,types` runs some steps; partial runs don't count. The pre-commit hook checks Prettier and ESLint on the staged files. `npm install` sets `core.hooksPath` to `.githooks`.
3. Push and open a PR. CI (`.github/workflows/ci.yml`) runs the same checks spread over machines in about two minutes: lint, types, unit, and format with dead code and build as four jobs under `check`; `sidecar`; and e2e as 12 shards under `e2e`, each with its own backend (one retry on CI, so a test that only passed on its retry shows as flaky). Branch protection requires `check`, `sidecar` and `e2e`, which pass only when every part under them did. node_modules is cached per lockfile and the headless Chromium per lockfile too. Each shard uploads its timings (`e2e-timings-<n>`); when shards drift apart, `gh run download <run> -p 'e2e-timings-*' -D /tmp/t && node e2e/shards.mjs save /tmp/t/*/timings.json` and commit `e2e/timings.json`. CI never deploys.
4. Once it's merged, the deployer on kiwi deploys the new `main` within a couple of minutes.

Collaborators (Chrisis147, AIsJump, Boiler31) run it with `dekit`, work on branches and open PRs. `main` is protected and `.github/CODEOWNERS` makes Shlok the only approval that counts; a new push drops it.

### The deployer

`deployer` in `compose.yaml` runs on kiwi with the stack (`deploy/README.md` has the details, installing it, and trying it with `DRY_RUN=1`). The repo is public and kiwi is only on Tailscale, so nothing pushes to kiwi: every minute it fetches `main` over https, and when `main` has moved past the last deployed commit it runs that commit's `deploy/run.mjs`:

1. waits for Convex, `npm ci`, and builds the app with a new build ID (stopping, deploying nothing, if the bundle talks to anything but the public Convex URL);
2. `npx convex deploy -y` against the local backend (`http://convex:3210`, admin key from `secrets/admin_key`);
3. rsyncs the checkout into `~/Services/group53`, leaving `secrets/`, `.env*`, `site/` and `deploy-status.json` alone;
4. publishes the build in place: into `site/builds/<id>`, its assets added to `site/assets` (every recent build's stay, so a phone on the previous build can still load its chunks), nginx's config to `site/nginx` (reloaded if it changed), then `site/current` swapped to it atomically. nginx keeps running;
5. checks `/`, `/version.json` and `/sw.js` answer 200 on `https://group53.shlokbhakta.dev`, `/version.json` names the new build, and the live bundle talks to the public Convex URL; if not, `site/current` goes straight back and the deploy fails;
6. rebuilds `og` and `stonks` where their code changed (`docker compose up -d --no-deps --build og stonks`);
7. checks Convex, the tunnel and the dashboard are still the same containers (a deploy never touches them);
8. prunes builds past the newest five, assets no kept build uses that no build has served for two weeks, the stack's untagged images and build cache older than a week.

```sh
ssh kiwi 'cd Services/group53 && docker compose logs -f --tail 200 deployer'   # watch a deploy
ssh kiwi 'cat Services/group53/deploy-status.json'                             # the last one: sha, state, step, error
ssh kiwi 'cd Services/group53 && docker compose restart deployer'              # retry a failed commit
```

A commit that failed isn't retried on its own: the deployer waits for the next commit on `main`, or a restart tries the latest `main` again. A failure after step 2 leaves the new functions live with the old app, the safe direction, but fix it or revert. The deployer never rebuilds itself: when `deploy/Dockerfile`, `deploy/loop.sh` or its `compose.yaml` block change, the log says so in yellow (`deployerOutdated` in the status) and someone runs `docker compose up -d --build deployer` on kiwi once that deploy is ok. Every `docker compose` it runs gets a clean environment, so only the stack's `.env` feeds compose's substitutions.

### Phones update themselves

`version.json` carries the build ID and `src/version.tsx` checks it on launch, every minute, on coming back to the foreground and on navigation. A new build shows an "Updating" overlay, reloads, and says "You're up to date". A phone holds the update while a game screen is open (`useHoldUpdates`) and applies it once they leave or the app goes to the background. Every deploy is a new build ID (the time it was built), so phones reload after each one, even when the app itself didn't change.

`public/sw.js` answers every page load from the last copy of `index.html` it saw (under a week old) and refreshes it in the background, so a reopened app paints its theme at once instead of white while the network answers. It saves its own clean copy (only `content-type`, plus `x-saved-at`, and only a whole page), and a new `sw.js` drops the old copy when it takes over. The first launch after a deploy opens the previous build, and the version check then moves it to the new one: before reloading, the app asks the worker to fetch the new page into its copy (`refresh-shell`), so the reload lands on the new build. That copy points at its own build's assets, which is why the deployer keeps assets for two weeks after a build stops being served.

Nothing gets stuck on a blank screen: if the app's script never runs (`data-booted` unset at `load`, online), `index.html` drops the saved copy and loads once more; a chunk that fails to load (`vite:preloadError`) and a crash anywhere in the app (`CrashBoundary` around it) reload onto a fresh page once per build (`recover`), then show a Reload button.

Deploys don't interrupt games: `convex deploy` keeps every websocket open (measured on 2026-11-17: 30 mutations during a push, none failed, the slowest 287ms), the site swaps by symlink, and scheduled jobs keep running. If a phone does lose its connection for 3s (kiwi or the tunnel down, bad signal), `src/connection.tsx` tints the app gray, blocks taps and counts the seconds until it's back.

### Order of changes

Convex functions go live before the web app does, in every deploy. Additive backend changes (new functions, new optional args, new fields) are safe in one deploy. Removing or renaming a function, or making an arg required, crashes phones still running the old app: ship the frontend that stops using it first, then remove the function in a later deploy. Schema changes that drop or retype fields need a migration first.

### Rolling back

Revert the bad commit on `main` (`git revert <sha>`); the deployer deploys the revert like any other commit. It's a full redeploy of that tree, backend included, so the same ordering rules apply: if the bad commit removed a function the old app needs, reverting brings it back. To put the site back at once without touching Convex, point it at any kept build: `ssh kiwi 'cd Services/group53/site && ln -sfn builds/<id> current.next && mv -T current.next current'`.

### Link previews

If a change touches `og/` or a game's `preview.ts`, check the cards with `node e2e/og-preview.mjs`, and after deploying in Discord.

## Your machine

- The repo is at `~/Projects/group53-games` (T3 also sees it as `~/.t3/projects/group53-games`, a symlink). GitHub: `git@github.com:Shlok-Bhakta/group53-games.git`.
- `.env.local` (gitignored, only on this machine) holds `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY` and `VITE_CONVEX_URL`, pointing the Convex CLI at kiwi over Tailscale (`http://100.88.30.127:38441`), for `npx convex logs`, `npx convex env` and `npm run game:publish`. If it's missing, the admin key is in `kiwi:~/Services/group53/secrets/admin_key`.
- `ssh kiwi` must work without a prompt (an alias in `~/.ssh/config`: user `shlok` at `100.88.30.127`, so Tailscale has to be up). Check with `ssh -o BatchMode=yes kiwi true`.

## On kiwi

The stack is `~/Services/group53` (a copy the deployer rsyncs into, not a git checkout). `.env` there holds `INSTANCE_SECRET`, `CONVEX_URL` and `CONVEX_SITE_URL`; `secrets/` the admin key and the tunnel's credentials; `site/` the published builds. `compose.yaml` runs seven containers:

- `convex`: the whole backend (database, functions, websockets, scheduler, real-time ticks). SQLite on the SSD at `/home/shlok/ssd-data/group53/convex-data`. Never move it to the 5TB USB disk (`usb1`), an SMR spinning drive: there commits stalled for 0.5 to 1.2s and logins took seconds.
- `web`: the stock nginx image serving `site/current`; nothing is built into it. `nginx.conf` sends link-preview bots to `og`, falls back to `index.html` for deep links, caches `/assets/` for a year, and never caches `sw.js` or `version.json`.
- `og`: a small Node server for Discord and Open Graph link previews. Bots can't run the app's JavaScript, so `og` reads live data from Convex (`convex/previews.ts`, with the admin key) and returns the tags plus a PNG card. It isn't a backend for the app.
- `stonks`: the sidecar (Rust, about 8 MB of RAM, an empty image with one binary), writing into Convex with the admin key. `docker compose logs stonks` shows which source is covering what.
- `tunnel`: Cloudflare Tunnel `group53-games`: `group53.shlokbhakta.dev` (the app), `group53-api` (Convex, 3210) and `group53-site` (HTTP actions and auth callbacks, 3211), with no ports open on kiwi.
- `dashboard`: the Convex dashboard on the tailnet at `http://100.88.30.127:38443` (log in with the admin key). Nothing depends on it.
- `deployer`: deploys `main` (above). It has the Docker socket, the stack directory mounted at the same path inside, the admin key, and a `deployer` volume for its checkout and npm cache.

Deploys only touch `site/`, `og` and `stonks` (and recreate `web` once if its own block in `compose.yaml` changed). A change to the `convex`, `tunnel` or `dashboard` blocks in `compose.yaml` is copied over but not applied: run `docker compose up -d <service>` on kiwi when it's safe.

```sh
ssh kiwi 'cd Services/group53 && docker compose ps'                    # what's running
ssh kiwi 'cd Services/group53 && docker compose logs --tail 100 og'    # or convex, web, stonks, tunnel, deployer
ssh kiwi 'cd Services/group53 && docker compose restart og'            # restart one service
```

Convex function logs: `npx convex logs` from this repo.

### Convex storage

Convex keeps the old version of every row it rewrites until retention deletes it, so what fills the disk is how often rows are rewritten, not what's stored: on 2026-11-02 a day wrote about 700 MB of old versions to keep 5.7 MB of current data (Stonks, before the rules in its skill). `compose.yaml` sets `DOCUMENT_RETENTION_DELAY` to 3 days (30 by default) and `MAX_SESSION_CLEANUP_DURATION_HOURS` to 24, which bounds the database at about three days of writes. The window has to stay well above an hour, how often Convex saves its search index (`SEARCH_WORKERS_MAX_CHECKPOINT_AGE`), or a restart can't rebuild it, and above how long kiwi might be off: past the window, search and writes still worked in a test but index workers kept logging out-of-retention errors. SQLite reuses freed pages but never shrinks the file; only `VACUUM`, with `convex` stopped, does. A restart costs memory: on 2026-11-03 `convex` came back at about 6 GiB, against about 2 GiB after running for days.

### Convex environment variables

Set on the deployment, not in files: `npx convex env list`, `npx convex env set NAME value`. In use: `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. `ALLOW_TEST_HELPERS` and `DEV_AUTH` must stay unset on kiwi.
