---
name: game-stonks
description: The Stonks package's feature map. Use for any Stonks work: the S&P board and live index weights, the queries and how often each changes, paper trading and the fill rule (the anti-cheat), buying power, currencies, market hours and late feeds, profiles and net worth history, player colours, search and the watchlist, storage costs and the rules that keep writes down, prewarming and skeletons, charts and motion, landscape, the Rust sidecar (stonks/), the link preview and the tests.
---

# Stonks

AGENTS.md's Layout (where a package's parts live) and On kiwi → Convex storage (why rewrites fill the disk) are the background. This is everything else you need to change Stonks without slowing a tap, breaking the anti-cheat or filling kiwi's disk.

## What it is

One shared game with no lobby and no `GAMES`/`MODES` entry: everyone in `users` has $10,000 of paper money to buy, sell, short and cover anything on Yahoo Finance, ranked live by net worth. The board leads with the S&P 500's 20 biggest companies ranked by their live share of the index. It's a plain `GameCard` (`STONKS` in `src/games/index.tsx`, art `StonksBanner`, `prefetch: prefetchStonks`); routes `/stonks` (board), `/stonks/:symbol` (a stock, any Yahoo ticker), `/stonks/u/:id` (a player), each in `NotificationsRequired` + `Suspense` with its skeleton (`src/App.tsx`). The Crew and You tabs link to `/stonks/u/<id>` ("Stonks profile").

## File map

- `convex/stonks.ts`: every Convex function. Never rename: phones and the sidecar call them by path. Phones read `board`, `sparks`, `chart`, `profile`, `quote`, `portfolio`, `crew`, `player`, `trades`, `holders`, `worthHistory`, `search`; phones write `order`, `cancelOrder`, `lookup`, `watching`. The sidecar reads `watchlist`, `deepWatch`, `hot`, `freshness`, `pendingLookups` and writes the internal `ingest`, `series`, `snapshot`, `setProfile`, `holdings`, `addSymbols`, `lookedUp`. Crons (`convex/crons.ts`): `sweepViews` every 30s, `sweepSeries` every 6h, `recordWorth` every 15 min, `thinWorth` every 6h. Exports `QuoteView`.
- `convex/stonks/` (pure, shared with phones): `board.ts` (`Point` = `[ms, price]`, `MINUTE`, `minuteOf`, `liveWeight`, `contribution`, `downsample`, `withMinute`), `market.ts` (`INDEX` = `^GSPC`, `RANGES` 1D 1W 1M 1Y 5Y, `sessionDay`, `nextOpen`, `marketClock`, `display`, `marketOf`, `Market`, `Instrument`), `trade.ts` (`START_CASH`, `MIN_ORDER`, `opens`, `netWorth`, `buyingPower`, `refusal`, `fill`, `fxPair`, `toUsd`), `profile.ts` (`profileStats`, `statsValidator`, `ProfileStats`, `newsItem`), `schema.ts` (`stonksTables`).
- `src/games/stonks/`:
  - `load.tsx` (in the main bundle): `loadStonks` (a tracked dynamic import), `prefetchStonks`, `StonksBoardRoute`, `StockRoute`, `PlayerRoute`, and re-exports the skeletons. `Stonks.tsx` is the chunk it downloads (`StonksBoard`, `StockPage`, `PlayerPage`).
  - Screens: `Board.tsx` (board, `Row`, `Movers`, `Breadth`, `Sources`), `StockPage.tsx` (`StockPage`, `StockStats`, `ProStats`), `Profile.tsx` (`PlayerPage`, `GainPie`).
  - Parts: `StockChart.tsx` (hero price plus chart plus range picker; `axisFor`, `dayDomain`, `withLive`, `dirOf`, `earningsSoon`, `MarketState`), `Chart.tsx` (`PriceChart`, `Sparkline`, `CrewChart`, `movingAverage`, `valueAt`, `Dir`), `Crew.tsx` (`CrewBoard`, `CrewTrades`, `worthLine`), `Positions.tsx` (`PositionRow`, `Positions`, `Waiting`, `YourPosition`, `WhoHolds`), `Trade.tsx` (`Money`, `useFillNotice`, `whenFills`, `VERB`, `DID`, query types), `TradeDock.tsx` (`TradeDock`, `TradeSheet` on `AmountSheet`), `Search.tsx` (`StockSearch`, `PICKS`), `News.tsx`, `bits.tsx` (`Change`, `Flash`, `Stat`, `RangeRow`, `Pairs`, `ink`, `cardColor`, `playerColors`, `gainColor`, `useWarmWhileSeen`, `useHereNow`), `Ticker.tsx`, `pro.tsx` (`usePro`, `ProToggle`), `warm.ts`, `format.ts`, `skeletons.tsx` (`S`, `PINNED_DOCK`, `STOCK_COLUMNS`, `WIDE_NAV_BAR`, the three skeletons), `StonksBanner.tsx`.
- `og/games/stonks.mjs`: link previews for `/stonks` and `/stonks/:symbol` (price, the day's change, the 1D line; the board's description lists the top six's moves). Colours under `STONKS` in `og/palette.mjs`. Its font has no arrows, so changes are signed in ASCII.
- `stonks/` (Rust): the sidecar, below.
- Tests: `convex/stonks/server.test.ts`, `convex/stonks/trade.test.ts`, `e2e/stonks.spec.ts`, `e2e/stonks-screens.spec.ts`, `e2e/stonks-crew-screens.spec.ts`, the sidecar's inline `#[cfg(test)]` modules.

## Invariants

- **Phones only read market data.** The sidecar is the only writer of prices, charts, profiles, holdings and symbols, through internal mutations with the admin key. Phones never talk to Yahoo: search asks through `stonks:lookup`, and the sidecar answers.
- **An order never fills at the price on screen.** It waits in `stockOrders` and fills on the first regular-session trade stamped after the tap (`order.at < time`). Don't add a "fill now" path; don't fill on pre-market, after-hours or overnight trades.
- **Don't add row rewrites.** Every rewrite keeps an old version for the retention window (3 days on kiwi). Work out what a new write costs a day before adding it (see Storage).
- **Never make anyone wait on a tap.** Whatever's tappable next is warmed; every height is fixed; a skeleton is exactly the size of what it stands for and never shows between the Games card and a stock (e2e enforces it).
- `convex/stonks/` stays pure (no `_generated/server`, no browser APIs): phones import `market.ts`, `board.ts`, `trade.ts`, `profile.ts`.
- `convex/stonks/market.ts`'s `HOLIDAYS` and `EARLY` must match `stonks/src/market.rs` (both run through 2027; extend both together).
- Up and down always carry a caret and a sign, never colour alone. Chart colours are `--up`, `--down`, `--series-N`, `--primary`, `--muted-foreground` (3:1 on cards, checked in `src/themes.test.ts`).

## The board and live weights

- `stonks:holdings` stores SPY's daily file in `stockIndex` (key `spx`): `asOf`, the top 25 by weight with each one's close that day (`base`), and the index's close (`indexBase`).
- A stock's live share is `w0 · (p/p0) / (S/S0)` (`liveWeight`, against `^GSPC`); with any of those missing it's just `w0`. `ranked()` (in `convex/stonks.ts`) gives every holding with a quote its live weight, `before` (the weight at the previous close), `rank`, `baseRank` (rank at the previous close; a row's ▲1 is `baseRank - rank`), `points` (`contribution`: index points it has moved the S&P today, `before/100 · (p/prev − 1) · S_prev`), `relVolume` (volume over `stats.avgVolume`) and `earnings`. Holdings with no quote yet wait off the board.
- `board` returns the top `BOARD_ROWS` (20) of the `STREAMED_TOP` (25) that stream, so a 21st can climb in live; `up`/`down` counts, `share` (the top 20's total weight), `movers` (six biggest `|points|`), `feeds` (each source's state). With no rows the board says "Waiting for prices".
- A stock's page shows its share and rank only for index members (`quote` runs `ranked()` only then, since that depends on every price).

## Queries split by how often they change

Every result goes to every subscribed phone on every change, so keep fast-changing data in small queries.
- `board` (prices, every second while trading): small rows.
- `sparks` and `chart`: change once a minute, when a minute of trading finishes onto the day's chart. `sparks` downsamples each holding's day to 48 points (`downsample`: last price per time bucket, first and last kept). The phone draws the live price on the end (`withLive`).
- `profile` (key stats and news): about every half hour.
- `quote` adds `rate` (dollars per unit of its currency) and the board fields for members.

## The day's chart and the session

- The day runs 4am to 8pm New York. `marketClock(ms)`: `pre` from 5.5h before the open, `open` 9:30 to 16:00 (13:00 on `EARLY` days), `post` 4h after the close, else `closed`; `sessionDay` belongs a weekend or holiday to the last trading day.
- `ingest` writes the latest trade per symbol into `stockQuotes` (`minute`, `minuteClose` track the minute in progress). A trade older than the stored one is ignored (a standby source catching up). When a new minute starts, the finished minute goes onto the chart (`addMinute`, rewriting only its hour in `stockDayHours`). A gap over `OVERNIGHT_GAP` (4h) is a new day: the chart starts over (`setDay(ctx, symbol, [])`) and the last regular-session price (`regularPrice`) becomes `prevClose`. Pre-market and after-hours trades draw the chart but don't move `regularPrice` and don't fill orders.
- `series` replaces a range's history: 1D goes through `setDay` (only changed hours rewritten, missing hours deleted, and the old one-row `stockSeries` 1D deleted), other ranges through `setSeries` (skipped when `same`). The 1D call also carries `prevClose`, name, the day's and year's stats, currency, type, exchange, `hint`, `periodOpen`/`periodClose`. If history is newer than the quote (something nobody watched), its last point becomes the price (`source: "history"`).
- On the phone, the 1D axis is `dayDomain` (4am to 8pm) when anything traded outside the session (the closing auction prints a few minutes after the bell and still counts as the session: `axisFor`), else just the session, so the index's line fills the chart. Outside the regular session the line is drawn lighter (`regular`). Longer ranges space points evenly, so nights and weekends leave no gaps. After hours or pre-market, the move since the bell is its own `Change` line ("After hours", "Pre-market", "Overnight").

## Trading and the fill rule

- `order { symbol, side, dollars?, shares? }`: needs a quote ("You can't trade that."), passes `refusal` (no long and short in one stock: "Cover your short first.", "Sell your shares first.", "You don't own any.", "You aren't short."). Opening (buy, short) takes dollars, at least `MIN_ORDER` ($1), at most what's free after waiting orders ("You have $X to invest."). Closing takes shares, or none for all of it. The same order within `DOUBLE_TAP_MS` (3s) returns the first one.
- `fillWaiting(symbol, price, time)` runs inside `ingest` (regular-session ticks only) and `snapshot` (Yahoo's latest regular-session trade, whenever it was). Every waiting order with `at < time` fills at that price in dollars; an order is refused at fill time if the book no longer allows it (status `refused`, `reason`, and a push). No rate for its currency yet: it waits for the next trade. A fill writes the account, the position (deleted under `DUST` shares), the order (`filledAt`, `price` in the quote's currency, `currency`, `filledShares`, `amount` in dollars, `realized`), then `writeWorth`.
- Pushes: a fill that waited over `WATCHED_FILL_MS` (30s) pushes its owner ("Bought NVDA", "$1,000.00 at $250.00"); a fill against a friend (a short or sale when they're long, a buy when they're short) pushes them ("Chris shorted NVDA", "And you own it."); test players never push. Tag `stonks-<symbol>`.
- `cancelOrder` only your own, only while waiting.
- The phone says when it'll fill (`whenFills`): "Next trade", "Next trade, about 15 min" on a late feed, "At the open, Mon 9:30 AM ET", or "When it next trades". `useFillNotice` toasts and plays `land` when one of my orders fills while I'm looking (what had filled before the screen opened is old news).
- `TradeDock`: Buy/Short, or Sell/Buy more, or Cover/Short more, pinned to the bottom (`PINNED_DOCK`: `sticky pin-bottom`, `bleed-x`/`px-page`, padded by `--safe-bottom`), disabled until the rate is known (and opening disabled under $1 free). `TradeSheet` (`AmountSheet`): opening picks dollars (10/25/50% of free, rounded to $10, and Max = exactly what's free), closing picks a percentage of the position (25/50/75%, All = no `shares` sent).

## Accounts

Nobody has a row until they trade: `bookOf` treats a missing `stockAccounts` row as `START_CASH` and no positions, and `fillWaiting` inserts the row on a player's first fill (not when they join or place an order). `standings` counts a player as `traded` only once that row exists, so `writeWorth` only records people who've had a fill; on the crew chart everyone else's line sits at $10,000 (`worthLine` falls back to the start).

## Buying power

A dollar of net worth backs a dollar of positions, long or short: `buyingPower = netWorth − Σ|shares|·price`. No leverage; short proceeds go in cash but can't be spent; a squeeze can take it below zero (shown as $0 free). Waiting orders' dollars are set aside. `netWorth = cash + Σ shares·price` (short shares are negative). Prices default to the position's `avg` when unknown.

## Currencies

Books are in dollars. A quote has `currency`; `fxPair` gives `<CUR>USD=X` (null for USD), `toUsd` divides by `MINOR` (GBp, GBX, ILA, ZAc, ZAC are hundredths). The pair is added to `watchlist` for anything watched. Conversion happens at the fill (`amount` and `avg` in dollars) and on every read (`usdPrices`), so a currency's moves count. A trade's `price` is shown in its own currency (`price(n, unit)`; `unitOf` is "" for indexes and currencies). Futures are treated as one unit (no contract sizes).

## Market hours and late feeds

`marketOf(quote, now)`: crypto is `always` (open, no day); US equities, ETFs and indexes (exchange in `YAHOO_NEW_YORK_EXCHANGES`, or none) run on `marketClock`; anything else is `other`, open when Yahoo's `state` is `REGULAR`, with `periodOpen`/`periodClose` as its day (not for currencies, futures, funds). `late`: when the quote arrived within 2 min and `recv − time` is 5+ minutes (Tokyo and Korea run 15 to 20 late with honest timestamps), the hero says "15 min late" and orders wait that long, because they fill on a trade stamped after the tap. Some things never tick on the stream (`ES=F`, `JPYUSD=X`, funds): batch quotes price them and fill their orders. `MarketState` shows "Open 24/7", "Market open", "Pre-market", "After hours", "Opens Mon 9:30 AM ET", or an earnings chip when a report is due this week (`earningsSoon`: from 12h ago to 6 days ahead).

## Profiles and net worth history

- `player { userId }`: the card (`card(user, profile)` from `convex/profiles.ts`), worth, gain, `idle` (worth not backing a position; with the positions it adds to net worth), place of all, positions, waiting orders (read-only unless it's yours), record (trades, wins and losses on closes, realized, best, worst) and the last 50 fills. Everything is public.
- `PlayerPage`: `PlayerCard` with the card's colour spilling out behind it (`cardColor`), net worth with `Change`, the worth line (`PriceChart` with the player's colour and glow, plus their foil or CRT over it through `.pcard-fx.chart-fx`), `GainPie` (slice size = position size, colour = `gainColor`: paler for under 2%, darker past 5% and 10%, grey under 0.25%; `--deep` keeps the darkest visible on dark themes; idle is `--muted`; tap a slice for its share and move), positions with matching swatches, Waiting, Record, History. A missing player shows just the nav bar.
- `stockWorth` rows (`t`, `worths: [{u, w}]` for everyone who's traded): `writeWorth` after any fill and every 15 minutes (`recordWorth`), skipped if nothing changed; `thinWorth` keeps one per hour past 3 days and one per day past 14. `worthHistory` returns it all. No back-fill. `worthLine` turns it into one player's points with the live worth on the end.
- `CrewBoard`: everyone on `CrewChart` (a line per player, `$10,000` dotted, "me" drawn last and thicker, live dots on the ends), and the rows are the key (a swatch per line); a finger on the chart moves every row to that moment (`valueAt`). Rows warm each player's profile.

## Player colours

`playerColors(crew)` gives each player a colour for the whole game, whoever's winning: their frame's colour if it's free (`cardColor`: a custom-colour frame's `frameColor`, or the built-in `FRAME_HUES` of gold, fire, ice, toxic from `convex/palette.ts`; never `FRAME_COLOR.white`, which can't be seen as a line on light themes; holo and RGB have none), else the next `--series-N` slot in join order, dashed past eight.

## Search and the watchlist

- `stockSymbols` is seeded with about 11,700 US listings (`addSymbols`, from the sidecar's Nasdaq files) and grows with whatever Yahoo answers. `search { q }`: an exact ticker first, then Yahoo's order for this search (`stockLookups.symbols`), tickers starting with it, then the search index on `symbol + symbol-with-spaces + name`; 20 rows with their quote if any.
- `StockSearch` answers every keystroke from Convex; 200ms after typing stops it calls `lookup` (normalized, at most 40 chars; asked again only after `LOOKUP_DAYS`, 7), the sidecar picks it up from `pendingLookups` and answers `lookedUp`, and results join live. Results stay up between keystrokes (`held`). Focusing shows `PICKS` ("Not just stocks": crypto, gold, oil, EUR/USD, Nikkei, Toyota, SAP); while searching, the rest of the board steps aside. Any Yahoo ticker works as a link.
- `watchlist` = the index, its top 25, anything held or waiting, everything in `stockViews`, and the FX pairs for those. `deepWatch` = the same minus what's only been "seen" (gets history, stats and news too). `watching { symbols, level }` writes `stockViews` (expires after `VIEW_MS`, 90s; "open" outranks "seen" while it lasts; only `YAHOO_TICKER`-shaped symbols, at most 40). `report` in `warm.ts` batches these 60ms after they appear, at most once per symbol and level per 40s, and never while the page is hidden. A search row on screen streams its price; a stock's page reports "open" every 45s. `sweepViews` deletes expired views.

## Storage: the rules that keep writes down

On 2026-11-02 a day wrote about 700 MB of old versions to keep 5.7 MB of current data. Convex keeps the old version of every rewritten row until retention (`DOCUMENT_RETENTION_DELAY`, 3 days on kiwi) deletes it. So:
- **`hot`**: the sidecar writes every trade only while someone's on a Stonks screen (`stockViews` non-empty returns `["*"]`, fed by `useHereNow`, which reports the index as "seen" every 45s and on visibility changes) or for symbols an order waits on. Otherwise one write per symbol per minute (the last trade of that minute); whatever was held back goes in as soon as someone arrives.
- A day's chart is one row per hour (`stockDayHours`): a new minute rewrites one hour at most.
- `same` (JSON equality): `setSeries`, `setDay` per hour, and `setProfile` write nothing when nothing changed; feeds only when state or detail changed; symbols only when name, type or exchange changed; a row's `at` is when it last changed (`freshness` reads those so a restarted sidecar doesn't refetch everything).
- `sweepSeries` deletes `stockSeries` and `stockDayHours` untouched for 14 days (`KEEP_SERIES_MS`), 200 and 500 at a time; what's held or at the top is refetched well inside that.
- `stockWorth` is thinned; `writeWorth` skips identical rows.
- Before adding anything that rewrites a row often, multiply writes per day by the row's size. SQLite never shrinks: only `VACUUM` with `convex` stopped. `convex/stonks/server.test.ts` counts rewrites of the day's chart: keep those tests passing.

## Never waiting on a tap

- `warm(convex, query, args, ms)` (`warm.ts`) calls `prewarmQuery` with `extendSubscriptionFor` and renews only past half its time, so a subscription is never doubled. Every key goes into `window.__stonksWarmed` for e2e.
- What's warm: the Games card on screen or Play touched runs `prefetchStonks` (the code chunk and `warmBoard`: board, sparks, portfolio, crew, trades, worthHistory, the index's quote, profile and chart in the saved range); a board, position, mover or search row within 120px of the screen warms its stock (`useWarmWhileSeen`, an `IntersectionObserver`, renewed every 45s: quote, profile, holders, trades, chart in the saved range and 1D); `pointerdown` on a row warms it as "open"; a stock warms every range (`warmRanges`) and the board; crew rows and their `pointerdown` warm `player`; the profile warms the board.
- The code isn't `React.lazy`: `loadStonks` keeps one tracked promise (`status`, `value`) read with `use`, which returns synchronously once settled; a failed download clears it so the next try starts again.
- Skeletons live in the main bundle and carry `aria-busy`. Every height is in `S` (rows `h-16`, crew `h-14`, stats `h-12`, ranges `h-[68px]`, movers `h-9`, search `h-11`, segmented `h-[52px]`, hero lines, `chart` 200, `crewChart` 190): change one, change its skeleton. `useHeld` keeps the old chart up, faded, while a new range loads. A stock with no quote shows its skeleton for 8s (its first quote is a moment away), then "No prices for X".
- The board's `Row` is memoized on its own numbers (price, time, ranks, prevClose, relVolume, earnings, weight within 0.005, its spark, the day, Pro, and the hour), so a trade redraws one row.

## Charts and motion

- `PriceChart` (`role="slider"`, labelled with the stock, period and price; arrow keys and Escape scrub, `aria-valuetext` is the point's time): a 2px line in `--up`/`--down` (or a player's colour), a faint wash, a dotted previous close, a ringed end dot. A finger snaps a hairline to the nearest point (`data-scrubbing`) and `onScrub` puts that point's price and time in the hero. A new range or stock draws in from the left (`reveal` key), the live end glides to each trade, and each trade sends one ping (`live`, no loop). Pro adds the 50- and 200-day averages on 1Y and the 10- and 40-week on 5Y, with a key.
- `CrewChart` (`role="img"`), `Sparkline` (64x30), `Ticker` (digits roll up or down, only changed digits, slots counted from the right; plain text when scrubbing, `instant` or reduced motion), `Flash` (a 0.9s tint in the move's colour), `RangeRow` (a dot springing along low to high, an optional mark for the analysts' mean), the movers' diverging bars (`rounded-r-xs`/`rounded-l-xs` on the free end), rows sliding to new ranks (`layout="position"`) with their ▲/▼ popping.
- Nothing loops while idle.

## Pro

`usePro` (`localStorage` `stonks-pro`, shared between screens through a `useSyncExternalStore` listener set): the round Pro button in each nav bar (`aria-pressed`). Adds key stats (`ProStats`: market cap, P/E, forward P/E, EPS, dividend, averages, shares, margins, growth, short interest, ex-dividend, next earnings with the estimate), analysts' targets as a `RangeRow` with the mean marked plus rating, About (sector, industry, people, the summary clamped to four lines until tapped, the website), the moving averages, and relative volume on board rows. The range picker is remembered on the phone too (`stonks-range`, `savedRange`).

## Landscape

Portrait is unchanged. The board and profiles are lists capped by the shell (36rem). The stock page sets `data-wide` so it uses the full width, and `STOCK_COLUMNS` puts the chart (with your position and waiting orders) on the left and Stats, Pro, the crew, trades and news on the right; `WIDE_NAV_BAR` drops the nav bar's negative margin so Back clears the side safe area. `StockSkeleton` has the same columns. The trade dock stays pinned at the real bottom (`pin-bottom`), its buttons inside `px-page`, clear of the side safe areas.

## The sidecar (`stonks/`)

Rust, one binary, about 8 MB of RAM. `CONVEX_URL` (kiwi: `http://convex:3210`) and `ADMIN_KEY_FILE` or `ADMIN_KEY`. It logs `stonks: connected` once up (dekit's ready signal), follows `stonks:watchlist`, `deepWatch`, `pendingLookups` and `hot` live (`follow()`, only real changes), reads `freshness` once, and runs these tasks:
- `yahoo.rs`: Yahoo's streamer (`wss://streamer.finance.yahoo.com/?version=2`, no key, subscribe/unsubscribe diffs against the watchlist, base64 protobuf: id, price as float32 tidied to 7 digits, time, marketHours 0..4 = pre/regular/post/extended/overnight, volume, day high and low). Reconnects 1s doubling to 60s; bails if silent for 3 minutes while trading. Reports live/down.
- `nasdaq.rs`: the standby, polling `api.nasdaq.com` every 3s for US tickers Yahoo stops covering in the regular session only. Nasdaq gives the last sale but not its time, so a poll counts as a trade only when the day's volume went up since the poll before, stamped `before.at + 1` (`traded_since`): a stale last sale never fills an order.
- `router.rs`: `RANK = [yahoo, nasdaq]`; a source covers a symbol if it isn't down and ticked it within 30s; a tick passes unless a better-ranked source covers it. Adding a source: a module that sends `Event`s and a place in `RANK`.
- `rest.rs`: every Yahoo REST call goes through one pacer, a slot every 250ms; a 429 pauses everything 30s, doubling to 10 minutes, reset by any good answer. The quote summary and batch quotes need a cookie from `fc.yahoo.com` and a crumb, refetched on 401/403.
- `snapshot.rs`: batch quotes, 150 symbols a request, for the watchlist: every 20s for a symbol whose market is open but which hasn't ticked in 20s, every 5 minutes otherwise; sends `stonks:snapshot` with `regularMarketPrice`/`regularMarketTime` (never the after-hours price), name, prev close, ranges, currency, type, exchange, `state`, `hint`.
- `history.rs`: Yahoo's chart endpoint for `deepWatch`, every symbol's 1D first. 1D (1m, with pre and post) every 15 min while trading and 60 otherwise; 1W 60/360; 1M 120/360; 1Y 6h; 5Y 12h; "trading" also means it ticked in the last 5 minutes (Tokyo, crypto). Sends `stonks:series`; the 1D call carries the meta stats and `currentTradingPeriod`.
- `profile.rs`: for `deepWatch`, stats (quote summary, every 30 min while trading, 6h otherwise; not for currencies, indexes, crypto) and news (Yahoo search plus the RSS feed, every 10 min while trading, 60 otherwise), sent with `stonks:setProfile`. `pick_news` keeps a company's stories only if the title or summary names it (its name, `ALIASES` like Google for Alphabet, or the ticker as a whole case-sensitive word of 2+ letters), newest 8; the index keeps everything.
- `holdings.rs`: SPY's daily xlsx from State Street every 6h, the top 25 with each one's close on the as-of day (`base`) and the index's, sent with `stonks:holdings`.
- `universe.rs`: Nasdaq's listing files daily, `stonks:addSymbols` in chunks of 500. `lookups.rs`: answers `pendingLookups` from Yahoo's search with `stonks:lookedUp` (tradable types only).
- `sink.rs`: every write, one at a time. Hot symbols flush at most once a second; others are `HeldBack` to the last trade per finished minute and released the moment they turn hot. Statuses flush at once. `stonks:ingest` gets `ticks` plus `feeds`. Optional fields are left out, never null.
- `market.rs`: the same clock and holidays as `convex/stonks/market.ts`.
- Run: dekit's `stonks` task (`node scripts/dev.mjs stonks`: `cargo run` in `rust:1-alpine` inside the backend's network). Build: `cargo build --release` in `stonks/`. Tests: `cargo test --manifest-path stonks/Cargo.toml` (protobuf decoding, Nasdaq's volume rule, failover, the pacer, sessions, the sink's minute rule and hot release, batch quotes, the 1D chart, the quote summary, the news filter, SPY's file, lookups, the listing files; fixtures in `stonks/tests/fixtures`). On kiwi: `docker compose logs stonks` shows which source covers what. Deploys rebuild it.

## Driving it in tests

- Unit (`convex/stonks/server.test.ts`, convex-test with fake timers): feed `internal.stonks.holdings`, `series`, `ingest` (ticks with `time`, `recv`, `source`, `session`), `snapshot`, `setProfile`, `lookedUp`, then read the public queries as a signed-in player. `tickAt` stamps a regular-session trade; orders fill on ticks stamped after `order.at`. Pushes are pending `push:sendToUser` jobs. Rewrites are counted by reading `stockDayHours` before and after. The rules on their own: `convex/stonks/trade.test.ts`.
- e2e (`e2e/stonks.spec.ts`): `seed()` writes three holdings, a 1D walk from 4am to now, a 1W series, profiles and news, and a closing tick for each through `admin()`. `trade(symbol, price)` is a regular-session tick stamped 1s ahead (what the sidecar would send), which fills whatever's waiting. `warmed(page, ...prefixes)` waits for `window.__stonksWarmed` keys and `convexIdle`; `watchForSkeletons`/`sawSkeleton` record any `[aria-busy=true]` from then on. `rowOrder(page)` reads the board's order from the row links' labels. Locators: regions "Your money", "Crew" (exact), "Your positions", "Waiting to fill", "Crew trades", "S&P 500 chart" and "<name> chart", "Stats", "Key stats", "Analysts", "About", "Your position", "Crew in this stock", "Trades in this stock", "<name>'s money", "Record", "History"; links "<TICKER>, <name>", "<name>'s profile", "Your profile", "<name>'s position in NVDA"; the chart is `getByRole("slider", { name: /^Microsoft Corporation, today,/ })`; the crew chart `getByRole("img", { name: /^Everyone's net worth/ })`; buttons "Buy"/"Short"/"Sell"/"Cover" (exact), "Buy more", "Pro mode" (`aria-pressed`), "Cancel Buy NVDA"; the sheet's presets "10%"..."Max"/"All" and confirm "Buy $1,000.00"; the searchbox "Search anything"; ranges are radios "1D".."5Y". `admin().query(anyApi.stonks.hot)` is `["*"]` once a phone is on a Stonks screen.
- Landscape: `simulateSafeAreas(page, SAFE_LANDSCAPE)`, `rotate(page, "landscape")`, `ready`, `expectFitsScreen` on the board, a stock and a profile (with the stats beside the chart and Buy at the bottom). `SCREENS=1` also shoots `light-stonks-landscape-*.png`.
- `SCREENS=1 npm run test:e2e -- stonks-crew-screens`: a crew of five with cards, orders and 26 steps of made-up prices (each followed by `recordWorth`), no network; shoots the crew chart, scrubbing, and my own and a friend's profiles in dark and light. This is the portrait parity check.
- `SCREENS=1 npm run test:e2e -- stonks-screens`: needs `cargo build --release` in `stonks/`; starts the built sidecar against the throwaway backend (real holdings, history, stats, news and prices, so it needs the network and differs run to run), then shoots the Games card, the board, NVDA in every range and Pro, a trade sheet and position, real search, Tokyo in yen and buying Bitcoin. It kills the sidecar before the next test resets the database.
- `node e2e/og-preview.mjs` renders the Stonks previews.

## Gotchas

- Yahoo writes share classes with a dash (`BRK-B`); `display` shows `BRK.B`; Nasdaq wants the dot. Symbols are always stored in Yahoo's spelling.
- A batch quote's trade can be hours old (the 4pm close in the evening): it fills orders placed before it, never after.
- `snapshot` writes quote metadata even when its trade is older than the stored one, but only moves the price when newer.
- `stockSeries` 1D rows are a leftover from when a day was one row; `setDay` deletes them.
- The crew chart's end point is "now" (the board's `useNow(15_000)`), so off hours its end creeps right every 15s.
- `useFillNotice` ignores whatever filled before the screen opened.
- A search blur waits 150ms (`LET_A_RESULT_TAP_LAND_MS`) so a tap on a result lands before the list closes.
- Movers rows are 36px (`S.mover`, `h-9`) to pack the bar chart; their link gets a 44px hit area through `after:-inset-y-1`, which `expectFitsScreen` counts. Keep it if you touch the row.
- Not handled yet: splits and dividends, margin calls on a squeezed short, limit orders, contract sizes on futures, seasons or resets.

## Tests

- `npx vitest run convex/stonks`: the market clock across DST, weekends, holidays and 1pm closes; live weights, contributions and rank changes; minutes onto the day's chart through after hours and the next morning; counting rewrites; `hot`; standby trades never overwriting newer ones; profiles and news; the fill rule (late trades from before the tap, other stocks, after hours, batch quotes); currencies and late feeds; refusals at fill time; buying power under a squeeze; double taps; pushes; search and lookups; net worth history and thinning; profiles adding up.
- `npm run test:e2e -- stonks`: the card and Play, ranking by share, a trade reordering the board, a stock's page with scrubbing and remembered ranges, no skeleton from the Games card to a stock, Pro, a buy filling on the next trade with a second phone watching, a friend's profile through to buying what they hold, short, cover and cancel, search through to trading Tokyo in yen, crypto's hours and a late feed, landscape.
- `cargo test --manifest-path stonks/Cargo.toml` for the sidecar.
