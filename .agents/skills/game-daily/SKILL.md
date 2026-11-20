---
name: game-daily
description: The Dailies package's feature map. Use for any Dailies work: the share-text parsers for Scrandle, Krillion, Connections and the other daily web games, posting a result and its checks (one per game per day, puzzle numbers, dates), today's standings, crowns, streaks and history, the beat-you pushes, the Home strip, the Dailies pages, the link preview and the tests.
---

# Dailies

Players paste what a daily web game copied (Scrandle, Krillion, Connections, Strands, the Mini, Framed, Globle, Worldle, Costcodle, Bandle, Contexto, Nerdle, Quordle, Waffle, Travle, TimeGuessr, Queens, Tango, Zip, Pinpoint) and the crew sees who beat who. Not in `GAMES`: no lobbies, matches or ratings. Wordle is left out on purpose: the crew's streak lives in Discord, and PvP Wordle is its own game.

## Files

- `convex/daily/games.ts`: `DAILY_GAMES` (key, name, url, one-line blurb, `read`), `parseShare(text)` (first game whose `read` matches), `dailyPath`, `SHARE_MAX`. Pure, shared with phones: the paste sheet parses live as you type.
- `convex/daily/days.ts`: day strings (`YYYY-MM-DD`), `localDay`, `addDays`, `plausibleToday`. `convex/daily/standings.ts`: `ranked` (ties share a place), `crownsOf`, `streakOf`, `board`.
- `convex/daily/schema.ts`: `dailyResults`, one row per post (`userId`, `game`, `day`, `puzzle?`, `score`, `display`, `solved`, `grid?`, the raw `text`, `at`), indexed `by_day` and `by_user_game`. Rows are only inserted or deleted, never rewritten.
- `convex/daily.ts`: `post` (through `postResult`, which `testing:dailyAs` also calls), `remove` (your own only), `today({ day })`, `week({ day })`, `history({ game, day })`.
- `src/games/daily/`: `Daily.tsx` (`/daily`: Paste result, today's standings per game, This week, Play; and `DailyHistory` at `/daily/:game`: the last 30 days' board and each day), `DailyStrip.tsx` (Home), `Paste.tsx` (`PasteButton` and its sheet), `Standings.tsx`, `today.ts` (`useToday`), `DailyBanner.tsx`.
- `og/games/daily.mjs`: the page card. `e2e/daily.spec.ts`, `e2e/daily-screens.spec.ts`.

## Rules

- **Score** is normalised so higher is always better, whatever the game says: guesses become `max + 1 - n`, times `100000 - seconds`, a fail 0 (or the groups or boards it did get, still under any win). `display` is what people say out loud ("8/10", "Perfect", "0:52", "+1"); `solved: false` greys it.
- **Day** is the poster's local date, sent by the phone and refused if it's more than a day and a half from the server's clock. A game whose text carries a date (Scrandle, Globle, Worldle, the Mini) must be within a day of it, which stops replays of old Scrandles counting today.
- **One result per game per day.** The same text again returns the first post (double taps); a different one is refused, and so is a puzzle number you've already posted on another day. Removing yours lets you paste again.
- **Pushes**: posting pushes everyone already on today's board for that game whom you beat outright ("Shlok beat your Scrandle", "9/10 vs your 6/10"), tagged `daily:<game>:<day>` so a newer one replaces it. Nobody else is pushed: a post isn't news to people who haven't played.
- **Crowns** count first places (ties share) only in rounds where at least two people played, so playing alone wins nothing. A streak survives until you miss a whole day.
- **Parsers** find the result anywhere in the paste (people add comments), strip U+FE0F where emoji vary, and return null for practice rounds, archives and other modes. A wrong parse is worse than none: add a game only from its real share code or real posts, and put those texts in `games.test.ts`.
- **The Home strip** is one card per game played today, newest first, swiped sideways (snap). It never rotates on a timer (nothing loops while idle); when someone posts it scrolls back to the start, where their game now is, and their face pops in.

## Adding a daily

Write its `read` from the real share text, add it to `DAILY_GAMES` (order is the Play list's order and the order `parseShare` tries them, so a looser pattern goes after stricter ones), and add its examples, a fail and a "better scores higher" pair to `convex/daily/games.test.ts`.

## Tests

- `convex/daily/games.test.ts`: every game's real share texts, text around them, Wordle, practice and archives refused, better always scores higher.
- `convex/daily/server.test.ts`: ranking and pushes, double taps, one per day, puzzle repeats, old dates, removing, the week and history boards.
- `e2e/daily.spec.ts`: a post landing live on the other phone's Home and pushing the beaten player, the one-tap clipboard paste (`clipboard-read` granted), the sheet's live recognition, the refusal toast, removing, landscape. The strip exposes `[data-daily=<game>]` and rows `[data-entry=mine|theirs]`.
- `SCREENS=1 npm run test:e2e -- daily-screens`: Home, the page, the sheet and a history page, dark and light, seeded through `testing:dailyAs`.
