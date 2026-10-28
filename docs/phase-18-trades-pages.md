# Phase 18 — Trades + Forms + Remaining Pages (Worker 4)

Status: **implemented and verified locally. Not deployed, not committed** —
deploy + GitHub commit are the parent's steps, as briefed. No `next build`,
Playwright, or dev server was run, per the task brief — the coordinator
runs those once at the end.

## The references — what was taken, and what was not

All five images were read first, before any code changed:

- `1000042125_6_1mua.jpg` (SHRUHH glass login): **taken** — layered
  translucent surfaces, bright top edge, soft shadow over a backdrop.
  Applied as the glass motivation quote on Goals and the general
  layered-card language. **Not taken** — the name, logo, purple
  palette, wording.
- `1000042121_7_bv9v.jpg` (delivery app): **taken** — one strong hero
  card, dark secondary cards, status chips, clean separated list
  rows, prominent centre action. Applied to trade cards, hero cards
  and pill badges. **Not taken** — the delivery domain, figures.
- `1000042123_8_e2eu.jpg` (Beyond finance): **taken** — the transaction
  detail with a large outcome figure and status steps; the card
  screen with a 3D ribbon behind layered cards. Applied to the trade
  detail hero (large outcome first, facts below). **Not taken** — the
  brand, the numbers, the ribbon artwork.
- `1000042122_9_7pov.jpg` (Aura AI): **taken** — activity cards with a
  small chart inside, day pills, a history list with separated rows,
  generous card padding. Applied to the Coach insight cards and the
  separated history/audit lists. **Not taken** — the purple gradient
  app, the fitness content, the voice.
- `1000042120_10_8jkn.jpg` (fintech mobile): **taken** — balance hero
  card with sparkline, overview icon row, recent activity as
  separated rows with icon + amount, floating bottom nav. Applied to
  hero-card hierarchy (one dominant figure, supporting facts smaller)
  and the trade-card scan order. **Not taken** — the brand, the
  figures, the layout.

Deliberately **not** taken from any reference: no purple rebrand
(navy base; violet only for AI, amber/gold only for earned status),
no copied branding, logo, text, numbers or exact layouts, no neon
or glow-heavy surfaces, no fake badges or fake data. Every glow and
colour on every page is driven by real stored values (win/loss,
risk state, eligibility, level, verification).

## Token-contract gap found on arrival (important)

The token contract in the brief names classes that **did not exist
yet in this repo snapshot**: `.glass-surface`, `.hero-card`,
`.metric-hero`, `.text-gradient-blue/.text-gradient-ai/.text-gradient-gold`,
`.eyebrow`, `.trade-card`, `.list-row-premium`,
`.card-glow-blue/.card-glow-cyan/.card-glow-violet/.card-glow-emerald/.card-glow-danger/.card-glow-amber`.
`app/globals.css` only has `.page-title`, `.page-lede`,
`.section-title`, `.section-label`, `.card-surface`,
`.card-surface-raised`, `.card-surface-inset`, `.chart-panel`,
`.card-surface-glass`, `.list-divider`, `.metric-value`, `.tnum`
and the motion utilities. Likewise `components/ui/badge.tsx` does
not exist, and `components/ui/button.tsx` has no `ai` or `gold`
variant (only default/secondary/outline/ghost/destructive). Those
belong to the tokens/UI worker, and `globals.css` /
`components/ui/*` are outside this worker's files.

How this worker handled it, without inventing alternatives:

- Every new token class is used **layered on top of a real existing
  class** (e.g. `hero-card card-surface-raised`, `trade-card
  card-surface`, `card-glow-emerald` on a `card-surface-raised`
  hero). If the tokens land as specified, the premium treatment
  appears; if they do not, every page still renders correctly on
  the existing elevation system — no class is load-bearing.
- Badges are inline pill `<span>`s using existing Tailwind
  utilities, following the pattern the codebase already uses for
  Win/Loss pills. No `Badge` import was added, because the
  component does not exist and importing it would break the build.
- Only existing button variants are used. The gradient primary,
  `ai` and `gold` variants are the UI worker's to add; submit
  buttons are unchanged `default` (ActionForm) and will pick the
  gradient up when the variant lands.
- **Coordinator check:** confirm the tokens worker's classes exist
  before deploy, and confirm the class names match the contract
  exactly — a renamed token would silently leave these pages on
  the base treatment.

## What changed per area

### Trades list (`app/trades/page.tsx`, `components/trades/trade-filters.tsx`)

- Mobile: trade cards are now `.trade-card` — pair + direction /
  status / strategy pills on the first row, large tabular P&L on
  the right, then date · R · entry/exit in one scannable meta row.
  Previously the card led with pair + P&L and a plain text meta
  line; direction/status/strategy were unstyled text or absent.
- Desktop: the table is now a `.card-surface` with a muted header
  row, `.list-divider` rows and `.list-row-premium` hover. New
  **Strategy** column (from `strategyName`, already fetched by
  `getTradeListItems` — no query change) and direction/status are
  now pills. P&L, R, prices and dates are tabular (`.tnum`).
  Min width 720px → 800px for the extra column; the table stays
  inside `overflow-x-auto` and is `hidden` below `md`, so no
  320px overflow.
- Direction pills: Long sky/blue, Short orange — chosen to not
  collide with win/loss emerald/red. Status pills: open sky,
  reversed amber, closed neutral. Strategy pill: neutral.
- Filters card: `p-4 sm:p-5` (was `p-4`). Fields, GET behaviour
  and the Clear link are untouched.
- Pagination links: card background, resting shadow, hover lift.
- Add trade button: resting shadow + hover lift. Empty state is
  now a raised hero card.

### Trade detail (`app/trades/[id]/page.tsx`)

- New **trade result hero**: `.hero-card card-surface-raised`
  with a large tabular P&L (`.metric-hero`) and R + ROI beside it.
  Glow is semantic from the real result — `card-glow-emerald`
  for a win, `card-glow-danger` for a loss, `card-glow-blue`
  while open. The outcome line ("Winning trade" / "Losing trade" /
  "Still open") is derived from `is_win` / `status`, the same
  facts the Win/Loss pills already showed.
- The old six-stat grid is split: P&L + R + ROI move into the
  hero; risk/reward, duration and leverage stay visible as three
  smaller stat cards below. No value was dropped.
- Win/Loss pills gain a tinted background fill. Detail rows
  (`.tnum` on values), sections stagger in with `motion-reveal`
  1–6, screenshots sit in `.card-surface-inset` panels, the AI
  insight section carries the violet AI glow, related trades use
  `.list-divider` + `.list-row-premium` rows with tabular P&L.
- Saved banner, correction notice, forms and the cancel flow are
  untouched apart from section stagger.

### Add trade + forms

- `app/trades/new/page.tsx`: the quick-entry card is now the page
  hero — `hero-card card-surface-raised card-glow-blue`. The
  30–60 second flow is unchanged: same eight core fields, same
  order, same optional disclosure.
- `components/trades/quick-trade-form.tsx`: the "More details
  (optional)" disclosure is now a `.card-surface-inset` panel
  instead of a flat muted box.
- `components/trades/advanced-review-form.tsx`: lesson + notes now
  sit together in a `.card-surface-inset` panel (the reflective
  part of the review, set into the form). One JSX imbalance was
  introduced by this edit and fixed during verification (missing
  grid closing tag — see Verification).
- `components/trades/trade-saved-banner.tsx`: resting
  `shadow-elevation-2`. Text, checkmark animation and dismiss
  behaviour unchanged.
- `components/trades/confirm-button.tsx`,
  `components/trades/screenshot-upload-form.tsx`,
  `components/risk/risk-rules-form.tsx`,
  `components/risk/resolve-event-form.tsx`,
  `components/discipline/*`, `components/certificates/*`,
  `components/admin/admin-forms.tsx`: **unchanged** — they use the
  shared `Input`/`Label`/`ActionForm`/`Button` primitives, so
  their visual upgrade comes from the tokens worker's restyle of
  those primitives, not from per-form edits. No field, label,
  validation or action changed in any form.
- Raw (non-primitive) inputs in the coach, backtesting and weekly
  review forms were upgraded to the shared input look: 44px height,
  16px text, `border-input`, focus ring — matching the global
  16px/no-iOS-zoom rule.
- `components/risk/plan-form.tsx`: checkboxes get `accent-primary`;
  the two textareas get 16px text + focus ring.

### Hero cards per screen

- **Goals** (`app/goals/page.tsx`): the active, measurable goal
  closest to completion leads as a raised blue-glow hero
  (`hero-card card-surface-raised card-glow-blue`) with a large
  gradient percent (`.metric-hero .text-gradient-blue`) and its
  progress bar. It is picked from the already-resolved goals and
  shown exactly once (removed from the list below). Goal status is
  now a pill (active sky, completed emerald, failed red, paused
  neutral); period stays as text. The motivation quote is now a
  `.glass-surface`; discipline reminders use `.list-divider` +
  `.list-row-premium`.
- **Levels** (`app/levels/page.tsx`): Current level is the hero —
  raised, `card-glow-amber`, level name in `.metric-hero
  .text-gradient-gold`. Score breakdown table uses
  `.list-divider` + row hover + tabular figures; the XP chart
  sits in a `.chart-panel`; the levels list marks the current
  level with a gold "Current" pill (derived from the real score)
  and gradient name. The "No level yet" empty state is raised.
- **Achievements** (`app/achievements/page.tsx`): new hero summary
  strip — large gradient unlocked count ("X of Y unlocked") +
  total XP, raised with gold glow. Unlocked cards carry
  `card-glow-amber` and a gold XP pill; locked cards stay
  dimmed. Category is now a neutral pill.
- **AI Coach** (`app/coach/page.tsx`): the week's analysis is the
  violet hero (`hero-card card-surface-raised card-glow-violet`,
  the one place violet is the accent). Insight severity is now a
  pill (high red, medium amber, positive emerald, low neutral)
  with the insight type beside it; insight cards gain `sm:p-5`.
  Backtesting form sits in an inset panel.
- **Risk** (`app/risk/page.tsx`): Today's status is the hero and
  its glow follows the real risk state — `card-glow-danger` while
  a breach is active (critical severity), `card-glow-amber` for
  warnings only, `card-glow-emerald` when all rules are within
  limits, `card-glow-blue` when no rules are set yet. Today's P&L
  is coloured by sign and tabular; consecutive losses colour red
  when above zero. Risk events gain row hover + resting shadow.
- **Certificates** (`app/certificates/page.tsx`): eligibility is a
  raised hero whose glow follows the real state — emerald when
  already issued, amber when eligible, blue otherwise. Criteria
  use `.list-divider` with emerald checks. Issued certificates
  show a status pill (issued emerald, revoked red) and tabular
  certificate IDs.
- **Reports** (`app/reports/page.tsx`): Total P&L `StatCard` is
  `raised` (the hero stat); period pills use the primary active
  state with shadow + hover lift; By strategy / By emotion tables
  are now inside `card-surface` cards with divided, hoverable,
  tabular rows; Recommendations is raised; Print / Download PDF
  buttons gain card background + shadow + hover lift.
- **Weekly review** (`app/reviews/weekly/page.tsx`): the new-review
  form card is a raised blue-glow hero; past reviews colour P&L
  by sign (tabular) and gain row hover.

### Remaining pages

- **Plan** (`app/plan/page.tsx`): the plan form card is a raised
  blue-glow hero; Plan vs actual is a `card-surface` table with
  divided hover rows and Yes/No pills (emerald/red, "—" when
  unmeasurable).
- **Psychology** (`app/psychology/page.tsx`): breakdown tables are
  `card-surface` cards with muted headers, divided hover rows,
  P&L coloured by sign and tabular; summary values are tabular.
- **Notifications** (`app/notifications/page.tsx`): notification
  type is now a pill (risk/discipline warnings amber, achievements
  / level-ups gold, others neutral); unread rows carry a blue
  glow, read rows stay dimmed; the empty state is raised.
- **Profile** (`app/profile/page.tsx`): verification is now a pill
  (verified emerald, partial amber, not provided neutral) next to
  the name — same words, same data. The avatar gains a ring +
  shadow. The Level card is the gold hero (`card-surface-raised
  card-glow-amber`, gradient name when a level exists).
- **Onboarding** (`app/onboarding/page.tsx`,
  `components/onboarding/onboarding-wizard.tsx`): the eyebrow line
  uses `.eyebrow`; the wizard card is a raised blue-glow hero;
  the progress track is an inset panel; the done state is a
  raised emerald hero. Steps, fields, hints and copy unchanged.
- **Admin** (`app/admin/*`, restrained by design): dashboard Stat
  gains an `alert` prop — Open risk events glows red with a red
  count only when the real count is above zero; audit rows use
  dividers + hover. Users list gains verification + role pills
  (admin gold, auditor sky, trader neutral). User detail: Level
  card raised, counts tabular, sections `sm:p-6`. Achievements:
  slug/category neutral pills + gold XP pill. Levels: Platinum
  name in gold gradient. Certificates: status pill. Settings: AI
  Coach configuration card raised; setting rows `sm:p-5`. No
  financial data is shown anywhere new — the privacy rules are
  untouched.

## Deliberately unchanged

No business logic, calculation, auth, routing, security or
database change. No migrations, no new dependencies, no new
files except this note. No fake data, no fake AI, no fake
trading — every number, badge and glow comes from the existing
real data; empty states stay honest. No wording that carries
meaning was changed (labels, warnings, risk copy); the only new
short labels are derived descriptions of real state ("Trade
result", "Closest to completion", "Your collection", "Current",
"Winning trade"/"Losing trade" from `is_win`). No horizontal
overflow: tables stay in `overflow-x-auto` wrappers (hidden
below `md` for the trades table), cards use `flex-wrap` +
`min-w-0`, and the only width increase (trades table 720px →
800px) is inside the desktop-only scroll container. Reduced
motion is untouched — all new classes are static (shadow,
border, background); entrance stagger reuses the existing
`motion-reveal` utilities, which the global reduced-motion rule
already neutralises.

## Files changed (33)

- `apps/web/app/trades/page.tsx`
- `apps/web/app/trades/[id]/page.tsx`
- `apps/web/app/trades/new/page.tsx`
- `apps/web/components/trades/trade-filters.tsx`
- `apps/web/components/trades/quick-trade-form.tsx`
- `apps/web/components/trades/advanced-review-form.tsx`
- `apps/web/components/trades/trade-saved-banner.tsx`
- `apps/web/app/goals/page.tsx`
- `apps/web/app/levels/page.tsx`
- `apps/web/app/achievements/page.tsx`
- `apps/web/app/certificates/page.tsx`
- `apps/web/app/reports/page.tsx`
- `apps/web/app/reviews/weekly/page.tsx`
- `apps/web/app/coach/page.tsx`
- `apps/web/components/coach/refresh-coach-form.tsx`
- `apps/web/components/coach/backtesting-form.tsx`
- `apps/web/app/risk/page.tsx`
- `apps/web/components/risk/plan-form.tsx`
- `apps/web/app/plan/page.tsx`
- `apps/web/app/psychology/page.tsx`
- `apps/web/components/reports/print-button.tsx`
- `apps/web/components/reviews/weekly-review-form.tsx`
- `apps/web/app/notifications/page.tsx`
- `apps/web/app/profile/page.tsx`
- `apps/web/app/onboarding/page.tsx`
- `apps/web/components/onboarding/onboarding-wizard.tsx`
- `apps/web/app/admin/page.tsx`
- `apps/web/app/admin/users/page.tsx`
- `apps/web/app/admin/users/[id]/page.tsx`
- `apps/web/app/admin/achievements/page.tsx`
- `apps/web/app/admin/levels/page.tsx`
- `apps/web/app/admin/certificates/page.tsx`
- `apps/web/app/admin/audit/page.tsx`
- `apps/web/app/admin/settings/page.tsx`

Owned but intentionally unchanged (shared primitives carry their
visual upgrade, or nothing visual was needed):
`components/trades/confirm-button.tsx`,
`components/trades/screenshot-upload-form.tsx`,
`components/risk/risk-rules-form.tsx`,
`components/risk/resolve-event-form.tsx`,
`components/discipline/goal-form.tsx`,
`components/discipline/goal-progress-form.tsx`,
`components/discipline/goal-status-form.tsx`,
`components/discipline/mark-read-form.tsx`,
`components/certificates/issue-certificate-form.tsx`,
`components/admin/admin-forms.tsx`, `app/trades/loading.tsx`.
No other files were touched.

## Verification (local, 2026-10-28)

- Vitest: **336/336 pass** (36 files), run twice — before the JSX
  fix and after. No new tests: the change is classes and
  presentational selection from already-computed data, with no
  testable logic.
- Typecheck (`npm run typecheck` in `apps/web`): **pass**. One
  failure was found and fixed by this worker: the
  advanced-review-form inset-panel edit dropped the grid's
  closing `</div>` (TS17008). Restored; typecheck passes cleanly
  after the fix.
- Lint (`npm run lint` in `apps/web`): **pass**, 0 errors,
  0 warnings.
- `next build`, Playwright and dev server were **not** run, per
  the task brief — the coordinator runs those once at the end.

## Real limitations (not claimed otherwise)

- The signed-in pages **cannot be rendered locally without a live
  Supabase project** — there is no session in the no-Supabase
  build and no login was faked. No visual check of any signed-in
  screen was done. Verification is typecheck, lint, the full
  Vitest suite and the class-level reasoning above. **The
  signed-in visual pass must happen live after deploy** — the
  same open Phase 14 gap.
- The new token classes and the `Badge` component / `ai` / `gold`
  button variants do not exist in this snapshot (see the
  token-contract gap above). This worker's pages are correct
  without them and premium with them, but the coordinator must
  confirm the tokens worker delivered those exact class names
  before deploy — otherwise the hero/glow/gradient treatment
  silently does not render.
