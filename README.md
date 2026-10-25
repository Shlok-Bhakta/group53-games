<img src="assets/icon.svg" width="64" height="64" alt="">

# Group 53 Games

Small games for a small group. React and Vite on the front end, a self-hosted Convex backend on kiwi (SQLite), and Discord sign-in through Convex Auth. Each game lives at its own path. `/chess` has classic (async, with turn notifications and 8-hour reminders) and real-time chess (Kung Fu Chess rules, like rtchess.org), plus Elo leaderboards. `/wordle` is a work in progress.

## Local development

Create `.env.local` with `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, and `VITE_CONVEX_URL` (the tailnet URL `http://100.88.30.127:38441` works). Then:

```sh
npm ci
npx convex deploy -y
npm run dev
```

## Tests

`npm test` runs the unit tests (Convex functions and theme contrast). `npm run test:e2e` runs the Playwright suite against a throwaway Convex backend in Docker; run `npm run test:e2e:install` once first. See `AGENTS.md` for details.

## Kiwi deployment

The stack lives in `~/Services/group53` on kiwi. `compose.yaml` runs Convex, its dashboard, the web app, the `og` link-preview service, and a Cloudflare Tunnel (`group53-games`). Convex stores SQLite and files at `/home/shlok/ssd-data/group53/convex-data` on the SSD (the 5TB USB disk is SMR and far too slow for it). `.env` there holds `INSTANCE_SECRET`, `CONVEX_URL`, and `CONVEX_SITE_URL`. `secrets/` holds the tunnel credentials and the admin key, both mode 600.

| Hostname | Target |
| --- | --- |
| `group53.shlokbhakta.dev` | web app |
| `group53-api.shlokbhakta.dev` | Convex API and websocket (3210) |
| `group53-site.shlokbhakta.dev` | Convex HTTP actions, including auth callbacks (3211) |

On the tailnet, the web app is at port 38440, the API at 38441, HTTP actions at 38442, and the dashboard at 38443.

To ship a change, push the functions with `npx convex deploy -y`, rsync the repo to kiwi without `node_modules`, `dist`, `.git`, `.env*`, `.convex`, or `secrets`, and run `docker compose up -d --build web og` there.

## Discord sign-in

The Discord application's redirect URI is `https://group53-site.shlokbhakta.dev/api/auth/callback/discord`. Set `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET` with `npx convex env set`. `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` are already set on the deployment.

## Link previews

nginx sends link unfurlers (Discordbot, Slackbot, iMessage, and similar) to `og/`, which returns Open Graph tags and renders a 1200×630 card from live Convex data with satori. It reads data through internal queries in `convex/previews.ts` using the admin key, so nothing is exposed publicly. Card image URLs carry a hash of the data, and the in-app Share button adds a random `s` parameter, so Discord unfurls each shared link fresh. To add a preview for a new page, add an entry to `PAGES` and a card to `CARDS` in `og/server.mjs`.

## Credits

Chess pieces by Colin M.L. Burnett, CC BY-SA 3.0, via Wikimedia Commons (see `public/pieces/LICENSE.md`). Real-time chess rules follow [rtchess.org](https://rtchess.org).
