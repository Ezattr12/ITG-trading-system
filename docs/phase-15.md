# Phase 15 — Premium Institutional Redesign (Mobile-First)

Status: **implemented, verified locally, and deployed to production
2026-10-28 (deployment `dpl_DEqou2njnmnNKTARr8rfNzZJ9mCh`, READY).
Not committed to GitHub yet** — that is the parent's step.
Local verification: Vitest 328/328, typecheck pass, lint pass,
`next build` pass, Playwright 21/21 (6 smoke + 15 responsive),
`scripts/security-check.mjs` pass (205 files). Deploy + GitHub
commit are the parent's steps after this phase.

## Why this phase exists

Ezat inspected the live dashboard on a real phone and found the
mobile UI was not production quality: the desktop layout was
squeezed into a mobile viewport, with a huge unused empty space
on the right. This phase is a required production-quality fix,
not a cosmetic patch: the shared design system and app shell were
redesigned first, then every major page was reviewed.

## Problems found (inspection before any change)

1. **The header was the overflow.** `components/app-header.tsx`
   rendered all eighteen navigation links in a single horizontal
   flex row with no wrapping and no mobile pattern. On a phone
   that row is far wider than the viewport, so the page scrolled
   sideways and the right side looked empty. This is the direct
   cause of the reported bug.
2. **No explicit viewport.** `app/layout.tsx` set no viewport
   meta, so phones could render a scaled-down desktop page.
3. **Colours too dark, contrast too low.** Background was
   `222 47% 6%` (near black) and muted text `215 20% 65%` — a
   grey that is hard to read on a phone in daylight.
4. **Typography too small on mobile.** Page titles 24px, stat
   values 20px, hints and helper text 12px, buttons 36px tall,
   inputs 40px tall with 14px text (below the 16px iOS zoom
   threshold, so focusing an input zoomed the page).
5. **No mobile navigation pattern.** There was no drawer, no
   bottom navigation, and no way to reach most sections on a
   phone without horizontal scrolling.
6. **Tables forced horizontal scrolling on mobile.** The trades
   table has `min-w-[720px]` inside a scroll container; on a
   phone that is a 720px table in a 360px viewport.
7. **Dashboard order buried the important numbers.** The level
   card, discipline text and chart came before the equity curve
   in places, and there was no Recent Activity section.
8. **Quick Entry hid the strategy.** Strategy could only be set
   in Advanced Review, so the most useful piece of trade context
   was missing from the 30–60 second path, while leverage, fees
   and open/close times crowded it.
9. **Charts used fixed 70px Y axes and 12px grey ticks**, which
   clip and crowd on a 320px screen.

## Design-token system

All tokens live in `apps/web/app/globals.css` (`:root`) and are
consumed through Tailwind — no page hard-codes a colour.
`tailwind.config.ts` maps the semantic tokens to Tailwind colour
names (`success`, `warning`, `info`, `ai`, `profit`, `loss`).

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `222 33% 9%` | Deep navy/charcoal page background (not pure black) |
| `--card` | `222 28% 13%` | Slightly lighter cards and surfaces |
| `--foreground` | `210 30% 94%` | Off-white primary text |
| `--muted-foreground` | `215 18% 72%` | Muted grey secondary text (raised from 65% for contrast) |
| `--primary` | `217 91% 60%` | Blue/indigo brand and action accent |
| `--border` / `--input` | `222 20% 21%` / `24%` | Subtle borders and input outlines |
| `--success` | `152 69% 42%` | Green: profit / success |
| `--destructive` | `0 72% 51%` | Red: loss / risk |
| `--warning` | `38 92% 50%` | Amber: warnings |
| `--ai` | `262 83% 68%` | Purple: AI / intelligence only |
| `--info` | `217 91% 60%` | Blue: information |

No other accent colours are used. No gradients except the
restrained login backdrop grid (unchanged from Phase 2) — no
neon, no glow, no casino styling.

Shared component classes in `globals.css`: `.page-title`
(24px mobile, 30px from `sm`), `.page-lede` (16px muted),
`.section-title` (16–18px), `.section-label`, `.card-surface`
(rounded-xl border, card background), `.metric-value`
(24–32px tabular), `.input-select` (44px, 16px text),
`.action-link` (44px touch target), `.tnum`.

Typography scale as implemented: page titles 24–32px, section
titles 16–20px, primary metrics 24–32px, body 14–16px,
secondary 12–14px. Form controls are 16px at every width so
iOS does not zoom on focus.

## App shell structure

`components/app-shell.tsx` (server) + `components/app-shell-client.tsx`
(client) replace `components/app-header.tsx` (deleted). Every
signed-in page renders `<AppShell>`; auth pages and onboarding
keep their own shells (they render before a session exists).

- **Desktop (≥1024px):** collapsible left sidebar (256px, or
  80px icons-only when collapsed; preference in localStorage),
  slim sticky top header, content `max-w-6xl` (`max-w-3xl` for
  form pages via the `narrow` prop). Sidebar order is the spec
  order exactly: Dashboard, Trades, Analytics, Risk, Trading
  Plan, Psychology, Calendar, Progress, Goals, Levels,
  Achievements, Certificates, Reports, Weekly Review, AI Coach,
  Notifications, Profile, Admin (admin only when the profile
  role is `admin`).
- **Mobile:** compact top header (menu button, brand, Add trade
  button, notification bell with unread badge), bottom tab bar
  with Home / Trades / Analytics / Goals / More, and a
  slide-over drawer for the full navigation. The drawer closes
  on Escape, on backdrop tap, and on navigation; focus moves to
  its close button while open and body scroll locks.
- Active section is highlighted from the current pathname
  (including sub-routes such as `/trades/[id]` → Trades).
- A skip-to-content link, `aria-current="page"`, labelled
  navigation landmarks, and a `prefers-reduced-motion` rule
  (animations and transitions effectively disabled) are built
  into the shell and `globals.css`.
- The unread notification count is resolved server-side, never
  faked; the bell and the drawer badge show the same number.
- The admin section nav (`app/admin/layout.tsx`) now renders
  inside the shell, above the admin page content, instead of
  above the whole app.

## Dashboard hierarchy (as implemented)

`app/dashboard/page.tsx`, most important first on desktop and
mobile (same order on both):

1. Welcome / current trading status.
2. KPI row — Current P&L, Win Rate, Profit Factor, Average R,
   Current Streak (2 columns on mobile, 3 on `sm`, 5 on `xl`;
   the fifth card spans both mobile columns).
3. Main Performance / Equity Curve.
4. Risk & Discipline (stop-loss %, good-discipline %,
   journal completion, max drawdown, discipline reminder and
   motivation message) — side by side with Goal Progress on
   desktop.
5. Goal Progress (level, score, XP, goal progress bars).
6. Psychology (average confidence, best emotion by P&L,
   journal completion, top emotions by trade count).
7. Recent Trades.
8. AI Coach Insights.
9. Recent Activity — the five most recent real notifications
   from `getNotifications` (achievements, risk milestones,
   coach events), with an honest empty state when there are
   none. No activity is invented.

Max drawdown moved out of the KPI row into Risk & Discipline,
where it belongs. All figures are still computed from the
trader's real closed trades only; empty states are unchanged.

## Add Trade quick-entry decisions

`components/trades/quick-trade-form.tsx`,
`lib/trades/validation.ts`, `lib/trades/actions.ts`,
`app/trades/new/page.tsx`:

- Quick path is now exactly: Pair, Long/Short, Entry, Exit,
  TP, SL, Position size, Strategy. Strategy is an optional
  select fed by the real system strategies
  (`getSystemStrategies`); choosing one stores `strategy_id`
  on the trade at creation. Previously strategy could only be
  set in Advanced Review.
- `quickTradeSchema` gained optional `strategyId`
  (`z.string().uuid().nullable().optional()`); `parseQuickForm`
  reads it and `createTradeAction` inserts it. Corrections
  still keep the original trade's `strategy_id` (unchanged
  behaviour); the strategy select is only rendered when the
  `strategies` prop is passed, so the correction form is
  unaffected.
- Leverage, fees, opened and closed times are NOT deleted:
  they moved behind a native `<details>` disclosure labelled
  "More details (optional)". Opened defaults to now, so the
  form still submits without opening the disclosure, and the
  `closedAt` validation (required when an exit price is given)
  still applies.
- No schema change, no migration. Two new Vitest tests cover
  the strategy id (accepted as UUID or null, rejected as a
  plain string).

## Charts

`components/analytics/charts.tsx`: axis ticks are now 11px in
the muted token colour, Y axes for money charts are 56px wide
(was 70px), X axes use `interval="preserveStartEnd"` with a
minimum tick gap so labels thin out instead of overlapping,
money ticks compact to `1.2k` above 1000, tooltips use the
token surface colours, and chart heights shrink on mobile
(`h-56 sm:h-64` for the equity and period charts). Charts are
still paired with plain data tables in the server pages, so
the numbers are readable without the chart.

## Tables, forms and other pages

- **Trades:** below `md` the 720px table is replaced by one
  card per trade (pair, P&L, direction, date, R, status,
  entry/exit); the table stays for `md` and up. Pagination
  stacks vertically on mobile.
- **Filters:** all native selects now use the shared
  `.input-select` class (44px, 16px text) in
  `trade-filters.tsx`, `advanced-review-form.tsx`,
  `goal-form.tsx`, `goal-status-form.tsx`, `admin-forms.tsx`.
- **Buttons/inputs:** `Button` default is now 44px tall
  (small 40px, large 48px, icon 44px); `Input` is 44px with
  16px text. Analytics period buttons, Reports controls, the
  Print and Download PDF controls, and the login "Forgot
  password?" link are all 44px touch targets.
- **Calendar:** day cells are `min-h-14` on mobile
  (`min-h-16` from `sm`), the journaled percentage is hidden
  below `sm` so the P&L fits in a ~40px cell.
- **Onboarding:** card padding is `p-4 sm:p-6`, lede is 16px.
- **Bulk pass:** across `app/` and `components/`, 27 page
  titles became `.page-title`, 57 section titles became
  `.section-title`, 18 page ledes became `.page-lede`, 78 card
  surfaces became `.card-surface` (with `p-4 sm:p-6`), and 59
  `mt-8` section gaps became `mt-6 sm:mt-8`. Card radius is
  now `0.75rem` everywhere via `--radius`.

## Widths tested and results

Playwright `e2e/responsive.spec.ts` (new, 15 tests) runs
against the production build with no Supabase configured,
exactly like the Phase 12 smoke suite. It asserts no
horizontal overflow (`scrollWidth <= clientWidth`) on the
public pages and on every protected route's login redirect,
the device-width viewport meta, 44px login controls at 390px,
and single-column landing cards at 360px.

| Width | Public pages | Protected → login | Overflow |
| --- | --- | --- | --- |
| 320px | pass | pass (19 routes) | none |
| 360px | pass | pass (19 routes) | none |
| 390px | pass | pass (19 routes) | none |
| 430px | pass | pass (19 routes) | none |
| 768px | pass | pass (19 routes) | none |
| 1280px | pass | pass (19 routes) | none |

Screenshots were inspected by the builder at 320, 390, 768
and 1280px for `/` and `/login` (saved to `/tmp/p15-shots/`
during the run): single-column mobile layouts, full-width
cards, consistent 16px side padding, readable 16px body text,
blue primary button, amber honest "not connected" state on
login. Desktop landing and login render in centred columns
with the three-card row intact — the redesign did not break
desktop.

## What was NOT verified locally (honest limitation)

The signed-in shell (sidebar, drawer, bottom tab bar) and the
authenticated pages (dashboard, trades, analytics and the rest)
cannot be rendered by Playwright without a live Supabase
project — there is no session in the no-Supabase local build,
and this phase does not fake a login or touch live Supabase.
They are verified by: `next build` (all 30 routes compile),
typecheck, lint, the full Vitest suite, and a class-level audit
of every page (the shell and all pages use the same tokens,
components and responsive patterns as the verified public
pages). The signed-in visual pass is a live-verification item
for the parent after deploy, alongside the existing Phase 14
browser-pass gap. The dashboard hierarchy and the Add Trade
form were also verified by typecheck and by the new schema
tests, not by a signed-in screenshot.

## Verification (all local, 2026-10-27)

- Vitest: **328/328 pass** (326 before + 2 new strategy-id
  tests).
- Typecheck: pass. Lint: pass. `next build`: pass, 30 routes.
- Playwright: **21/21 pass** (6 smoke + 15 responsive).
- `scripts/security-check.mjs`: pass (205 files).
- No migrations, no schema changes, no new dependencies
  (lucide-react 0.454 was already a dependency), no fake data,
  no removed functionality.

## Files changed

- New: `components/app-shell.tsx`, `components/app-shell-client.tsx`,
  `e2e/responsive.spec.ts`, `docs/phase-15.md`.
- Deleted: `components/app-header.tsx`.
- Design system: `app/globals.css`, `app/layout.tsx`,
  `tailwind.config.ts`, `components/ui/button.tsx`,
  `components/ui/input.tsx`, `components/analytics/stat-card.tsx`,
  `components/analytics/charts.tsx`.
- Shell migration (AppHeader → AppShell): all 19 signed-in
  pages, `app/admin/layout.tsx` and the 8 admin pages.
- Dashboard: `app/dashboard/page.tsx`.
- Trades: `app/trades/page.tsx`, `app/trades/new/page.tsx`,
  `components/trades/quick-trade-form.tsx`,
  `components/trades/trade-filters.tsx`,
  `components/trades/advanced-review-form.tsx`,
  `lib/trades/validation.ts`, `lib/trades/actions.ts`,
  `lib/trades/validation.test.ts`.
- Touch targets and spacing: `app/analytics/page.tsx`,
  `app/calendar/page.tsx`, `app/reports/page.tsx`,
  `components/reports/print-button.tsx`,
  `app/onboarding/page.tsx`, `app/login/page.tsx`,
  `components/discipline/goal-form.tsx`,
  `components/discipline/goal-status-form.tsx`,
  `components/admin/admin-forms.tsx`, plus the bulk
  typography/card pass across `app/` and `components/`.

## Deployment (2026-10-28, deployer phase)

- Status: **deployed to production.** Live URL: https://itg-traderos.vercel.app
- Deployment: `dpl_DEqou2njnmnNKTARr8rfNzZJ9mCh`, target `production`, state **READY**
  (created 2026-10-28 04:12 UTC; deployment URL
  `itg-traderos-q3qf84d36-ezattr12s-projects.vercel.app` also 200).
- Previous production deployment `dpl_GPjGVb…` (Phase 13) is superseded.
- Live checks (curl, 2026-10-28 04:13 UTC): `/` → 200 (real landing
  page, "ITG TraderOS"); `/login` → 200 (real login form, "Log in to
  your trading journal"); `/dashboard` signed out → 307 to
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
  (250 KB, 4 chunks of ~70 KB) and validated locally (`npm install` +
  `npm run build` — "Compiled successfully", 30 routes). No recipe
  differences: Phase 15 added no new dependencies and no migrations.
- One deploy attempt failed first and is recorded honestly:
  `dpl_EtQjBeKh8UZ7kA7sMLJ9ecQfd9TU` → ERROR, "The specified Root
  Directory \"apps/web\" does not exist." Cause: the first
  `create_deployment` listed files relative to `apps/web`
  (`app/page.tsx`), so the uploaded tree had no `apps/web` directory
  for the project's root-directory setting to resolve. Fix (no file
  re-upload needed — content is addressed by SHA1): the same 151
  files were referenced with the `apps/web/` prefix
  (`apps/web/app/page.tsx`), and the retry deployed cleanly. Future
  deploys must keep the `apps/web/` prefix in `create_deployment`
  file paths.
- Env vars unchanged (Supabase URL, anon key, service-role key, app
  URL from Phase 13). No Supabase data or migrations touched.
- Open gap (unchanged): the signed-in live visual pass of the
  redesign cannot run from the VM (known limitation, Phase 14 gap);
  it needs a real browser session or Ezat's own inspection on a
  phone. The live checks above prove the new build serves, not that
  every signed-in screen renders correctly on mobile.
