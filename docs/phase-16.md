# Phase 16 — Professional Motion / Animation Layer

Status: **implemented and verified locally** (2026-10-28). **Deployed to production** (2026-10-28, see Deployment section below). Not committed — GitHub commit is the parent's step.

## What this phase is

A motion system on top of the Phase 15 institutional redesign.
The direction is premium fintech, not gaming: smooth, subtle,
fast, purposeful, polished. Every animation is opacity or
transform only — nothing in the system can move layout.

## Motion tokens

`apps/web/app/globals.css` (`:root`) and `apps/web/tailwind.config.ts`:

| Token | Value | Used for |
| --- | --- | --- |
| `--motion-duration-instant` | 80ms | press feedback |
| `--motion-duration-fast` | 150ms | hover, focus, colour |
| `--motion-duration-base` | 250ms | entrances/exits, drawer, page transition |
| `--motion-duration-slow` | 400ms | staggered section entrance, check draw |
| `--motion-duration-count` | 700ms | KPI count-up |
| `--motion-ease-standard` | cubic-bezier(0.2, 0, 0, 1) | default (ease-out) |
| `--motion-ease-emphasized` | cubic-bezier(0.2, 0, 0.2, 1) | scale-ins |

Keyframes (all in `globals.css`): `motion-fade-up` (entrance),
`motion-fade-in` (state changes), `motion-scale-in` (badges,
checks), `motion-ai-pulse` (soft 2.4s AI status pulse),
`motion-shimmer` (skeleton), `motion-login-drift` (28s slow glow
drift, login only), `motion-grid-pan` (60s grid pan, login only),
`motion-check-draw` (SVG stroke draw for the success checkmark).

Utility classes in `@layer components`: `.motion-reveal` plus
`.motion-reveal-1`–`.motion-reveal-6` (60ms stagger steps),
`.motion-fade-in`, `.motion-scale-in`, `.motion-page`,
`.motion-ai-dot`, `.motion-check-draw`, `.motion-login-glow`,
`.motion-login-grid`, `.skeleton`.

No new JavaScript animation library was added. CSS
transitions/animations and Recharts' built-in animation cover
everything; the only JS-driven motion is the KPI count-up
(`requestAnimationFrame`) and the drawer mount timing. Bundle
impact is effectively zero — the first-load JS is unchanged
at 103 kB shared.

## What was added, per area

- **Dashboard** (`app/dashboard/page.tsx`): sections enter with a
  60ms stagger (welcome → KPIs → performance → risk/goals →
  psychology → trades → coach → activity), settling in under
  half a second. The four numeric KPIs (P&L, win rate, profit
  factor, average R) count up over 700ms; nulls still render
  "—", never 0. Psychology metrics count up the same way.
- **KPI count-up** (`lib/motion/count-up.ts`,
  `components/analytics/count-up.tsx`): pure `easeOutCubic` /
  `countUpValue` helpers (unit-tested) plus `AnimatedNumber`,
  `CountUpMoney`, `CountUpPct`, `CountUpDecimal`. The colour of
  a money value is taken from its final value, not the
  intermediate one. Intermediate values are `aria-live="off"`.
- **Charts** (`components/analytics/charts.tsx`): every Recharts
  element draws in over 600ms with `ease-out`; data transitions
  animate the same way. With reduced motion, `isAnimationActive`
  is false and the chart renders its final state immediately.
- **Cards**: `.card-surface` now transitions border colour and
  shadow on hover (150ms). No translate, no float, no bounce.
- **Navigation** (`components/app-shell-client.tsx`): desktop
  sidebar width animates 250ms on collapse; nav links have a
  small active bar that scales in; the bottom tab bar has a dot
  that scales in under the active tab; the drawer slides in/out
  over 250ms with an overlay fade (it stays mounted 250ms after
  closing so the exit can play); page content fades up 6px over
  250ms on each navigation; unread badges scale in.
- **Buttons** (`components/ui/button.tsx`): 150ms colour
  transition plus a 2% press scale. No bounce.
- **Add Trade** (`components/trades/trade-saved-banner.tsx`,
  `lib/trades/actions.ts`, `app/trades/[id]/page.tsx`): after a
  save or correction the trade page shows a dismissible
  "Trade saved" banner with a checkmark that draws itself in
  over 400ms. The save actions redirect with `?saved=1` — a
  display flag only; the trade is already saved and the
  dashboard is revalidated. The banner never blocks the user.
- **Login** (`components/auth/auth-card.tsx`): the strongest
  motion in the app, still restrained — a soft brand-blue glow
  drifting over 28s, the grid panning over 60s, and the card
  fading up on entrance. CSS-only, no images, no WebGL, no
  particles, no neon, no moving charts. The same shell serves
  the register page.
- **AI Coach** (`app/coach/page.tsx`,
  `components/coach/refresh-coach-form.tsx`): a soft purple
  pulse dot marks the AI section and the "Analysing…" state;
  insight cards reveal with a 60ms stagger. The pulse is
  decorative only — the text always says what is happening.
- **XP / Levels / Achievements**: `ProgressBar`
  (`components/analytics/stat-card.tsx`) now fills from 0 over
  500ms (aria-valuenow is the final value from first paint);
  total XP on the Levels page counts up; achievement cards
  reveal with a stagger and the unlocked check scales in.
  Gamification still rewards discipline, journaling, goals,
  reviews and risk management — nothing here celebrates taking
  more trades.
- **Notifications** (`app/notifications/page.tsx`): rows reveal
  with a stagger and fade opacity over 250ms when their read
  state changes. Dismissal itself is a server round-trip that
  re-renders the list, so there is no fake optimistic exit
  animation — the row state is always the real state.
- **Loading states**: `components/ui/skeleton.tsx` (shimmer
  skeleton, no fake text) plus `loading.tsx` for dashboard,
  trades, analytics, coach, levels and notifications, shaped
  like the page that is coming so the layout does not jump.
- **Success / error states** (`components/auth/action-form.tsx`):
  error and success alerts fade in; the success alert carries
  a check that scales in; the submit button shows a spinner
  while pending with `aria-busy`. The message text is always
  present — animation never carries the information alone.
- **Landing page** (`app/page.tsx`): header, actions and cards
  reveal with a stagger.

## Accessibility

- `prefers-reduced-motion` is respected in two layers: the
  global CSS rule in `globals.css` removes every animation and
  transition (and explicitly un-hides `.motion-reveal` etc.,
  which start at opacity 0), and the JS-driven motion
  (count-up via `usePrefersReducedMotion`, charts via
  `isAnimationActive`) renders final states immediately.
- No important information is communicated by animation alone:
  every animated state has text beside it, and every animated
  number has its final value in the DOM.
- Keyboard focus visibility is unchanged (`:focus-visible`
  outline from Phase 15). Contrast is unchanged — motion
  touches opacity/transform, never colour.
- Animations are transform/opacity only, so they cannot cause
  layout shifts. The Playwright suite asserts button geometry
  is stable across hover.

## Performance

- CSS-only everywhere except the count-up (one rAF loop per
  animated number, 700ms, stops at the final value) and the
  drawer mount timer. No continuous animation except the login
  backdrop (two slow CSS animations, composited transforms
  only) and the AI pulse dot (opacity/scale, 2.4s).
- Browsers pause CSS animations in hidden tabs, so the login
  backdrop costs nothing when unseen. No animation runs on a
  timer in the background.
- First-load JS unchanged (103 kB shared). No new dependency.

## Verification (local, 2026-10-28)

- Vitest: **336/336 pass** (328 before + 8 new count-up tests).
- Typecheck: pass. Lint: pass. `next build`: pass, 30 routes.
- Playwright: **36/36 pass** — 6 smoke + 15 responsive (Phase 15)
  + 15 motion (new in this phase). Two motion tests failed
  during development and were fixed by correcting the tests,
  not by weakening them: the hover-stability test first hovered
  a disabled button (not hoverable) and then measured
  mid-entrance-animation; it now uses the landing page's enabled
  button and waits for the entrance to settle.
- `scripts/security-check.mjs`: pass (217 files scanned).
- Reduced motion verified in Playwright by emulating
  `prefers-reduced-motion: reduce`: entrance animations report
  `animation-name: none` and full opacity immediately; with
  `no-preference` the login glow/grid/card animations report
  their keyframe names.
- Widths checked: 320, 360, 390, 430, 768, 1280 — no
  horizontal overflow with motion on or reduced.

## Deliberately unchanged

- No business logic, database, auth, calculation or trading
  behaviour changed. No migrations, no schema changes, no new
  dependencies.
- The `?saved=1` flag is the only behavioural surface change,
  and it is display-only (see Add Trade above).
- Notification dismissal has no exit animation by design (see
  Notifications above).

## Limitations (not claimed otherwise)

- The signed-in motion (dashboard stagger, count-up, drawer,
  bottom-nav indicator, trade-saved banner) cannot be rendered
  by Playwright locally without a live Supabase project — there
  is no session in the no-Supabase build, and no login was
  faked. It is verified by build, typecheck, lint, the Vitest
  count-up tests, the shared tokens/components proven on the
  public pages, and the Playwright reduced-motion suite. The
  signed-in visual pass must happen live after deploy — the
  same open Phase 14 gap.

## Deployment (2026-10-28, deployer phase)

- Status: **deployed to production.** Live URL: https://itg-traderos.vercel.app
- Deployment: `dpl_AePFWSCjewsRq4AXb7TqvTqCXdvJ`, target `production`, state **READY**
  (created 2026-10-28 04:21 UTC; deployment URL
  `itg-traderos-dh5y2ji6k-ezattr12s-projects.vercel.app` also 200).
- Previous production deployment `dpl_DEqou2njnmnNKTARr8rfNzZJ9mCh` (Phase 15) is superseded;
  confirmed via `list_deployments` that the new deployment is the latest production one.
- Live checks (curl, 2026-10-28 04:29 UTC): `/` → 200 (real landing
  page); `/login` → 200 (real login form); `/dashboard` signed out → 307 to
  `/login?next=%2Fdashboard`; all six Phase 11 security headers present
  (CSP, HSTS, X-Content-Type-Options nosniff, X-Frame-Options DENY,
  Referrer-Policy, Permissions-Policy).
- Staging tree rebuilt from the current repo at
  `~/workspace/.itg-deploy-staging/` following the Phase 13 recipe
  exactly: `apps/web` rsynced (no node_modules, `.next`, `*.test.ts`,
  `.env`), `packages/calc/src/index.ts` vendored to
  `apps/web/lib/calc/index.ts`, tsconfig `@itg/calc` remapped,
  `@itg/calc` removed from `package.json` with all direct deps pinned
  to the exact versions in the repo root `package-lock.json`,
  `transpilePackages` removed from `next.config.ts`,
  `package-lock.json` regenerated by `npm install --package-lock-only`
  (250,301 bytes, 4 chunks, roundtrip hash verified) and validated locally
  (`npm install` + `npm run build` — "Compiled successfully", 30 routes).
  No recipe differences: Phase 16 added no new dependencies and no migrations.
  One cosmetic difference from Phase 13: `split -b 70k -d` now produces
  `package-lock.json.00`–`.03` instead of `.aa`–`.ad`; the install command
  `cat package-lock.json.?? > package-lock.json` matches both, so the
  reassembly is unchanged. 162 files uploaded (151 in Phase 15; the
  increase is the new motion files); the `apps/web/` prefix on
  `create_deployment` file paths was kept per the Phase 15 lesson and
  the deployment was created cleanly on the first attempt.
- Env vars unchanged (Supabase URL, anon key, service-role key, app
  URL from Phase 13). No Supabase data or migrations touched.
- Open gap (unchanged): the signed-in live visual pass of the motion
  layer cannot run from the VM (known limitation, Phase 14 gap);
  it needs a real browser session or Ezat's own inspection on a
  phone. The live checks above prove the new build serves, not that
  every signed-in animation renders correctly on mobile.
