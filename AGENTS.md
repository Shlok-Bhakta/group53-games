# Group 53 Games

Small multiplayer games for one friend group from Discord. The first game is PvP Wordle. More games live at their own paths in the same app.

## Who this is for

- **At most 5 players, maybe 10.** Never design for scale. A full table scan, a query that returns everyone, or a cron that touches every row is fine. Use this headroom to make the games richer, not to optimize.
- **Phones only.** Everyone plays from the installed PWA on iOS or Android. Desktop only needs to not break. Design for thumbs: tap targets at least 44px, primary actions 56px, nothing important in tiny menus, and confirm anything destructive.
- **Everyone is a software developer.** Programmer jokes and references land, and so do themes like Catppuccin, Gruvbox and Nord.
- **Low friction.** Every extra tap or screen costs players. Prefer one-tap actions, sensible defaults, and flows that resume where people left off.

## Design principles

- **Lean on Convex's live updates.** Every query is a live subscription: when the database changes, every connected client re-renders instantly. Build features on that. Show other players' moves the moment they happen, presence ("Chris is typing a guess"), live scoreboards, attacks landing on your board in real time, and animations triggered by someone else's action. If a feature could be live, make it live.
- **Spend compute freely.** The group is tiny, so server work is basically free. Recompute derived state on every change, fan out notifications generously, render images on demand, and schedule as many functions as needed.
- **Make it interactive and PvP.** Games should let players affect each other: sabotage, steal, block, taunt. Async is fine, since games run over a day rather than in one sitting, but whatever is happening should feel live.
- **Notifications are core.** Push is how players hear they've been hit or that it's their turn. Games stay locked until push is on. When something happens to a player, notify them.
- **Discord is home.** Players sign in with Discord, links get shared in Discord, and link previews should show live game state (see `og/`).

## Stack

- React 19, Vite, React Router, Tailwind v4 and shadcn/ui (Radix). Components are in `src/components/ui`; use them instead of hand-rolled controls.
- Self-hosted Convex on kiwi with SQLite, plus Convex Auth with the Discord provider.
- Web push through `web-push` in a Node action (`convex/push.ts`).
- `og/`: a small Node service that renders Discord and Open Graph previews with satori and resvg.

## Games framework

- Modes live in `convex/modes.ts`. Each one is `async` (turn-based over hours) or `realtime` (everyone on screen at once) and has a player count. A new game adds its modes there.
- `convex/matches.ts` is game-agnostic and works for any seat count: open lobbies and the queue (`queue` joins someone waiting or opens a lobby and pings the crew), challenges to one or more players (invite fewer than the seats and the rest are `openSeats` for the crew; invited players keep their seat until they answer, and in bigger games a decline opens the seat instead of cancelling), join, leave, decline, cancel, resign, draw offers (two-player only), `finish` (results with `standings` for multiplayer, ratings, placing pushes), rematches (everyone has to say yes; colors move one seat along), and the `lobby`, `attention` and `inbox` queries. Mode-specific state lives in `matches.state`.
- Challenges aren't tied to a mode page: `matches.inbox` gathers invites, my-move games, live games and open seats across every mode, shown on the home Chess card and on `/chess` (`src/games/chess/Inbox.tsx`). Mode pages (`/chess/mode/:slug`) are for starting games, your games in that mode, and its leaderboard. `/chess` is a two-column picker: Async (Classic, 4-Player) and Real-time (Real-time, 4-Player).
- Deep links: challenge and lobby pushes point at `acceptPath` (`/chess/:id?accept=1`), and opening that takes the seat. Notification taps reach the app through `public/sw.js`, which posts `{type: "navigate"}` to an open window (iOS standalone apps ignore `WindowClient.navigate()`) and also leaves the URL in the Cache API, which `src/deepLinks.ts` picks up when the app opens fresh at its start page. Links shared in Discord open in the browser, not the app, which is why challenges also live in the inbox.
- Async turns: every move pushes the next player, and `scheduleReminder` re-arms an 8-hour reminder. Reminders carry the move count they were set for and fizzle if anyone has moved since, so they never need cancelling.
- `notify()` (`convex/notify.ts`) skips the push when the player is already looking at that URL. Pushes carry a `tag` per match so they replace each other.
- Ratings: Elo per mode in `convex/ratings.ts` (K=32, start 1200). Multiplayer games count every pair of players as a game between them, weighted K/(n-1), by placing (`multiElo`). The leaderboard lists the whole crew.
- Chess: `convex/chess.ts`. Classic is validated with chess.js. Real-time follows rtchess.org (Kung Fu Chess) and runs on a deterministic engine in `convex/chess/realtime.ts`, shared by server and client: 30 ticks/s, 1 square per second, 5s cooldown, collision captures, premoves (a busy piece queues one move that fires when it's ready; a `cancel` command drops it), take the king to win. Keep the engine free of Convex and browser imports.
- Four-player chess (chess.com Free-for-all) lives in `convex/chess/four/`: `board.ts` (14x14 minus 3x3 corners; red, blue, yellow, green clockwise; each army's setup is red's rotated) and `classic.ts` (the turn-based engine: check against every opponent, checkmate/stalemate put you out, grey armies stay on the board and score nothing, points for captures and multi-checks, most points wins, ties by who lasted longer). `chess:fourMove` validates with it; in four-player, resigning or six missed reminders (48 hours, `TIMEOUT_STRIKES`) puts you out and play goes on. The real-time engine takes a `variant` ("two" or "four"): in four-player, losing your king (or a `resign` command) freezes your army in grey, there's no castling, and the last king standing wins with a ranking by elimination tick.
- Boards are drawn through a `View` (`src/games/chess/geometry.ts`) so every player sees their army at the bottom; on the 14x14 board taps snap to the nearest useful square, since squares are under 30px.
- Real-time netcode, built this way after the first version lagged:
  - A move is a single insert into `rtCommands`. It never reads or writes the match document, so two players moving at once can't conflict.
  - Moves are stamped with the tick the player acted on (`clientTick`, clamped to `MAX_LAG_TICKS` back), so the mover's optimistic update matches the server exactly and nothing jitters.
  - The server doesn't re-validate moves. The engine ignores illegal ones identically everywhere.
  - `chess:rtTick` runs every 500ms: it advances a settled snapshot in `rtSnapshots` to `now - MAX_LAG_TICKS - 2` and finishes the game once the result falls inside the settled part.
  - Clients replay snapshot + commands (`chess:rtState`) and move pieces directly in the DOM each frame (`RealtimeGame.tsx`). React re-renders only when the board's structure changes. Remote moves ease in over `CATCH_UP_TICKS`, and the clock (`clock.ts`) slews instead of jumping.
  - Never put per-move simulation, or writes the other player also makes, back into the move mutation.
- Game routes are wrapped in `NotificationsRequired`, so links from Discord still enforce push.
- Link previews for `/chess/:id` render the live board, including the four-player cross (`convex/previews.ts` and `og/server.mjs`). Check them with `node e2e/og-preview.mjs`.

## Look and feel

- Wordle-style letter tiles are the motif (`src/Tiles.tsx`). A crooked red "hit" tile marks a PvP attack.
- Themes live in `src/style.css` and are listed in `src/themes.ts`. Each theme defines light and dark tokens plus tile colors. Use tokens like `bg-card`, `text-muted-foreground` and `var(--tile-green)`, never raw colors, so every theme works.
- Fonts can be changed on the You tab (Oxanium by default). Use `.font-display` for headlines.
- iOS 26 blurs a band about 30pt deep under the status bar in standalone web apps (the scroll edge effect), and there's no way to turn it off. Chromium tests can't see it. `TopEdge` covers that band with a solid strip; keep all text below `TOP_CLEAR` (headers start at `safe-area-inset-top + 34px` or more), and never make text `sticky` or `fixed` at the top. An e2e test checks the header.
- Use Phosphor icons (`@phosphor-icons/react`, `*Icon` exports), filled for active states. Use Motion (`motion/react`) for springs, shared-layout selection, and live presence. Respect reduced motion (`MotionConfig` is set in `App.tsx`).
- Presence: `convex/presence.ts` stores a heartbeat and the latest tap per player. `src/presence.tsx` shows online dots and other players' taps on the main tabs.
- Player cosmetics (frame, frame color, glow, effect, badge, tagline) are in the `profiles` table, with options in `convex/profileOptions.ts`. Name and avatar come from Discord on every sign-in and are not editable.

## Testing

Run both suites before shipping, and add tests with every feature.

- `npm test`: Vitest. `convex/*.test.ts` run Convex functions with convex-test (helpers in `convex/test.setup.ts`). `src/themes.test.ts` parses `style.css` and fails if any theme is missing a token or has text below WCAG AA contrast in light or dark mode.
- `npm run test:e2e`: Playwright at iPhone size against a throwaway Convex backend in Docker (`e2e/backend.mjs`). It uses the same image as kiwi, runs on host port 3211, and the app is previewed on 4573. Fixtures in `e2e/fixtures.ts` create signed-in players through `convex/testing.ts`, emulate the installed PWA, and fake push. The suite covers the install gate, notifications locking games, live presence and taps across two phones, card edits, themes, sign-out, 44px tap targets, axe accessibility scans, and full chess games on two phones (classic moves, drag, checkmate, challenges accepted from the home inbox, leaderboard, real-time countdown and simultaneous moves, king capture ending the game through the scheduler, spectators), and four-player games on four phones (`e2e/four.spec.ts`: the mode picker, accepting through a push link, the inbox and a service-worker message, board rotation, resigning, standings, four-way rematches, real-time with everyone moving at once, and the cold-start deep link).
- First run: `npm run test:e2e:install` to download Chromium. If GitHub's registry is unreachable, copy the backend image from kiwi: `ssh kiwi docker save ghcr.io/get-convex/convex-backend:latest | docker load`.
- `SCREENS=1 npm run test:e2e -- screens` writes review screenshots to `e2e/.state/screens` in dark and light mode. Look at them before shipping UI changes.
- `convex/testing.ts` only works where `ALLOW_TEST_HELPERS=1`. Never leave it set on kiwi: only `e2e/load.mjs --prod` turns it on, for the length of a run, and it switches it off again (a watchdog does this even if the run hangs). Test players carry `users.isTest`: they never receive pushes and never trigger pushes to real players. `testing:removeTestData` deletes only them and their games; `testing:reset` refuses to run while real players exist.
- `node --experimental-strip-types e2e/load.mjs` is a real load test: real `ConvexClient` websockets, signed sessions, presence, taps, simultaneous real-time and classic games. It reports move latency, how long a move takes to reach the opponent, errors, and server conflict retries by function. With no flag it uses a throwaway local backend; `--prod` hits kiwi through Cloudflare. A baseline from 2026-10-25 on prod with 12 players: real-time move p50 115ms, p95 207ms; reaching the opponent p50 115ms, p95 209ms.
- Themes are generated by `scripts/gen-themes.py`. Change colors there, then regenerate the theme block in `style.css`.

## Working on it

- Convex data lives on kiwi's SSD (`/home/shlok/ssd-data/group53/convex-data`). The 5TB USB disk (`usb1`) is an SMR spinning drive. On it, commits stalled for 0.5–1.2s and logins took seconds, so never put a database there.
- Every async button uses `AsyncButton` or `usePending` (`src/components/AsyncButton.tsx`). They lock while running and show a spinner, so double taps can't duplicate actions. Mutations that create things should also be idempotent on the server, like `challenge`.
- New deploys reach phones on their own: `version.json` carries the build ID and `src/version.ts` reloads (once per build) or, inside a game, offers an Update button.
- `.env.local` points the Convex CLI at the kiwi deployment over Tailscale. Push functions with `npx convex deploy -y`.
- Ship the web app and backend together. Removing or renaming a Convex function before the new frontend is live crashes the deployed app. Deploy additive backend changes first, the web app next, and removals last.
- Web deploy: rsync the repo to `kiwi:Services/group53/` without `node_modules`, `dist`, `.git`, `secrets`, `.env*` or `.convex`, then run `docker compose up -d --build web og` there. See `README.md`.
- Discord OAuth needs `issuer: "https://discord.com"` on the provider (`convex/auth.ts`), or every sign-in fails on the `iss` check.
