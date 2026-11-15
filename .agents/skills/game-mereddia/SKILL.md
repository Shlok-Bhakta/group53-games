---
name: game-mereddia
description: Journey Across Mereddia, the hosted single-player RPG, and the hosted-game pattern. Use when changing its Games card, its iframe page, publishing a new build, or adding another game that lives outside the app's bundle.
---

# Journey Across Mereddia (a hosted game)

Chris's single-player RPG. It needs nothing from the database, so it isn't in the app's bundle: `main` holds only its card and an iframe page, and the game itself is a separate build served from Convex file storage. The `framework` skill covers `convex/hosted.ts` and the publish script in more depth.

## Where things are

- `main`:
  - `src/games/mereddia/card.tsx` (`MereddiaBanner`: the pixel sprites from `public/mereddia-card/` plus two SVG slimes);
  - `src/games/mereddia/palette.ts` (the card art's fixed colours: meadow, slime green, the rainbow slime's stops, eye and shine);
  - `MEREDDIA` in `src/games/index.tsx` (a plain `GameCard`, path `/mereddia`);
  - the route in `src/App.tsx` (`<HostedGame game="mereddia" title="Journey Across Mereddia" />`);
  - `src/games/HostedGame.tsx`, `convex/hosted.ts`, `scripts/publish-hosted.mjs`, `e2e/hosted.spec.ts`.
- The game's source lives on the `mereddia-hosted` branch, never `main`. There, `npm run mereddia:build` builds `vite.mereddia.config.ts` into `dist-mereddia/`, renames `mereddia.html` to `index.html`, and copies `public/mereddia` in.

## How a hosted game works

- `npm run game:publish -- mereddia dist-mereddia` (`scripts/publish-hosted.mjs`) needs a folder with `index.html` at its root.
  - It reads kiwi's URL and admin key from `.env.local`, or `CONVEX_SELF_HOSTED_URL`/`CONVEX_SELF_HOSTED_ADMIN_KEY`.
  - The build ID is a hash of every path and its contents.
  - It uploads 8 files at a time, gzipping only where that makes the file smaller.
  - Only then does it call `hosted:publish`, which points `hostedGames` at the build. It keeps the build before (for phones that have it open) and deletes older files.
  - Publishing the same folder twice changes nothing.
  - Publishing needs no deploy, and a deploy doesn't touch the game.
- `convex/hosted.ts` serves `/games/<game>/<build>/<path>` on the site host, one stored file per request, `immutable` for a year. Relative paths work.
- `hosted:current` gives the live `index.html` URL, or null before anything's published. The page then says "It isn't up yet." (real information, not filler).
- `HostedGame` page:
  - It covers the screen (`fixed inset-x-0 top-0 pin-bottom`) and shows the iframe below `TOP_CLEAR` and inside `--safe-*` on every side, because a frame doesn't get the phone's safe areas.
  - The sandbox is `allow-scripts allow-same-origin`; `allow` is `autoplay; fullscreen`.
  - The theme, palette, font and sound settings go in the URL's hash (`dark`, `palette`, `font`, `sfx`, `music`). The app's music stops while it's open (`wantMusic(false)`).
  - It's a different origin, so the game can't read the app's session. It talks by `postMessage`: `{type: "ready"}` hides the loading cover (the nav bar and a spinner), and `{type: "back"}` goes back. Only messages from its own frame count.

## Updating Mereddia

1. Check out `mereddia-hosted`.
2. Run `npm run mereddia:build`.
3. Run `npm run game:publish -- mereddia dist-mereddia` from a checkout whose `.env.local` points at kiwi.

Phones get the new build the next time they open the page.

## Adding another hosted game

Give it:
- a card in `src/games/<game>/` (fixed colours in that folder's `palette.ts`);
- a `GameCard` in `src/games/index.tsx`;
- a route rendering `<HostedGame game="<game>" title="..." />`.

Then publish its folder with `npm run game:publish -- <game> <dir>`. The game should post `ready` once drawn and `back` for its own back button.

## Tests

`npm run test:e2e -- hosted`:
- before anything's published: "It isn't up yet." and Back;
- publishing a fixture build, then the card and Play;
- the iframe loading a file with a space in its path from storage, on another origin;
- the hash carrying the settings;
- the app's music off while it's open;
- the game's own `localStorage` surviving a reload;
- a second publish leaving an open page on its build until it reloads;
- the game's `back` message.

`MEREDDIA_DIST=<a built dist-mereddia>` also publishes the real game and shoots it in the iframe (`e2e/.state/screens/mereddia-iframe-*.png`).
