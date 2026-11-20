# kolorly

A five-round daily colour-mixing game for Reddit, built as a **Devvit Web** app. The inline post is the invitation; the expanded view is the game. Each round gives players 12 seconds to match a hidden colour using HSL sliders. Results are scored server-side with CIEDE2000 and compared with the subreddit crowd.

## What is implemented

- **Two Reddit entry points:** a 360px inline feed card and an expanded daily game.
- **Daily deterministic puzzle:** SHA-256 seed + `mulberry32`, with four OKLCH-generated targets and a fifth cultural swatch. Friday uses curated theme palettes.
- **Perceptual scoring:** sRGB → D50 Lab → CIEDE2000, then the PRD accuracy conversion and 1,000-point round scoring.
- **Timed game loop:** 12-second countdown, initial HSL values of 180 / 50 / 50, responsive sliders, optional numeric CVD readouts, refresh recovery, and automatic timeout handling.
- **Reveal:** target / guess split, score, ΔE, crowd average, and cultural note. The reveal stays on screen until the player selects **Next swatch**; there is no automatic 2.5-second advance. The next 12-second round timer starts only after that selection. Refreshing during an inter-round reveal restores the same reveal rather than starting the next timer. The fifth-round reveal also remains visible after refresh until the player selects **See your results**.
- **Result card:** total score, percentile, streak, five-tile inspection, comment sharing, copy fallback, and earned flair equipper.
- **Reddit services:** Redis-backed sessions, crowd aggregates, participant counts, leaderboard ranking, moderator daily-post creation, install trigger, and UTC scheduler.
- **Journeys:** start, five progress milestones, interactions, end event, and receipt-status logging where the SDK exposes the corresponding client method.

## Stack

- Devvit Web, Vite, TypeScript, Hono
- `@devvit/web` server context, Reddit API and Redis
- `@devvit/analytics` Journeys
- Plain HTML, CSS and TypeScript in the client; no React dependency. Inter is loaded from Google Fonts with platform system-font fallbacks.

## Local setup

Prerequisites: Node.js 22.20 or newer, npm, a Reddit account connected to the [Reddit Developer Platform](https://developers.reddit.com/), and a test subreddit where you have moderator permissions.

```bash
npm install
npx devvit login
npm run type-check
npm test
npm run build
```

Create the first private build and install it for playtesting:

```bash
npx devvit upload
npx devvit playtest YOUR_TEST_SUBREDDIT
```

The test subreddit should be one you moderate and should have fewer than 200 subscribers. The Vite plugin is configured in `vite.config.ts`; Devvit uses its client and server build outputs in `dist/`.

For subsequent development, run:

```bash
npm run dev
```

The `devvit.json` `scripts` section configures the Vite build watcher used by the Devvit playtest workflow. You can also run `npm run watch` separately to watch the build output.

## Configure the daily puzzle secret

The server reads an app-global encrypted setting named `puzzleSalt`. Set it after the app has been installed at least once:

```bash
npx devvit settings set puzzleSalt
npx devvit settings list
```

Generate a long random value and keep it private. **Use the same global secret for every subreddit installation and do not rotate it after daily puzzles have been generated.** The salt is not exposed to the client. The install trigger can create the first post before this setting exists, but gameplay remains locked until `puzzleSalt` is set. No public fallback key is shipped, and the first puzzle is generated only after the secret is available.

## Daily post creation

The app attempts to create the current day's post on install and every day at `00:00 UTC`. A moderator can also use the subreddit menu item **Create today's Kolorly post**. Creation is idempotent per subreddit and UTC date. If you open the post before setting `puzzleSalt`, the game displays a setup message; set the secret and reload. If scheduled posting is unavailable in a test install, use the moderator menu item to create the post manually.

The Reddit API is configured with the current `user` scope; the old `moderator` scope is deprecated in Devvit 0.15 and is treated as `user`. The result-comment action explicitly runs as the current Reddit user, while moderator-only actions remain behind moderator menu permissions.

The default issue-number epoch is **2026-10-30 = #001** so the PRD's examples align: 2026-11-12 is #014 and 2026-11-13 is #015. Change `ISSUE_EPOCH_DATE` in `src/server/services/puzzleGen.ts` before launch if your intended first issue date differs.

## Product decisions and platform notes

1. **One puzzle, multiple subreddit installations.** The puzzle is generated from `UTC date + app-global secret`, so every installation produces the same target sequence when configured with the same secret. Redis is installation-scoped, so streaks, crowd averages, daily counts and percentiles are subreddit-local.
2. **Server owns scoring and time.** The client submits only its chosen hex value and round number. The server checks the active round and server timestamp, scores it, updates crowd state, and rejects stale or duplicate round submissions.
3. **Timeout score.** A timed-out round is recorded as zero points and excluded from the crowd mean. A refresh after the 12-second deadline is resolved server-side before the next round starts.
4. **Archive practice.** Older posts remain playable. Archive play does not alter a current streak, daily leaderboard, crowd aggregates, or daily completion statistics.
5. **Flair thresholds are an implementation assumption.** The PRD names `95% Club`, `7-Day Streak`, and `Eagle Eye` but does not define unlock rules. This build uses: 4,750+ total points; a 7-day streak; and 95%+ in every round with no timeout, respectively. Adjust these in `src/server/index.ts` before launch if you want different rules.
6. **Daily reminders are not activated.** The result card explains that push opt-in is unavailable for this app. Reddit's push-notification capability is gated, so this build does not display a non-functional switch.
7. **Journeys may need platform enablement.** The app has `permissions.journeys: true`, mounts Reddit's telemetry router, records receipts, and follows the five-step progression. Reddit may reject or drop Journey events until the app's telemetry map is approved/allowlisted. Receipt messages are logged for diagnosis.
8. **Cultural swatches need editorial review.** The initial 24-colour catalogue and three Friday themes are an authored starter set. Review colour names, regional context, hex values and trivia before making the game broadly available.
9. **The same salt and catalogue are important for historical posts.** Do not change the seed algorithm or the catalogue after launch without a migration plan; old posts may be played as archive practice.
10. **Redis retention should be revisited before broad scale.** Devvit currently documents a 5 GB storage limit per installation. The game intentionally retains sessions, user streak profiles, and crowd means so archive posts can still be practised against the original crowd; add and test a retention/compaction policy before very large deployments.

## Directory

```text
kolorly/
├── assets/
│   ├── cultural_colors.json
│   └── friday_palettes.json
├── src/
│   ├── client/
│   │   ├── splash.html
│   │   ├── splash.ts
│   │   ├── game.html
│   │   ├── game.ts
│   │   ├── api.ts
│   │   ├── telemetry.ts
│   │   └── styles/app.css
│   ├── server/
│   │   ├── index.ts
│   │   └── services/puzzleGen.ts
│   └── shared/
│       ├── colors.ts
│       └── types.ts
├── devvit.json
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Verification status for this generated source

The pure game-logic test suite passes with **6/6 tests**. Client and server application files pass targeted strict TypeScript checks using local declarations for the Devvit/Hono SDK modules, and TypeScript syntax, CSS parsing, and JSON configuration checks pass. A standalone-session flow test confirms that an inter-round reveal remains paused across reload, that **Next swatch** starts the following 12-second timer, and that the completed state is retained. Browser layout checks cover feed, active play, reveal and results at 320×568, 360×640, 375×667, 390×844, 640×720, 768×1024 and 1024×900, with no horizontal overflow. A complete project type check and Vite/Devvit production build were not run because dependency installation did not complete in this environment. The project has not yet been uploaded to Reddit or tested inside Reddit's iOS, Android or desktop clients.

## Vercel standalone test build

This project includes a separate Vercel build for reviewing the game in a normal browser before installing it on Reddit. It is a standalone test build, not the production backend:

- `vercel.json` uses `npm run build:vercel` and publishes `dist-vercel/`.
- `vite.config.vercel.ts` builds the two HTML entry points without the Devvit server plugin.
- The Vercel build uses a standalone session adapter backed by browser `localStorage` and sample daily targets.
- Reddit navigation and Journeys use standalone shims; comment sharing and flair are not available in this build. The interface does not display test-environment banners or reset controls.

The normal `npm run build`, `npm run deploy`, and `npm run dev` commands continue to target Devvit. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the browser-based Vercel and Reddit deployment steps.


## Interface, responsive layout and accessibility

The expanded game keeps the PRD's original vertical composition at every width: a 48px progress/timer HUD, round heading, split Target/Your Mix arena, three-slider Studio mixer, and full-width action button. It does not switch to a two-column desktop game layout. The arena remains approximately 44% of the available viewport height, and each slider retains a 48px hit area with a 28px thumb. At short phone heights the arena and surrounding spacing compact while the controls retain their 48px hit areas; the page can scroll vertically if the available height is insufficient. The inter-round result is player-controlled: no next-round countdown runs during the reveal, and choosing **Next swatch** starts the next 12-second timer. The pending reveal is restored if the player refreshes before continuing.

Inter is the single font family across both screens, with system fallbacks. Dark and light palettes use high-contrast text and control boundaries. The client includes a skip link, labelled sliders and buttons, keyboard-operable controls, a visible focus outline on range sliders, screen-reader announcements at meaningful timer thresholds, text alternatives for the crowd marker, reduced-motion handling, and high-contrast/forced-colour support. The tested text and control colour pairs meet the relevant WCAG AA contrast ratios. The layout has been browser-checked at 320×568, 360×640, 375×667, 390×844, 640×720, 768×1024 and 1024×900, with no horizontal overflow in the tested feed, gameplay, reveal or results views. In short landscape viewports, the same vertical game structure is retained and the page scrolls vertically rather than squeezing controls into an alternate layout.

These implementation checks do not constitute a formal WCAG conformance certification. Complete verification still requires manual testing with VoiceOver, TalkBack and desktop screen readers inside the actual Reddit webview, as well as a full accessibility audit of the deployed app.
