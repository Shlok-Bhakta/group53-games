---
name: ui
description: The shared UI system (design tokens, shadcn kit, shared parts, landscape primitives, platform quirks). Use whenever building or changing a screen, a component, a sheet, a game's dock or board layout, src/style.css or the themes.
---

# UI

AGENTS.md (Look and feel, Design system) is the overview. This is the catalogue and the rules you need to build a screen without reinventing anything.

## What to use for what

Everything in `src/components/ui/` is shadcn (style `radix-nova`, Radix from the single `radix-ui` package), restyled to our tokens, type scale and radius steps. Bring in a new kit component with `npx shadcn@latest add <name>`, then fix its import (`cn` from `@/lib/utils`; the CLI sometimes writes `from "cn"`) and restyle it: our 7 type sizes, our radii, tokens only, 44px targets. Delete anything it replaces.

- **Pressable anything**: `Button` (`@/components/ui/button`). Never a raw `<button>` or `motion.button`. Defaults to `type="button"`; `pending` sets `aria-busy`, disables it and swaps the icon for a spinner; `icon` is the leading icon; `asChild` styles a `Link`. Focus ring is `ring-ring` (the theme's primary) offset on the background, so it shows in every theme.
  - Variants: `default` (primary), `secondary`, `outline`, `ghost`, `destructive`, `link`, `card` (a card surface; gets `data-slot="card"`), `float` (see-through over a fullscreen game), `row` (a list row), `bare` (no surface of its own: the child is the surface, like a `PlayerCard`, a colour swatch styled inline, or a theme preview).
  - Sizes: `default`/`sm` (44 tall), `lg` (48), `xl` (56, primary actions), `dock` (60, icon over label), `dock-square` (56 square tool), `icon` (44 round), `icon-lg` (48 round), `icon-square` (44, rounded-md), `icon-xl` (56, rounded-lg), `float` (44 round, over a game), `pill` (FloatPill as a button), `row` (ListRow, min 44), `tile` (a face over a name, LinkHandoff), `card` (a block wrapping a card, press 0.97), `choice` (a grid choice tile, press 0.92), `option` (a full-width option row, press 0.98), `swatch` (44 round colour dot, press 0.88).
- **Icon-only**: `IconButton` with a required `label` (becomes `aria-label`); the icon is its child. Defaults `variant="ghost" size="icon"`.
- **Async taps**: `AsyncButton` / `AsyncIconButton` (`@/components/AsyncButton`), same props plus an async `onClick`; or `usePending()` → `[pending, run]` and pass `pending` to `Button`. They lock while running and toast errors. Lint refuses an inline `async` arrow in any `onClick` (even on AsyncButton): write `() => join(...).then(() => navigate(...))`.
- **Destructive**: `ConfirmButton` (an AlertDialog). Resign: `ResignButton` (`components/match`).
- **Rows and groups**: `Group` (flat card of rows), `Section`/`SectionTitle`, `ListRow` (leading, title, detail, trailing; `to` = link, `onClick` = button), `MatchRow`, `InviteCard`, `Leaderboard`, `RankTile`, `TurnChip`/`ResultChip`, `Chip` (`tone`: primary, live, win, quiet; built on `Badge`), all in `parts.tsx`.
- **Faces**: `PlayerAvatar` (built on shadcn `Avatar`: the image with a delayed initial fallback, so a broken Discord URL shows the initial), `AvatarStack`, `PlayerCard`. Never a raw avatar `<img>`.
- **Choosing**: `Segmented` (Radix RadioGroup: role radiogroup/radio, which e2e drives) for one of a few; `Toggle` (`ui/toggle`, variants `chip` and `solid`) for pick-any chips; `Switch`; `Slider` (44 tall; thumb has a 44px hit area through `after:`); `SettingsPicker` for a mode's settings.
- **Folding**: `Disclosure` (`ui/disclosure`, on shadcn `Collapsible`; height animated by Motion on a bare wrapper so it closes all the way).
- **Sheets**: `Sheet` (`ui/sheet`) is the only bottom sheet: `title`, `hideTitle` (screen readers only), `closable` (an X, for sheets over a dock), `bodyClassName`, `pinned` (a block between the title and the scrolling body that stays put, e.g. CardEditor's live preview; never `sticky`). Small focused things only. Game menus are `GameMenu` (a right drawer). Scrim is `bg-scrim`.
- **How much**: `AmountSheet`. **Rules**: `Rules`. **Headers**: `LargeTitle` (tabs), `NavBar` (pushed screens; `className` lets a screen hide it), `useGoBack(fallback)`.
- **Game screens**: `GameFrame`, `ActionRail`, `DockNote`, `GameChrome` (`components/game/GameFrame.tsx`); `FullscreenStage`, `FloatingTopBar`, `FloatButton`, `FloatPill`, `floatPill`, `useFullbleed` (`components/game/floating.tsx`); `TurnText`, `SeatDot`, `Countdown`.
- Need something twice, or a second game needs it? Move it into `src/components/` (or `game/`) instead of copying.

## Design system rules

- Type: `text-title-lg` 36, `text-title` 28, `text-heading` 20, `text-body` 17, `text-callout` 15, `text-footnote` 13, `text-caption` 11. Nothing else. `cn()` knows these so they merge with colours correctly. Headings and numbers use `font-display` (the heading font chosen on You); body is the phone's font.
- Radius: `rounded-sm` 8, `rounded-md` 12, `rounded-lg` 16, `rounded-3xl` 28, `rounded-full` (avatars, chips, icon buttons), `rounded-xs` 3 (board cells and pieces only). A ring concentric with a 16px card: `rounded-lg outline-3` on an inset-0 element (outline radius grows with it), not `rounded-[19px]`.
- Colours: tokens only (`bg-card`, `text-muted-foreground`, `var(--tile-green)`, `bg-scrim`, `shadow-shade/25`, `bg-discord text-discord-ink`, `bg-online`). Add tokens in `scripts/gen-themes.py` (`SHARED_LIGHT`/`SHARED_DARK` for theme-independent ones), run `python3 scripts/gen-themes.py` (it rewrites the block between the `gen-themes.py` markers in style.css), then `npx vitest run src/themes.test.ts` (every token present, WCAG AA text, 3:1 chart lines, the poker felt mix). Colours that must not follow the theme live in a `palette.ts` (lint allows hex only there): `src/games/palette.ts` (seat colours), `src/pages/you/palette.ts` (iOS Settings tints), `src/components/palette.ts` (the custom-colour rainbow), `convex/palette.ts` (frame colours). Physical objects in CSS (cards, tiles, Landlord's board) use `@theme static` colours (`--color-paper`, `--color-ll-*`...).
- Surfaces: card surfaces carry `data-slot="card"` (Group, Leaderboard, InviteCard, mode cards, rating tiles, `Button variant="card"`...). Never a card inside a card: e2e (`watchForNestedCards` in fixtures) and lint (`no-nested-cards`) both fail on it.
- No filler: no subtitles, no sentences under headings, no empty-state prose. A state the user must know ("It isn't up yet.") is information.
- Nothing `sticky`/`fixed` with text at the top: iOS 26 blurs ~30pt under the status bar; keep text below `TOP_CLEAR`. Headers start at `var(--safe-top) + 34px` or more.
- Press feedback is `active:scale-[0.97]` over 100ms (Button does it). Nothing loops while idle except live signals, chosen card frames, the real-time countdown and a held tile.
- 44px minimum targets (56 for primary actions). A visually smaller control (Switch, slider thumb) gets an `after:absolute after:-inset-*` hit area; `expectFitsScreen` counts it.

## CSS (src/style.css)

Only Tailwind-native CSS: `@theme` (type scale, `--animate-*` with their `@keyframes`), `@theme static` (physical colours), `@theme inline` (token → colour utilities), `@utility`, `@custom-variant`, `@layer base`. Style in components with Tailwind.
- Classes game markup uses are `@utility`s so the class name keeps working: `stile`, `stile-value` (`stile-blank` modifier), `tiles`/`tile` (`tiles-sm|md|lg|xl`, `tiles-flip`, `tile-green|yellow|gray|hit|blank|empty`), `playing-card*` (`playing-card-back`, `playing-card-slot` modifiers), `poker-felt`, `poker-plate`, `poker-dealer`, `poker-chip`, `poker-tile`, `poker-up`, `frame` (`data-frame`, `data-glow`), `pa`, `pa-face`, `pa-initial`, `pa-badge`, `pcard*`, `chart-fx`, `online-dot`, `ll-*` (Landlord's board). Modifier classes nested as `&.x` only work alongside their base utility.
- Layout utilities: `font-display`, `px-page` (page gutters, `--gutter-left/right`), `bleed-x` (cancel them), `square-fit` (a square board no bigger than `--fit-h`), `pin-bottom` (fixed bottom that survives a stale iOS viewport), `h-screen-true` (`100dvh` plus the same correction).
- Custom utilities sort with Tailwind's by declaration count, so a one-property utility in markup beats a big custom one; check parity screenshots when you move a rule into `@utility`.
- Motion vs CSS: Motion (`motion/react`) for anything interactive, springy, layout-driven or triggered by state (selection pills with `layoutId`, presence, drags, sheets' contents, scores popping). tw-animate-css (`animate-in fade-in-0`, `animate-spin`) for Radix `data-open`/`data-closed` enter/exit and spinners. `--animate-*` + `@keyframes` (+ an `@utility` if it needs selectors) for looping decorative motion tied to a class (frames, card effects, the tile flip), always with a `prefers-reduced-motion` off switch. `MotionConfig reducedMotion="user"` covers Motion.

## Landscape

Phones rotate; iOS ignores the manifest's `"orientation": "portrait"` (kept for Android until games adopt landscape). Portrait must stay pixel-identical; landscape must not break.
- `phone-landscape:` variant = `(orientation: landscape) and (max-height: 500px)`: phones on their side, never tablets or desktop.
- `usePhoneLandscape()` (`src/components/game/landscape.ts`) is the same query in JS. Use it when a screen must render something once in a different place in landscape (players beside the board, a single "Hand N" line) instead of rendering it twice and hiding one copy with CSS: hidden copies still match text and label locators, so e2e finds two.
- Safe areas are read only through `--safe-top/right/bottom/left` (set from `env()` in `@layer base`), never `env()` directly, so tests can override them on `<html>`. In landscape the notch side is left or right (59px on an iPhone 15 Pro), bottom 21.
- The shell: `<main>` uses `px-page`; in landscape the gutters become `max(1rem, safe side)`, lists cap at 36rem of content, and a page containing `[data-wide]` (GameFrame, FullscreenStage) goes full width. Sheets center at `max-w-lg` and scroll their body; GameMenu pads the right safe area; the hosted-game iframe sits inside the side insets.
- `GameFrame` (`children` board block, `dock`, `aside?`, `tight?`): portrait unchanged (board block, dock under it). Landscape: a grid with the board on the left, height-sized (it sets `--fit-h`; give the board `square-fit` instead of `w-full aspect-square`), and a side column with the chrome on top, `aside` (players; hidden in portrait, so render the portrait players inside the board block with `phone-landscape:hidden` and pass them again as `aside`) and the dock at the bottom.
- `GameChrome` (`title`, `onBack`, `onMenu`): MatchScreen wraps every game in it; GameFrame draws back, title and menu in its side column, and MatchScreen hides its NavBar in landscape whenever a `[data-game-frame]` is on the page. Games don't touch it.
- `ActionRail` (`children`, `className`): the dock's buttons, an equal-width row in portrait and a column on the side in landscape ("the 3 buttons on the side"). Wrap a dock's buttons in it.
- `FloatingTopBar`: in landscape it becomes a vertical rail on the left (back on top, the pill, the menu pushed to the bottom), clear of the safe area. Fullscreen games keep their own floating docks; give them `phone-landscape:` placements that respect `--safe-left/right`.
- Adopting in a game: use GameFrame or FullscreenStage, `square-fit` on the board, `ActionRail` in the dock, `aside` for players, `var(--safe-*)` and `pin-bottom` instead of `env()`/`bottom-0`; then add the screen to `e2e/landscape.spec.ts`.
- Test: `e2e/landscape.ts` has `LANDSCAPE`/`PORTRAIT` sizes, `SAFE_LANDSCAPE`/`SAFE_PORTRAIT`, `simulateSafeAreas(page, insets)` (persists across navigations), `rotate(page, to)`, `screenProblems`/`expectFitsScreen(page, safe?)` (no sideways scroll; every visible interactive element clear of the side safe areas, on screen if pinned, at least 44px counting `::before/::after` hit areas; `<main>` on screen; any `[data-game-board]`, open sheet or alert dialog fully on screen), and `barGap(page)`. Wait for sheets with `holdsStill` before checking. `npm run test:e2e -- landscape`.

## Platform quirks (harvested)

- iOS standalone can keep a **stale layout viewport** after a rotation, the keyboard or coming back from the background: `position: fixed; bottom: 0` then lands well above the real bottom (the tab bar floated 70% down Home on iOS 26). `useViewportGap` (shell.tsx, mounted in `App`) measures where a fixed bottom probe lands against `visualViewport.offsetTop + height` on resize, orientationchange, pageshow, visibilitychange, focusout and visualViewport resize/scroll (re-checked at 0, 250 and 750ms, since iOS settles late), nudges the scroll by a pixel once to make iOS recompute, and writes what's left to `--viewport-gap` (and `html[data-viewport-gap]`). `pin-bottom` / `h-screen-true` apply it; it never goes negative, so an open keyboard leaves bars where iOS puts them. Document scrolling stays (an inner scroller would lose tap-the-status-bar-to-top). Chromium can't reproduce the bug; the e2e checks the bar through rotations and resizes, and fakes a taller visual viewport to check the correction.
- iOS also places fixed bottom bars against a shorter viewport when the page is shorter than the screen: `html, body { min-height: 100% }` and `#root { min-height: 100lvh }`.
- iOS 26 blurs ~30pt under the status bar in standalone apps, unremovably: `TopEdge` covers it with a solid strip (hidden under `[data-fullbleed]`, which `useFullbleed` sets).
- `black-translucent` always draws the clock and battery white: light themes get a soft dark gradient behind the status bar (`@media (display-mode: standalone)` in base).
- iOS reads `theme-color` for the status bar and may not parse oklch, so `theme.tsx` converts through a canvas; `index.html` paints the saved page colour before the stylesheet arrives so a cold start never flashes white.
- iOS offers saved passwords on single-line fields: the tagline is a one-row textarea.
- iOS only unlocks audio from a whole tap; `notifications.ts`: the permission prompt only shows when it's the first await in the tap handler.
- iOS `:active` needs a touch listener; React's root listeners provide it, so `active:` press styles work.
- U+FE0E after suit glyphs stops iOS swapping in emoji.
- Sonner uses `mobileOffset` on phones, not `offset`: set both.
- react-router counts in-app history in `history.state.idx`, which a replace keeps at 0; `useGoBack` falls back when it's 0.
- Convex queries only re-run when data changes, never when time passes: anything showing "ago", an expiry (Rematch's offer) or an online window reads `useNow`.
- A frame (iframe) doesn't get the phone's safe areas: HostedGame insets it by `--safe-*` and `TOP_CLEAR` itself.
- `updateViaCache: "none"` on the service worker so deploys land on next load.
- Chromium doesn't emulate `env(safe-area-inset-*)`: tests set `--safe-*` instead.
- Playwright's `toBeVisible` needs a non-empty box: an absolutely-positioned anchor with only absolute children reads as invisible (the tap ripple has a real 36px box for this).
- In-app browsers (Discord, Instagram) can't add to the home screen: WKWebViews without "Safari/", Android WebViews with "; wv)".

## Parity

Before/after screenshots for any visual change: `SCREENS=1 npm run test:e2e -- screens poker-screens scrabble-screens` writes `e2e/.state/screens`; compare with `node scripts/screens-diff.mjs <before> <after> <diff>` and open the diffs. Times, random names and live tap ripples move between runs.
