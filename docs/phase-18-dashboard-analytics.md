# Phase 18 — Dashboard + Analytics + Charts (Worker 3)

Status: **implemented and verified locally. Not deployed, not committed** —
deploy + GitHub commit are the parent's steps, as briefed.

## Scope

Visual-only premium treatment of the dashboard, analytics, calendar
and progress pages and the shared chart/stat components. No
business logic, calculation, routing, security or schema changes.
No migrations, no new dependencies, no fake data — every number,
colour state and glow is driven by the trader's real rows.

## References — what was taken

All five images were read first:

- SHRUHH glass login: **taken** — depth from a bright top edge
  and layered translucent surfaces (already the Phase 17
  language; reinforced, not re-applied here).
- Delivery app: **taken** — one strong hero card, dark secondary
  cards, status chips, separated list rows, a raised centre
  action (shell, not this worker).
- Beyond finance: **taken** — the 3D ribbon as a cue for a
  gradient wash on the hero card, and the transaction-detail
  hierarchy (big number → supporting facts → history).
- Aura AI: **taken** — activity cards with a small readable
  chart inside, generous card padding, day pills as a cue for
  the calendar's today ring and status pills.
- Fintech mobile: **taken** — the balance hero card with a
  sparkline, overview icons, recent activity list, floating
  bottom nav (shell, not this worker). The dashboard P&L hero
  is modelled on this composition: big number, context line,
  supporting stats, sparkline — without copying its branding,
  wording, figures or layout.

**Not taken** from any reference: branding, logos, names,
numbers, exact layouts, the purple-everything palettes, neon
or glow-heavy surfaces, crypto/casino styling.

## Shared components

### `components/analytics/stat-card.tsx`

- `StatCard` gains an optional `glow` prop (`"blue" | "cyan" |
  "violet" | "emerald" | "danger" | "amber"`) that appends the
  matching shared `.card-glow-*` modifier to the card surface.
  The exported `STAT_CARD_GLOW_CLASS` map is the single place
  that maps glow names to classes, so pages never build class
  names from strings. No glow (or `undefined`) keeps the card
  neutral — null/empty values never get a tinted glow.
- `ProgressBar` fill is now a subtle emerald gradient
  (`from-emerald-500 to-emerald-400`) instead of a flat fill.
  Same 500ms fill animation, same ARIA values.

### `components/analytics/charts.tsx`

Premium chart treatment, Recharts unchanged, real data
unchanged, paired data tables untouched:

- **Gradient area fills** via SVG `linearGradient` defs that
  fade from the line colour to transparent: emerald for the
  equity curve, red for drawdown, violet for XP. (XP was an
  amber `LineChart`; it is now a violet `AreaChart` so the XP
  gradient fill exists — the line, values and tooltip text are
  the same.)
- **Line weight 2.5** on all area/line charts.
- **Softer grid**: `strokeOpacity 0.5` on the existing
  `3 3` dashed grid.
- **Refined tooltips**: token surface colours kept
  (`#171b25` / `#2b3242` / `#e8ecf3`, matching `--card` /
  `--border` / `--foreground`), plus a soft shadow, 13px text,
  padding, a semibold label, and a hover cursor (thin token
  line on area charts, faint wash on bar charts).
- **Hover states**: `activeDot` (r=4) on area charts; bars
  get rounded tops (`radius [6,6,0,0]`, `maxBarSize 56`) and
  the cursor wash. R-distribution bars use a blue vertical
  gradient (`#60a5fa` → `#3b82f6`).
- **New `EquitySparkline`**: a subtle, axis-free area chart
  for the dashboard hero. Its line colour follows the real
  final equity — green when positive, red when negative, blue
  at break-even. No tooltip; the hero number and the full
  equity chart already carry the values.
- **Motion unchanged**: 600ms draw-in, `isAnimationActive`
  off under `prefers-reduced-motion`, final state rendered
  immediately. Positive/negative stays semantic (green up,
  red down).

## Dashboard (`app/dashboard/page.tsx`)

Spec hierarchy kept: welcome → P&L hero → KPIs → equity curve
→ risk/discipline + goals → psychology → recent trades → AI
Coach → recent activity.

- **P&L hero (new)**: a full-width `.hero-card` (with
  `.card-surface-raised` as the structural fallback) replacing
  the old raised P&L stat card. Eyebrow "Current P&L", large
  `.metric-hero` tabular number (still the `CountUpMoney`
  700ms count-up; "—" with no trades), a context line, and a
  supporting-stats row (closed trades / wins / max drawdown,
  all real). The equity sparkline sits to the right on
  desktop and below the number on mobile, so the hero reads
  as a mobile-first balance card, not a compressed desktop.
  The hero glow follows the real P&L: emerald when positive,
  red when negative, blue when there are no trades or exactly
  break-even.
- **KPI row** is now the four supporting cards (win rate,
  profit factor, average R, streak) in `grid-cols-2 /
  sm:grid-cols-4`. Glows are value-driven: win rate carries
  the blue performance glow; profit factor is emerald above 1
  and red below 1; average R is emerald above 0 and red below
  0; the streak follows its real direction. Null values get
  no glow.
- **Performance section**: raised card plus the blue
  performance glow.
- **AI Coach section**: the one violet accent on the page
  (`.card-glow-violet`), marking the AI surface.
- Risk, goals, psychology, recent trades and recent activity
  are unchanged apart from section re-numbering in comments
  (the hero is now section 2 of 10).

## Analytics (`app/analytics/page.tsx`)

- **Performance hero**: the equity-curve section is now a
  `.hero-card` (raised fallback) with the blue performance
  glow, an "Performance" eyebrow above the "Equity curve"
  title, the chart in its inset panel, and the paired data
  table below.
- **KPI cards**: Total P&L glow follows its real sign;
  profit factor emerald above 1 / red below 1; max drawdown
  carries the red risk glow when trades exist. The other
  three cards stay neutral — glow is rationed, one hero plus
  a few tinted accents per view.
- **Drawdown section**: red risk glow when real drawdown
  data exists, plain otherwise.
- **Breakdown tables** (strategy / session / direction):
  premium rows — uppercase tracking-wide headers, taller
  `py-2.5` rows, `border-border` dividers, `hover:bg-accent/40`,
  tabular figures — and a "Best P&L" pill on the group with
  the highest real P&L (only when more than one group exists;
  the best group can still be a losing one, and the pill says
  so by naming the metric, not by praising the trader).
- **Period tabs**: pill-shaped (`rounded-full`, more padding)
  with a primary-tinted active state instead of `bg-secondary`.
- **All paired tables** (equity, P&L by period, R buckets,
  psychology) get the same row treatment: uppercase headers,
  taller rows, hover wash, tabular numbers. Filters and
  calculations are untouched.

Note: the "Best P&L" pill and the goal status pills below are
plain styled spans, not the shared Badge component — the
tokens/UI worker owns `components/ui/badge.tsx`, which did
not exist in this checkout at the time of writing, and
importing a file another worker creates would break the build
if it does not land. If the coordinator wants the shared
Badge, the two pill sites are the obvious swap points.

## Calendar (`app/calendar/page.tsx`)

- **Month navigation**: pill buttons (`rounded-full`, 44px
  minimum, hover border tint) instead of small square
  buttons; the nav row wraps on narrow screens.
- **Month summary cards**: P&L glow follows the real month
  P&L (emerald / red / none); journal completion carries the
  cyan glow when the month has trades.
- **Grid**: cells are `rounded-lg` with a hover elevation
  shadow; **today gets a `ring-2 ring-primary/60`** so the
  calendar always shows where "now" is; winning/losing day
  colours are unchanged (green/red by real P&L, blank days
  stay blank).
- **Legend**: colour dots replace the "Green = / red ="
  sentence, keeping the "blank days are not zero-P&L days"
  note.

## Progress (`app/progress/page.tsx`)

- **Level / XP / journal cards**: level carries the amber glow
  when a level exists; total XP the violet glow when XP > 0;
  journal completion the cyan glow.
- **XP history is the page hero**: raised surface with the
  violet XP glow, above the violet gradient XP chart.
- **Goals**: each goal now shows a status pill whose tint
  follows the real status — completed emerald, active blue,
  paused amber, failed red, unknown statuses a neutral pill
  showing the raw status string. Status labels reuse the
  goals page's wording (Active / Completed / Paused / Failed).
- **Tables** (weekly journal consistency, monthly discipline
  & psychology): same premium row treatment as analytics.
  The weekly P&L column now uses the shared `Money`
  component (signed, coloured, `$`-formatted) instead of a
  bare `toFixed(2)` number.

## Token dependency (coordinator: read this)

This worker uses the Phase 18 token classes exactly as
contracted — `.hero-card`, `.metric-hero`, `.eyebrow`,
`.card-glow-blue/cyan/violet/emerald/danger/amber` — but those
classes **did not exist in `globals.css` at the time of
writing** (only `.page-title`, `.section-title`,
`.section-label`, `.chart-panel`, `.metric-value` exist so
far). They are the tokens worker's deliverable. Until they
land, the hero/glow classes are harmless no-ops, and each
hero use carries a structural fallback so the page still
reads correctly:

- hero sections use `hero-card card-surface-raised` (the
  raised surface shows if `.hero-card` is missing);
- `.metric-hero` is paired with `text-4xl font-bold
  tabular-nums sm:text-5xl` so the number stays large;
- `.eyebrow` is paired with `text-xs font-semibold uppercase
  tracking-widest` so the label stays a small-caps eyebrow;
- glow classes are pure modifiers on `.card-surface` /
  `.card-surface-raised`, so a missing glow just means a
  neutral card.

No colours are hard-coded per page beyond the chart SVG hexes
(which Recharts requires as values, and which match the
existing token palette: emerald-400 `#34d399`, red-400
`#f87171`, blue-400 `#60a5fa`, violet-400 `#a78bfa`).

## Verification (local, 2026-10-28)

- Vitest: **336/336 pass** (36 files), unchanged from the
  Phase 17 baseline — no testable logic changed.
- ESLint on the owned paths (`app/dashboard`,
  `app/analytics`, `app/calendar`, `app/progress`,
  `components/analytics`): **pass, exit 0**.
- TypeScript: **pass, exit 0** (full `tsc --noEmit`). Note for
  the record: an intermediate run failed on
  `components/trades/advanced-review-form.tsx(59,8)` — a file
  outside this worker's list that another Phase 18 worker was
  editing concurrently at the time; it was not touched, and
  the error is gone in the final run. One genuine bug of this
  worker's own was caught and fixed during verification:
  `progress/page.tsx` passed `"gold"` as a glow, which is not
  in the contracted glow set — the level card now uses the
  contracted amber glow instead.
- No `npm run build`, Playwright, or dev server was run, per
  the brief — the coordinator runs those once at the end.

## Real limitation (not claimed otherwise)

The signed-in pages (dashboard, analytics, calendar,
progress) **cannot be rendered locally without a live
Supabase project** — there is no session in the no-Supabase
build, and no login was faked. The changes are verified by
Vitest, typecheck (except the unrelated file above), lint,
and the shared classes proven on the public pages. The
signed-in visual pass — hero card and sparkline on a real
phone, glow states with real positive/negative data, the
today ring, the "Best P&L" pill — must happen live after
deploy, the same open Phase 14 gap.

## Files changed

- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/analytics/page.tsx`
- `apps/web/app/calendar/page.tsx`
- `apps/web/app/progress/page.tsx`
- `apps/web/components/analytics/charts.tsx`
- `apps/web/components/analytics/stat-card.tsx`
- `docs/phase-18-dashboard-analytics.md` (this file)
