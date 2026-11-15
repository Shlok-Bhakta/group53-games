<img src="assets/icon.svg" width="64" height="64" alt="">

# Group 53 Games

Small games for a small group, played from an installed PWA on phones: chess (async and real-time, two or four players), Scrabble, poker, golf, Monopoly, Stonks (paper trading on live prices) and Journey Across Mereddia, with PvP Wordle next. React and Vite on the front end, a self-hosted Convex backend on kiwi (SQLite), and Discord sign-in through Convex Auth. Home gathers every game that wants you; Games is where you start one. `AGENTS.md` is the guide to the code.

## Local development

You need [Node 22+](https://nodejs.org), Docker (or Podman as `docker`), and [dekit](https://dekit.run):

```sh
curl -fsSL https://dekit.run/install.sh | sh
git clone git@github.com:Shlok-Bhakta/group53-games.git && cd group53-games
dekit
```

That's all, with no Discord app, secrets, Rust, or access to kiwi. The first run takes a few minutes. Then open <http://127.0.0.1:5173>, with your browser's phone emulation on, since the app is built for phones.

Pick a player to sign in. **Each tab is its own player**, so one browser can play every seat. The install and notification gates are off, so you land straight in the app.

| Task | What it runs |
| --- | --- |
| `web` | The app with hot reload, on port 5173 |
| `functions` | `convex dev`: pushes `convex/` to the local backend on every save and shows its logs |
| `convex` | The Convex backend in Docker, on port 3210. Its data stays between runs |
| `stonks` | The sidecar, with live prices from Yahoo. It builds in a container |
| `og` | Link previews, on port 8788 (`/og/health`, or `/chess/<id>` for a game's) |
| `test/smoke` | Checks everything above really works, in a real browser |
| `test/unit`, `test/e2e`, `test/sidecar` | The test suites |

In the console, select a task and press `s` to start it, `r` to restart it, and `q` to quit: `q` again stops everything, and `d` leaves it running. `dekit start test/smoke` starts a task from your shell, and `dekit screen web` prints its output.

`dekit down` stops everything, and the next `dekit` brings back whatever was started, tests included, so `dekit stop 'test/*'` first if you don't want them rerun. `dekit down && npm run dev:reset` wipes the local data for a fresh start.

The sign-in is mocked by two variables, both set for you: `VITE_DEV_AUTH=1` on `web` (`dekit.yaml`) swaps Discord for the picker, and `DEV_AUTH=1` on the local Convex backend (`scripts/dev.mjs`) lets those players in. It refuses on any backend that isn't on this machine (`convex/devAuth.ts`).

Pushes, installing to a home screen and Discord sign-in need the real thing, so try those on a deployed build. Open a PR when your change is ready: only Shlok can approve one, and once it's merged it deploys itself.

## Checks and tests

`npm run verify` runs everything a push needs, in order: formatting, lint, dead code, typecheck, unit tests, build, the sidecar's tests and e2e. It needs Docker and [Bun](https://bun.sh) (golf's determinism check runs under it). Commit first: the pre-push hook only pushes a commit that passed a full run on a clean tree, and `npm install` turns the hooks on. `npm run verify -- --only=lint,types` runs some steps.

`npm test` runs the unit tests on their own, and `npm run test:e2e` the Playwright suite against a throwaway Convex backend in Docker (run `npm run test:e2e:install` once first; `npm run test:e2e -- chess` for one spec). See `AGENTS.md` for details.

## Kiwi deployment

The stack lives in `~/Services/group53` on kiwi. `compose.yaml` runs Convex, its dashboard, the web app, the `og` link-preview service, the stonks sidecar, a Cloudflare Tunnel (`group53-games`), and the deployer. Convex stores SQLite and files at `/home/shlok/ssd-data/group53/convex-data` on the SSD (the 5TB USB disk is SMR and far too slow for it). `.env` there holds `INSTANCE_SECRET`, `CONVEX_URL`, and `CONVEX_SITE_URL`. `secrets/` holds the tunnel credentials and the admin key, both mode 600.

| Hostname | Target |
| --- | --- |
| `group53.shlokbhakta.dev` | web app |
| `group53-api.shlokbhakta.dev` | Convex API and websocket (3210) |
| `group53-site.shlokbhakta.dev` | Convex HTTP actions, including auth callbacks (3211) |

On the tailnet, the web app is at port 38440, the API at 38441, HTTP actions at 38442, and the dashboard at 38443.

Whatever lands on `main` deploys itself: the deployer on kiwi fetches `main` every minute and deploys it, Convex functions first, then the app swapped in place under nginx, then `og` and `stonks` (`deploy/README.md`). There's no manual deploy command.

## Discord sign-in

The Discord application's redirect URI is `https://group53-site.shlokbhakta.dev/api/auth/callback/discord`. Set `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET` with `npx convex env set`. `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` are already set on the deployment.

## Link previews

nginx sends link unfurlers (Discordbot, Slackbot, iMessage, and similar) to `og/`, which returns Open Graph tags and renders a 1200×630 card from live Convex data with satori. It reads data through internal queries in `convex/previews.ts` using the admin key, so nothing is exposed publicly. Card image URLs carry a hash of the data, and the in-app Share button adds a random `s` parameter, so Discord unfurls each shared link fresh. Each game's card is `og/games/<game>.mjs`, registered in `MATCH_GAMES` and `PAGE_GAMES` in `og/server.mjs`. `node e2e/og-preview.mjs` renders them.

## Credits

Chess pieces by Colin M.L. Burnett, CC BY-SA 3.0, via Wikimedia Commons (see `public/pieces/LICENSE.md`). Real-time chess rules follow [rtchess.org](https://rtchess.org).
