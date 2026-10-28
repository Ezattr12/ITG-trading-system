# Phase 18 — Major Visual Redesign: Premium 3D-Inspired Institutional Trading Platform

Status: **implemented and verified locally. Not deployed, not committed** —
deploy + GitHub commit are the parent's steps.

## What this phase is

Phase 18 transforms ITG TraderOS from a flat dark trading dashboard into a
premium 3D-inspired institutional trading platform, in two stages:

1. **The redesign** (five parallel workers): a full token system, one font
   family, ambient backgrounds, layered cards with per-type glow, hero
   cards per screen, premium charts, a redesigned shell/navigation/header,
   a premium login, restyled buttons/inputs/badges, and premium trade
   lists — applied page by page across the whole app.
2. **The aurora iteration** (one focused worker): Ezat's glassmorphism /
   frosted-glass / aurora direction, which refines the redesign — the
   navy foundation becomes a dark purple-black aurora environment, and
   surfaces become true frosted glass. This retokened the stage-1 work;
   it did not rebuild it. Where stage-1 notes say "navy stays the base"
   or "blue primary", the aurora values in this document supersede them.

Visual redesign ONLY. No business logic, database, auth, calculation,
routing, permission or security changes. No migrations, no new
dependencies, no fake data, no fake AI, no fake trading. The AI
Agent/MCP phase was explicitly NOT started.

## References — what was taken, and what was not

Five images supplied by Ezat, all read first, all distinct MD5s in this
batch (no duplicates, unlike Phase 17):

- SHRUHH glass login (`1000042125_6_1mua.jpg`): **taken** — glass-card
  depth from a bright top edge, translucent layered surface, soft
  shadow over a flowing backdrop. **Not taken** — name, logo, purple
  palette as-is, gradient button, wording, layout.
- Delivery app (`1000042121_7_bv9v.jpg`): **taken** — one strong hero
  card, dark secondary cards, status chips, separated list rows,
  raised centre `+` bottom action. **Not taken** — delivery domain,
  wording, figures.
- Beyond finance (`1000042123_8_e2eu.jpg`): **taken** — the 3D ribbon
  as a cue for layered depth, cards screen, transaction-detail
  hierarchy (big outcome → supporting facts → history). **Not
  taken** — branding, copy, card layouts, numbers.
- Aura AI (`1000042122_9_7pov.jpg`): **taken** — activity cards with
  a small readable chart inside, generous card padding, day pills,
  history list with separated rows. **Not taken** — the
  purple-gradient app, fitness content, voice.
- Fintech mobile (`1000042120_10_8jkn.jpg`): **taken** — balance hero
  card with a sparkline, overview icon row, recent activity rows,
  floating bottom nav with a raised centre action. **Not taken** —
  branding, name, balance figure, exact layout.

Deliberately **not** taken from any reference: no copied branding,
logo, text, names, numbers or exact layouts; no neon or glow-heavy
surfaces; no casino/crypto styling; no fake badges or fake data. The
references are purple-heavy; the app is not a purple takeover —
purple-black is the BACKGROUND, violet is the primary accent,
blue-cyan the secondary, magenta a whisper, gold premium-only.

## The final visual system

### Target stack

```
DARK AURORA BACKGROUND → BLURRED COLORFUL LIGHT → FROSTED GLASS
SURFACES → 3D DEPTH/SHADOW → PREMIUM FINTECH CONTENT
```

Judged against the question: *"Does this look like transparent premium
glass floating over an aurora-lit environment?"* On the public pages
(landing, login) the answer is yes — verified by screenshot (see
Verification): a purple-black aurora background with violet/blue
light, translucent glass cards with bright top edges, violet gradient
accents. It no longer looks like flat black + opaque dark cards +
ordinary dashboard. The signed-in answer still needs the live visual
pass (see Limitations).

### Colour system (final, aurora values — supersedes stage 1)

All tokens live in `apps/web/app/globals.css` (`:root`) as HSL triples
and are consumed through Tailwind; no page hard-codes a colour.

| Supplied hex | HSL | Token / role |
| --- | --- | --- |
| `#100020` | `270 100% 6%` | `--background` — dark purple-black page base |
| `#340266` | `270 96% 20%` | `--background-2` — midnight purple, hero bases |
| `#492282` | `264 59% 32%` | Deep violet — hero-card aurora wash |
| `#8B60C7` | `265 48% 58%` | Violet accent — gradient-AI start, glow anchor (never small text: 4.41:1, just under AA) |
| `#430574` | `274 92% 24%` | Aurora deep purple — ambient orb + body tint |
| `#501E7D` | `272 61% 30%` | Aurora violet — ambient orb + body tint |
| `#6C448D` | `273 35% 41%` | Aurora soft violet (available) |
| `#81268E` | `293 58% 35%` | `--magenta` — atmospheric ONLY (ambient wisp, login wisp, one streak). Never a surface or button |
| `#2971A4` | `205 60% 40%` | Aurora blue — ambient orb, body tint, hero wash, cyan glow |
| `#101010` | `0 0% 6%` | Near-black (available; the base is purple-black instead) |
| `#346CE6` | `221 78% 55%` | `--info` — blue-cyan secondary accent |
| `#0F4CCC` | `221 86% 43%` | Deep blue (available) |
| `#BD935F` | `33 42% 56%` | `--gold` — premium only: levels, achievements, certificates, gold buttons (black text 7.32:1) |

Hierarchy: **dark purple-black background / violet primary accent /
blue-cyan secondary / magenta small atmospheric accent only / gold
premium-only / emerald profit / red-coral loss-risk / amber warning /
off-white text.**

Derived values: `--background-3: 272 30% 13%` (purple-tinted charcoal);
`--card / --popover: 272 40% 14%` (dark purple base for the few solid
controls); `--secondary / --accent: 272 30% 17%`; `--muted: 272 28% 16%`;
`--cyan: 205 60% 55%` (`#2971A4` lightened — the exact hex is 3.78:1
as text, the lightened form 6.41:1); `--indigo: 232 80% 60%`;
`--foreground: 272 25% 94%` (17.27:1 on background);
`--muted-foreground: 270 15% 70%` (8.81:1). Borders/inputs are
translucent white inside the token (`--border: 0 0% 100% / 0.16`,
`--input: 0 0% 100% / 0.22`), so `hsl(var(--border))` still resolves
everywhere.

**The split-violet contrast decision.** No single violet can be both
white-text-readable (solid buttons) and dark-background-readable
(small text): WCAG needs luminance ≤ 0.183 for the first and ≥ 0.195
for the second — impossible. So there are two violets on purpose,
both contrast-computed with a WCAG script (full table in
`docs/phase-18-aurora.md`):

- `--primary: 262 83% 58%` — darker action violet. White text on it
  is 5.67:1, so solid `bg-primary` buttons stay readable. Never used
  for small text on dark (3.55:1).
- `--violet / --ai: 262 83% 68%` — light violet, 5.49:1 as text on
  the background. All small violet text uses this: active nav labels
  and `.action-link` switched from `text-primary` to `text-violet`.

### Gradients and glows

- `--gradient-primary`: violet → indigo (primary buttons, accents).
- `--gradient-cyan`: `#346CE6` → `#2971A4`. `--gradient-ai`: starts
  at `#8B60C7`. `--gradient-gold`: `#BD935F` family. `--gradient-hero`:
  aurora sweep (violet 0.22 → midnight purple 0.30 → aurora blue 0.18).
- Glows are two-layer, soft, low-opacity (`--glow-primary`,
  `--glow-violet`, `--glow-blue`, `--glow-cyan`, `--glow-success`,
  `--glow-danger`, `--glow-warning`; Tailwind `shadow-glow-*`). One
  glowing focal surface per view at most.
- Elevation unchanged from Phase 17 (`--elevation-1/2/3`,
  `--elevation-highlight`, `shadow-elevation-1/2/3`).

### The glass system — three levels

One language: **transparent white surface + very subtle violet
highlight + soft top reflection (`inset 0 1px 0 white/8–16%`) + deep
shadow underneath.** Frosted glass, not chrome: no mirror reflections,
no hard bright borders — borders are translucent white (0.14–0.25),
which reads as reflection/highlight, not a line. No owned surface is
opaque; the aurora stays faintly visible through every card.

| Level | Class | Surface | Blur | Border | Radius | Shadow |
| --- | --- | --- | --- | --- | --- | --- |
| Standard glass | `.glass-surface` | white 0.08 → 0.05 | 20px | white 0.15 | 20px | elevation-2 |
| Elevated glass | `.glass-surface-elevated` | white 0.10 → 0.06 | 20px | white 0.20 | 24px | elevation-3 + faint violet glow |
| Hero glass | `.card-surface-glass` | white 0.12 → 0.07 | 24px | white 0.25 | 24px | elevation-3, clearest highlight |
| Content card | `.card-surface` | white 0.08 → 0.05 | none | white 0.14 | 20px | elevation-1 |
| Raised card | `.card-surface-raised` | white 0.10 → 0.06 | none | white 0.18 | 20px | elevation-2 |

`.hero-card` is the strongest depth: aurora wash layered over hero
glass, 20px blur, 0.25 border, 24px radius, elevation-3 + violet glow.
One focal card per screen. Inset surfaces (`.card-surface-inset`,
`.chart-panel`) are the inverse — a translucent purple-black pool
(`rgb(16 0 32 / 0.45 → 0.35)`, border white 0.10) set *into* the glass,
so charts and inner panels read deeper than the card above them.
Radius rule: glass surfaces 20–28px; small controls (inputs, buttons,
pills, badges) keep their existing radius — nothing was pilled.

Per-type glow modifiers (used WITH `.card-surface` /
`.card-surface-raised`): `.card-glow-blue` (performance),
`.card-glow-emerald` (profit), `.card-glow-danger` (risk/loss),
`.card-glow-violet` (AI), `.card-glow-cyan` / `.card-glow-amber`
(goals, achievements). Every glow is driven by the real value
(win/loss, risk state, eligibility, level) — never hard-coded, never
on null/empty data.

### Aurora background

`.app-ambient` (rendered once by `components/ambient-background.tsx`,
`aria-hidden`, fixed, `z-index: -1`, pointer-events none) is the
shared contract: four large orbs with radial-gradient falloff —
deep purple `#430574` top-left (0.30), violet `#501E7D` top-right
(0.22), a half-size magenta `#81268E` wisp bottom-right (0.14),
aurora blue `#2971A4` bottom (0.18) — plus an extremely subtle grid
(~3%, masked to fade downward). The body background carries four
aurora radial tints over the purple-black base, so no page is flat
even without the component. Depth comes from gradient falloff, not
`filter: blur` on huge elements. The only animation is
`.motion-orb-drift` (70s/95s, transform-only, small range), killed by
`prefers-reduced-motion`.

### Typography — one font family

**Inter** for the entire app, via `next/font/google` in
`app/layout.tsx` (subsets `["latin"]`, weights 400/500/600/700/800,
`display: "swap"`, variable `--font-sans` on `<html>`). `globals.css`
sets `body { font-family: var(--font-sans), ui-sans-serif, system-ui,
… }` and `tailwind.config.ts` sets `fontFamily.sans` to the same
stack, so every Tailwind text utility uses Inter. No other font
family is used anywhere.

Why Inter: designed for UI/screens, excellent legibility at small
sizes (12–14px secondary text), tabular figures for financial numbers
(money and percentages never wobble as they count or update —
`.metric-value`, `.tnum`, `.metric-hero` all use `tabular-nums`),
wide weight range (400–800), neutral professional institutional feel,
no decorative character.

Loading/fallback: `next/font/google` self-hosts the font at build
time — downloaded during the build, served from the app, no runtime
external request, nothing that can fail or render-block offline in
production. `display: "swap"` renders text immediately in the system
fallback and swaps to Inter — no invisible-text flash, no layout
shift beyond near-identical system metrics. If `--font-sans` is ever
missing, the system stack takes over everywhere. The production
build (coordinator step) confirmed the font downloads and compiles.

Scale: page titles 24–32px, section titles 16–20px, primary metrics
24–32px, body 14–16px, secondary 12–14px, form controls 16px (iOS
zoom rule). Helpers: `.metric-hero` (36–48px extrabold tabular,
the single biggest number on a screen), `.metric-value`,
`.text-gradient-blue/.text-gradient-ai/.text-gradient-gold`
(short display words only, never body copy), `.eyebrow` (12px
uppercase tracking-wider). Financial numbers are large, high-impact
and tabular; not every text element is bold.

### Primitives

- `components/ui/button.tsx`: `default` is a violet→indigo gradient
  with soft shadow, hover glow + brightness, 5% press scale; new
  `ai` (violet family) and `gold` (black text for contrast) variants;
  `secondary` / `outline` / `ghost` are translucent glass (small
  blur, white 0.15 border where a border exists); `destructive`
  stays a solid gradient. Primary actions keep the strong gradient
  so they stay obvious — not every button is transparent. Same
  props/API, sizes and disabled/loading states.
- `components/ui/input.tsx` + `.input-select`: layered gradient
  surface (`.input-surface`) + focus glow (ring +
  `shadow-glow-primary`); 44px height, 16px text.
- `components/ui/badge.tsx` (new): variants default (gradient
  primary, white text) / profit / loss / warning / info / ai /
  gold / neutral — tinted background + matching border + lightened
  token text, all contrast-checked (badge texts 6.37–10.78:1 on
  their tints).
- `.trade-card` (mobile one-card-per-trade base) and
  `.list-row-premium` (row hover lift) utilities.

### Performance strategy (blur budget + fallbacks)

- `backdrop-filter` lives ONLY on floating/glass surfaces: header,
  sidebar, drawer, bottom dock, auth card, hero cards, modals —
  ~6 blurred surfaces per view at most, all small or single-purpose.
- Ordinary content cards keep the translucent gradient WITHOUT
  backdrop-filter: a blur on every card is a per-frame repaint cost
  on mobile; the alpha gradient alone still shows the aurora through,
  because the card composites over the body/ambient layers.
- One large background layer (four orbs + grid), one transform-only
  drift animation; no `filter: blur` on huge elements; no WebGL,
  no Three.js, no new JS dependencies — the redesign is CSS-only,
  so the JS bundle is structurally unchanged.
- Graceful fallback: `@supports not ((backdrop-filter: blur(1px)) or
  (-webkit-backdrop-filter: blur(1px)))` gives every blurred surface
  a 0.96–0.97 opaque purple fill, so glass stays readable in browsers
  without backdrop-filter (old Safari, some embedded webviews). The
  aurora behind is sacrificed; the content is not. Verified present
  in the compiled CSS.
- Motion: transform + opacity only (Phase 16 system unchanged);
  `prefers-reduced-motion` kills all entrance/drift/pulse animation
  and renders final states (verified: 0 animated elements on login
  at 390px under reduced motion).

## What changed per area

### App shell, navigation, header

- Shell root is transparent over one fixed `<AmbientBackground />`
  layer — every signed-in page gets the aurora. Desktop sidebar and
  slim (`h-14`) header are Standard glass; drawer and bottom dock
  are Elevated glass. ITG tile is a violet→indigo gradient
  (`bg-gradient-ai`); wordmark uses gradient text; active nav items
  get a gradient indicator bar + tinted background + light-violet
  text (`text-violet`, readable by the split-violet decision).
  Notification button is a glass circle with the real unread badge
  only. Navigation order, drawer behaviour, collapse persistence,
  Escape/focus handling, aria labels, safe-area padding — unchanged.
- **Mobile bottom nav is a floating glass dock**: Elevated glass,
  `inset-x-3 bottom-3`, 24px radius, deep shadow + faint violet glow,
  active tab with light-violet text + violet-tinted pill + gradient
  dot, raised violet→indigo centre Add Trade circle. Home / Trades /
  Add / Analytics / Goals; "More" stays one tap away in the header
  drawer. Existing `pb-24` content clearance still covers it.

### Login / auth / landing

- **Login is the strongest aurora example**: dark purple-black +
  large blurred violet/blue/magenta aurora lights (violet overhead
  glow with a magenta hint, aurora-blue wash low-left, violet wash
  low-right, small magenta wisp top-right, two faint diagonal light
  streaks), Hero glass card (24px blur) with a violet gradient
  hairline on the top edge, violet→indigo ITG tile, gradient
  wordmark. Form, validation, behaviour and the conditional
  "Supabase is not connected yet" alert (which only appears when
  Supabase is unconfigured) are untouched. Nothing of the SHRUHH
  login was copied.
- Register / forgot-password / reset-password inherit the language
  through `AuthCard` and the tokens. Landing: ambient layer, hero
  glass card with gradient wordmark, gradient icon tiles on the
  three feature cards; the stale Phase 2 footer copy was replaced
  with honest timeless copy (the unconfigured alert itself lives in
  the auth card and is unchanged).

### Dashboard

Spec hierarchy kept (welcome → P&L hero → KPIs → equity curve →
risk/discipline + goals → psychology → recent trades → AI Coach →
recent activity). New full-width P&L hero (`.hero-card`):
eyebrow "Current P&L", large `.metric-hero` tabular number (still
the 700ms count-up; "—" with no trades), context line, supporting
stats (closed trades / wins / max drawdown, all real), and a new
`EquitySparkline` (axis-free area chart; line colour follows the
real final equity — green/red/blue at break-even). Hero glow follows
the real P&L (emerald/red/blue). KPI row is four supporting cards
(win rate, profit factor, average R, streak) with value-driven glows
(nulls get no glow). Performance section carries the blue glow; the
AI Coach section is the one violet accent on the page.

### Analytics and charts

- Equity-curve section is the hero (`.hero-card`, blue glow,
  "Performance" eyebrow). KPI glows value-driven (Total P&L, profit
  factor, max drawdown danger). Drawdown gets the red glow when data
  exists. Breakdown tables get premium rows (uppercase headers,
  taller rows, hover wash, tabular figures) plus a "Best P&L" pill on
  the highest real P&L group. Period tabs are now pills. All paired
  tables share the row treatment. Filters/calculations untouched.
- Charts (Recharts, real data, paired data tables kept): gradient
  area fills via SVG `linearGradient` defs (emerald equity, red
  drawdown, violet XP — XP changed from an amber LineChart to a
  violet AreaChart so the fill exists; line, values and tooltip text
  are the same), 2.5 line weight, softer grid (0.5 opacity,
  violet-tinted `#2b2640`), refined tooltips (dark purple glass,
  `rgba(26,12,40,0.92)`, white 0.18 border, 12px blur, deep shadow,
  semibold label, hover cursor), rounded-top bars with hover wash,
  `activeDot` on area charts. 600ms draw-in and reduced-motion
  behaviour unchanged. Series colours and all data logic untouched.
- Calendar: pill month-nav, value-driven P&L glow, cyan journal
  glow, today gets `ring-2 ring-primary/60`, cells get hover
  elevation, legend uses colour dots. Progress: level card amber
  glow (when a level exists), XP violet, journal cyan; XP history is
  the page hero (raised + violet glow); goals get status pills tinted
  by real status; weekly P&L uses the shared `Money` component.

### Trades and forms

- Trades list: mobile trade cards (`.trade-card`) lead with pair,
  direction/status/strategy pills, large tabular P&L, then date · R ·
  entry/exit in one scannable meta row. Desktop table is a
  `.card-surface` with a muted header, divided hover rows, a new
  Strategy column (from `strategyName`, already fetched — no query
  change), direction/status pills (Long sky/blue, Short orange, so
  they never collide with win/loss emerald/red), tabular figures.
  Table stays inside `overflow-x-auto`, hidden below `md`, min
  width 800px. Filters, sorting, links, pagination untouched;
  pagination links and Add Trade button got resting shadow + hover
  lift; empty state is a raised hero card.
- Trade detail: new result hero (`.hero-card`) with large tabular
  P&L (`.metric-hero`) + R/ROI, glow from the real result (emerald
  win / red loss / blue open); risk/reward, duration and leverage
  stay visible as smaller cards below — nothing dropped. Sections
  stagger in, screenshots sit in inset panels, AI insight carries
  the violet glow, related trades use divided hover rows.
- Add Trade: card is a raised blue-glow hero; the 30–60s quick flow
  is unchanged (same fields/order, optional disclosure now an inset
  panel). Lesson + notes in Advanced Review sit in an inset panel.
  Raw inputs in coach/backtesting/weekly-review forms upgraded to
  the shared 44px/16px/focus-ring look. No field, label, validation
  or action changed anywhere.

### Hero cards per screen

- Goals: closest-to-completion goal as a raised blue hero (picked
  from already-resolved goals, shown once) + glass motivation quote.
- Levels: current level raised with gold glow + gradient name,
  "Current" pill in the levels list, XP chart in a `.chart-panel`.
- Achievements: hero summary strip (gradient unlocked count + XP),
  gold glow + gold XP pill on unlocked cards.
- Coach: week's analysis as a violet hero, severity pills on insights.
- Risk: Today's-status hero whose glow follows the real risk state
  (red breach / amber warning / emerald clear / blue no-rules).
- Certificates: eligibility hero glowing by real state (emerald
  issued / amber eligible / blue otherwise).
- Reports: raised Total P&L stat, primary period pills, card-wrapped
  tables, raised Recommendations. Weekly Review: raised blue-glow
  form hero, P&L coloured by sign.
- Plan (hero form card, Yes/No pills), Psychology (card-wrapped
  tables, P&L by sign), Notifications (type pills, blue glow on
  unread), Profile (verification pill, ringed avatar, gold Level
  hero), Onboarding (eyebrow, raised hero wizard card, inset progress
  track), Admin (restrained: red alert only when open risk events
  > 0, role/verification/status pills, raised Level + AI-config
  cards, no financial data shown anywhere new). All honest empty
  states kept as-is.

## Verification (coordinator, local, 2026-10-28)

- **Vitest: 336/336 pass** (36 files) — run after every worker and
  again after the aurora iteration; no new tests (the change is
  tokens, classes and styling, with no testable logic).
- **Typecheck: pass. Lint: pass** (0 errors).
- **Production build: pass** — first Next.js compile of the new
  tokens, including the `next/font/google` Inter download at build
  time. Routes unchanged. No new JS dependencies (CSS-only redesign).
- **Playwright: 36/36 pass** (6 smoke + 15 responsive + 15 motion),
  run with a fresh server (`CI=true`). Note: an earlier run showed
  2 failures (login motion + login touch targets) that were a
  stale-server artifact — Playwright reused an old server on port
  3000; against the fresh production build both checks pass (card
  animation `motion-fade-in`, email input 44px, verified directly
  in the browser). Lesson recorded: always run the suite with a
  fresh server after a token change.
- **Screenshots inspected at 320 / 360 / 390 / 430 / 768 / 1024 /
  1280px** (landing + login): `scrollWidth == clientWidth` at every
  width — no horizontal overflow anywhere. Login glass card + ITG
  tile + violet gradient CTA render as intended at 320px and 1280px;
  landing hero glass card and feature cards carry the new treatment
  at both ends. The glass-over-aurora test passes on the public
  pages: purple aurora light behind translucent glass, readable
  off-white text, violet accents, no flat black.
- **prefers-reduced-motion: 0 animated elements** on login at 390px
  with reduced motion emulated.
- **Security check: pass** (`scripts/security-check.mjs`, 219 files).
- **Contrast:** computed with a WCAG script, not by eye (full table
  in `docs/phase-18-aurora.md`): foreground 17.27:1, muted 8.81:1,
  light violet text 5.49:1, white on primary 5.67:1, gold black-text
  7.32:1, badge texts 6.37–10.78:1, chart ticks ~7.8:1.
- **Token-contract check:** every class the page workers used
  (`.app-ambient`, `.glass-surface`, `.hero-card`, `.metric-hero`,
  `.eyebrow`, `.trade-card`, `.list-row-premium`, all six
  `.card-glow-*`, `.text-gradient-*`, `.motion-orb-drift`) was
  verified present in `globals.css` before the build; `badge.tsx`
  exists; Inter is wired in `layout.tsx`. The auth-card
  "not connected" alert logic is intact (still imported from
  `lib/supabase/config`, still conditional on `isSupabaseConfigured`).

## What was deliberately not done

- No purple takeover: purple-black is the background, violet the
  primary accent, magenta a whisper, gold premium-only.
- No copied branding, logo, text, numbers or exact layouts from any
  reference. No SHRUHH login copy.
- No neon, chrome/mirror reflections, or gaming styling.
- No WebGL/Three.js, no heavy 3D framework, no new dependencies.
- No opaque cards on owned surfaces; no harsh bright borders.
- No fake data, no fake badges, no invented numbers — every glow,
  colour state and hero figure is driven by real stored values.
- No business logic, auth, calculation, routing, permission or
  security changes. No migrations.

## Files changed (51 source files)

- Design system: `apps/web/app/globals.css`,
  `apps/web/tailwind.config.ts`, `apps/web/app/layout.tsx` (Inter
  wiring only), `apps/web/components/ui/button.tsx`,
  `apps/web/components/ui/input.tsx`,
  `apps/web/components/ui/label.tsx`,
  `apps/web/components/ui/skeleton.tsx`, new
  `apps/web/components/ui/badge.tsx`, new
  `apps/web/components/ambient-background.tsx`.
- Shell/auth/landing: `apps/web/components/app-shell-client.tsx`,
  `apps/web/components/auth/auth-card.tsx`, `apps/web/app/page.tsx`.
- Dashboard/analytics: `apps/web/app/dashboard/page.tsx`,
  `apps/web/app/analytics/page.tsx`, `apps/web/app/calendar/page.tsx`,
  `apps/web/app/progress/page.tsx`,
  `apps/web/components/analytics/charts.tsx`,
  `apps/web/components/analytics/stat-card.tsx`.
- Trades/forms/pages: `apps/web/app/trades/*`,
  `apps/web/components/trades/*`, `apps/web/app/goals/*`,
  `apps/web/app/levels/*`, `apps/web/app/achievements/*`,
  `apps/web/app/certificates/*`, `apps/web/app/reports/*`,
  `apps/web/app/reviews/*`, `apps/web/app/coach/*`,
  `apps/web/app/risk/*`, `apps/web/app/plan/*`,
  `apps/web/app/psychology/*`, `apps/web/app/notifications/*`,
  `apps/web/app/profile/*`, `apps/web/app/onboarding/*`,
  `apps/web/app/admin/*`, and the matching component directories
  (coach, risk, discipline, reports, certificates, reviews,
  onboarding, admin where they exist).
- Docs: this file, plus the per-area worker notes kept alongside
  it: `docs/phase-18-tokens.md`, `docs/phase-18-shell-auth.md`,
  `docs/phase-18-dashboard-analytics.md`,
  `docs/phase-18-trades-pages.md`, `docs/phase-18-aurora.md`.

## Limitations (not claimed otherwise)

- **Signed-in visual pass not done locally.** Signed-in pages
  (dashboard hero, floating glass dock, hero cards with real
  positive/negative data, trade cards, charts) cannot be rendered
  locally without a live Supabase session, and no login was faked.
  They are verified by build, typecheck, lint, the full Vitest
  suite, the shared tokens/classes proven on the public pages
  (landing/login screenshots at all seven widths), and the
  Playwright responsive suite. **The signed-in visual pass must
  happen live after deploy** — the same open Phase 14 gap.
- The glass-over-aurora judgment for signed-in screens is by
  construction (translucent surfaces, dark low-opacity orbs,
  contrast arithmetic), not by a rendered screenshot.
- One judgment call: `.card-glow-*` modifiers now layer their wash
  *over* the glass base gradient (previously the wash replaced the
  card background, which under the new translucent base would have
  left glow cards near-transparent). Hero cards lose the wash to
  the hero background but keep the glow border + shadow.
- A few small solid `bg-card` controls remain outside the glass
  classes (pagination links, period pills, calendar day cells);
  they use the dark purple `--card`, so they read as part of the
  same environment rather than navy panels.

## Deployment (2026-10-28, deployer phase)

- Status: **deployed to production.** Live URL: https://itg-traderos.vercel.app
- Deployment: `dpl_CzgPoJy2MKha3tonH3tQRuQuCahD`, target `production`, state **READY**
  (created 2026-10-28 15:40 UTC; deployment URL
  `itg-traderos-daaf1qnsf-ezattr12s-projects.vercel.app` also live).
- Previous production deployment `dpl_EqjSATjsq8gp12Qd9XiD1Gy8SF8E` (Phase 17) is superseded.
- Live checks (curl, 2026-10-28 15:46 UTC): `/` → 200 (real landing page,
  "ITG TraderOS"); `/login` → 200 (real login form, "Log in to your trading
  journal"); `/dashboard` signed out → 307 to `/login?next=%2Fdashboard`;
  all six Phase 11 security headers present (CSP, HSTS,
  X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy).
- Staging tree rebuilt from the current repo at
  `~/workspace/.itg-deploy-staging/` following the Phase 13 recipe
  exactly (`bash rebuild.sh`): `apps/web` rsynced (no node_modules,
  `.next`, `*.test.ts`, `.env`), `packages/calc/src/index.ts` vendored
  to `apps/web/lib/calc/index.ts`, tsconfig `@itg/calc` remapped,
  `@itg/calc` removed from `package.json` with all direct deps pinned
  to the exact versions in the repo root `package-lock.json`,
  `transpilePackages` removed from `next.config.ts`,
  `package-lock.json` regenerated by `npm install --package-lock-only`
  (222 KB, 4 chunks) and validated locally (`npm install` +
  `npm run build` — "Compiled successfully", 30 routes). No recipe
  differences: Phase 18 added no new dependencies and no migrations.
- Font: Inter via `next/font/google` self-hosted at build time — the
  staging build emitted the `.woff2` files under `.next/static/media/`
  and the Vercel build succeeded with no font-download error, so no
  fallback change was needed.
- Upload: 164 files via the SHA-addressed resumable `upload.py`
  (51 source files changed vs Phase 17; unchanged files skipped by
  SHA). `create_deployment` used the `apps/web/` path prefix per the
  Phase 15 lesson; the deployment went READY on the first attempt.
  One tooling note: the first status poll used the wrong argument
  (`id` instead of `idOrUrl` for `get_deployment`); the poll loop was
  killed and re-run with the correct argument — no deployment was
  affected.
- Env vars unchanged (Supabase URL, anon key, service-role key, app
  URL from Phase 13). No Supabase data or migrations touched.
- Open gap (unchanged): the signed-in live visual pass of the redesign
  cannot run from the VM (known limitation, Phase 14 gap); it needs a
  real browser session or Ezat's own inspection on a phone. The live
  checks above prove the new build serves, not that every signed-in
  screen renders correctly on mobile.
