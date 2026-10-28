# Phase 19 — Premium Profile + Dashboard + Add Trade + Analytics redesign

Date: 2026-10-28. Status: implemented and verified locally; **not deployed, not committed**
(deploy + commit are the parent's steps). No AI Agent/MCP work.

## Scope

Phase 19 started as a premium trader Profile redesign and grew, on Ezat's
supplied CSS systems and reference images, to four surfaces that now share
**one** token system (see §6):

1. **Profile** (`/profile`) — hero glass profile card, data-driven
   verification/completion, level + XP, Trading Identity, earned-only
   achievements, key stats, premium photo upload, edit form demoted to a
   secondary section.
2. **Dashboard** (`/dashboard`) — P&L hero, stat cards, level + XP card,
   profile completion, premium chart containers, recent trades/activity.
   Hierarchy (Phase 15) and motion (Phase 16) intact.
3. **Add Trade** (`/trades/new`) — mirror-glass form, icon-led fields,
   segmented Long/Short, gradient Save Trade button. No functionality change.
4. **Analytics** (`/analytics`) — glass KPI cards, performance hero with the
   real equity chart, win/loss ring from the real win rate, secondary
   analytics in glass cards, premium empty state. No calculation change.

No business logic, database schema, authentication, RLS, P&L/risk
calculation, save logic, validation, routing, or navigation logic changed
anywhere in Phase 19, except the two tiny UI adapters named below
(Analytics best/worst trade; the Add Trade direction control, which submits
the same `direction` field). No migration was needed. No new dependencies.
No heavy 3D engine — CSS GPU-friendly transforms/opacity/gradients/blur,
the existing Recharts engine.

The four supplied CSS systems are preserved verbatim as records of what
Ezat supplied — do not edit them:

- `docs/phase-19-design-reference.css` (Profile)
- `docs/phase-19-dashboard-design-reference.css` (Dashboard)
- `docs/phase-19-add-trade-design-reference.css` (Add Trade)
- `docs/phase-19-analytics-design-reference.css` (Analytics)

The implemented system lives in `apps/web/app/globals.css` and
`apps/web/tailwind.config.ts`, adapted into the Phase 18 architecture.

## 1. Profile

### What changed

- New pure libs with tests:
  - `apps/web/lib/profile/completion.ts` — computes profile completion %
    and the missing items from actual stored profile data.
  - `apps/web/lib/profile/identity.ts` — derives Trading Identity from
    real data (see below).
  - Tests: `completion.test.ts` + `identity.test.ts`, 13 tests including
    boundary cases.
- New components:
  - `apps/web/components/profile/avatar-upload.tsx` — tap-to-change avatar,
    camera badge, auto-submit on file pick, pending/success/error states.
    Reuses the existing `uploadAvatarAction` — image only, ≤2 MB,
    rate-limited, private `avatars` bucket, signed URLs. Security
    unchanged.
  - `apps/web/components/profile/level-ring.tsx` — conic fill driven by
    `--itg-ring-pct` from the real progress percentage.
- `apps/web/app/profile/page.tsx` rewritten: hero glass card (photo, name,
  verification badge, level ring, XP bar, completion), Key Stats (Total
  Trades, Win Rate, Profit Factor, Average R, Best Strategy, Current
  Streak — real `summarizeTrades` calculations), Trading Identity,
  Achievements (earned first, locked shown locked, max 6 shown + link),
  Profile Completion aside, Certificates aside, "How your level works"
  explainer, Edit profile as collapsible `<details>` sections (Personal
  Information / Trading Background / Private Financial) reusing
  `updateProfileAction` unchanged.

### Verification / completion rule

`computeProfileCompletion(profile)` in `lib/profile/completion.ts`.
Eight required items, each worth an equal share (12.5%):

1. full name, 2. profile photo, 3. father's name, 4. date of birth,
5. country, 6. trading experience, 7. trading education, 8. work status.

`PROFILE_VERIFIED_THRESHOLD = 100` — the **"ITG Verified Profile"** badge
activates only at 100% completion, computed from the stored data. It is
explicitly a **profile-completeness / product badge, NOT government or KYC
identity verification** — the copy never claims identity verification, and
the architecture keeps a separate identity-verification status available
for the future. The badge is never settable by the trader: it is derived
at render time from the data, and the admin-reviewed `verification_status`
column is shown separately. (Phase 11 privilege-guard: a trader cannot
self-verify or self-promote.)

### Level progression

The existing Phase 7 system is used unchanged. Levels are the
multi-dimensional score bands in `DEFAULT_LEVELS`
(`packages/calc/src/index.ts`) — the single place level thresholds and
names are configured:

| Level | Score band |
|---|---|
| Bronze | 0–39 |
| Silver | 40–59 |
| Gold | 60–79 |
| Platinum | 80+ |

The score is multi-dimensional (discipline, risk management, journal
consistency, goal completion, psychology, strategy execution,
consistency, performance); dimensions with no data are excluded, so a
new trader is never scored on data they do not have. XP is the total from
`xp_transactions`; level progress uses the existing
`progressToNextLevel`. The brief's "Level 7" example is **not** the
product's level model — no XP-based numeric ladder was invented.

### XP sources used

Only the existing XP engine's sources: journal completed +10, daily goal
+20, backtesting session +15, weekly review +30, risk discipline +25,
with explicit logged penalties where the engine defines them. No XP is
awarded for simply taking more trades, and no XP is fabricated.

### Trading Identity — what is derived, what is omitted

The `profiles` table has **no** trading_style / markets / sessions /
risk_profile columns, so Trading Identity is derived, never invented:

- Plan-first: the active trading plan's `markets` and `sessions`
  (`trading_plans.markets`, `trading_plans.sessions`).
- Trade-history fallback: top pairs, most-used strategy, most-traded
  session, best strategy (≥3 trades, by win rate).
- Profile fields where they exist: trading experience, trading education.

Deliberately omitted (no data exists): trading style, risk profile,
account status beyond what the profile holds. Empty sections are omitted
honestly rather than filled with placeholders.

## 2. Dashboard

- Tokens reconciled into the unified system (§6): glass 0.075/0.12/0.16,
  blur 24px + saturate(145%), text #f8f7ff/#d4d5e8/#8589a6, profit
  #21f3a5, loss #ff4d72.
- `.itg-stat` refactored from the Dashboard values (with glow modifiers);
  `StatCard` (`components/analytics/stat-card.tsx`) now renders it, with an
  optional glowing `.itg-icon` tile — the same card serves Dashboard and
  Analytics.
- Dashboard hero rebuilt as `.itg-glass.itg-pnl` with `.itg-pnl-value`
  (semantic profit/loss colour, tabular figures, glow); KPI icons added;
  performance section is now `itg-glass itg-glass-elevated`.
- Level & XP + profile completion article added: the level ring fill
  (`--itg-ring-pct`), the XP track (`--xp-progress`) and the completion
  ring (`--completion`) are all set inline from the **real computed**
  values — never hardcoded.
- Achievements grid switched to `.itg-achievements` / `.itg-achievement`.
- Candlesticks: **omitted** — see §8. The existing equity-curve chart
  (real trade data, Recharts) stays the chart of record.
- No functionality, schema, or calculation changes. Phase 15 hierarchy
  and Phase 16 motion intact.

## 3. Add Trade

### What changed

- `apps/web/app/trades/new/page.tsx`: gradient display title
  (`.itg-add-trade-title`), subtitle (`.itg-add-trade-subtitle`), the
  "Discipline Builds Profit" motto chip (`.itg-discipline-chip`, the
  product's own motto from the reference image — copy, not data; hidden
  below `sm`), and the form in the `.itg-trade-form` mirror-glass panel.
  The glass header (hamburger, ITG TraderOS logo, + Trade, notifications)
  and the floating glass dock come from the app shell — **no second header
  or navigation is created**.
- `apps/web/components/trades/quick-trade-form.tsx`: every field is
  icon-led (icon tile in the label row, per the reference image);
  Long/Short is a segmented control (`.trade-direction`) instead of a
  `<select>` — the value is still submitted as the `direction` field via
  a hidden input, so save logic, validation and routing are untouched;
  Save Trade uses the gradient `.itg-save-trade` button with the light
  sweep. The form is also used for trade corrections, where the same
  treatment applies with the same behaviour.
- `apps/web/components/auth/action-form.tsx`: new optional
  `submitClassName` prop — when set, the submit renders as a native
  `<button>` with that class instead of the shadcn Button, so a page can
  use its own premium button treatment without fighting Tailwind's
  utility cascade. Same pending/disabled behaviour either way. All other
  ActionForm users are unaffected (default path unchanged).
- Submit label changed from "Save trade" to "Save Trade" (reference image
  wording).

### Direction semantics — written brief overrides the supplied CSS

Ezat's written brief: Long must have a **green/cyan** visual identity
when selected, Short a **red/pink** identity; TP profit-green, SL
risk-red. The supplied CSS's `.direction-button.active.long` instead used
a purple/blue gradient (matching the reference image). The written
requirement wins, because it matches trading semantics and the TP/SL
colour logic:

- Long active: `linear-gradient(135deg, #22f3a5, #00cfff)`, green glow.
- Short active: `linear-gradient(135deg, #ff4d72, #f12cff)`, red glow.
- Unselected state stays neutral. TP icon tile green, SL icon tile red.

### Candlesticks — omitted

The supplied CSS itself says candles must be generated from real
market/trading data. ITG TraderOS has no market-data feed, and the Add
Trade page loads no trade history, so there is **no real data to render
candles from**. The candlestick atmosphere is omitted entirely; depth
comes from the global aurora + glass treatment. Never hardcoded fake
market candles, never fake trading data.

### Not changed

All eight quick-path fields, the optional "More details" disclosure
(leverage, fees, opened/closed), the explanatory paragraph, the server
action, validation, and routing are unchanged.

## 4. Analytics

### What changed

- `apps/web/app/analytics/page.tsx`:
  - Gradient display title (`.itg-analytics-title`) + description
    (`.itg-analytics-description`).
  - 3D perspective grid (`.itg-analytics-grid` /
    `.itg-analytics-grid-inner`): the supplied 800px-perspective,
    55°-rotated grid, scoped to a 460px band at the top of the page and
    clipped by its own container, so the perspective transform can never
    cause horizontal overflow. Content sits in its own stacking context
    above it (`relative z-[1]`).
  - KPI grid: the six existing StatCards plus **Trade count** and
    **Average R** (both already computed in `summarizeTrades`), now
    8 cards in `grid-cols-2 lg:grid-cols-4`. KPI cards reuse the unified
    `.itg-stat` — the supplied `.analytics-kpi` is that card at 25px
    blur / saturate(155%), which the unified 24px system already covers.
  - Performance hero (`.itg-analytics-performance`): current P&L in the
    header in its real sign colour (`.itg-analytics-performance-value`
    + `.itg-pnl-positive` / `.itg-pnl-negative`), the real equity chart
    in its glass container (`.itg-analytics-chart`, with the decorative
    glow line behind the chart panel — see §7), the data table below.
    The hero deliberately has **no** time-range control: the existing
    day/week/month control belongs to P&L by period, and the equity
    curve is the full history.
  - Win / loss card (new): the ring (`.itg-win-ring`) fill comes from
    the real computed win rate via the `--win-rate` custom property
    (a percentage string, e.g. `"62%"`), set inline by the page —
    **never hardcoded**; centre label shows the real win rate or "—".
    Stat rows beside it: Wins, Losses, Win rate, Loss rate, Best trade,
    Worst trade (pair + P&L).
  - Secondary analytics (`.itg-analytics-secondary`, 2 columns on
    desktop, 1 column ≤800px) in glass cards
    (`.itg-analytics-secondary-card`): Drawdown, P&L by period, R
    distribution, By strategy, By session, By direction, Psychology vs
    performance. All existing analytics are kept; nothing was removed.
    The per-section red danger glow on Drawdown was dropped in favour
    of the unified secondary card — the red drawdown chart and the Max
    drawdown KPI's danger glow still carry the risk cue.
  - Period range control restyled as `.itg-range`; the active style keys
    off the links' existing `aria-current` attribute — no extra class
    plumbing.
  - Empty state: with no closed trades, the performance hero shows the
    premium glass empty state (`.itg-analytics-empty` — icon, title,
    "Your equity curve and analytics will appear here once you close
    your first trade.") instead of the plain paragraph. No chart is ever
    drawn from invented data.
- One tiny UI adapter: best/worst trade are the highest/lowest P&L among
  the closed trades already loaded for the page (filter `pnl !== null`).
  No calculation, schema, auth, or RLS change.

### Navigation

The existing bottom dock (Home/Trades/Add/Analytics/Goals) is unchanged;
Analytics keeps its existing active state (violet + active dot). The
supplied `.analytics-bottom-nav` is the unified `.itg-bottom-nav` and the
supplied `.analytics-nav-active` is the dock's existing active state —
one navigation, no duplicate.

## 5. Bottom navigation — one system

The supplied Profile, Dashboard, Add Trade and Analytics systems each
contained their own bottom-nav / floating-add-button definitions
(`.itg-bottom-nav` / `.itg-add-trade`, `.itg-floating-nav`,
`.trade-bottom-nav` / `.trade-add-button`,
`.analytics-bottom-nav`). All four map to the **single** unified
implementation in `app-shell-client.tsx` (`.itg-bottom-nav` /
`.itg-add-trade` in globals.css): 28px radius, 28px blur +
saturate(150%), 0.68 dark glass, deeper shadow + neon violet glow, 70px
centre action lifted -32px (62px on mobile). z-index stays 40 in the
shell (not the supplied 50 / 100), so the navigation drawer (z-50)
always covers the dock. No second navigation exists anywhere.

## 6. The one token system — reconciliation

All four supplied systems and Phase 18 agree on the essentials
(dark purple-black base, violet primary, blue/cyan secondary, magenta
atmospheric-only, gold premium-only, Inter, tabular figures, premium
ease `cubic-bezier(0.22,1,0.36,1)`). Where they disagreed, one value was
picked and used everywhere:

| Token | Profile | Dashboard | Add Trade | Analytics | **Unified** |
|---|---|---|---|---|---|
| Background | #06030d / #100020 / #18002f | #03040a / #070b20 / #0b0620 | #030316 / #08051f | #030313 | #06030d / #100020 (+ `#03040a` as `--itg-black`); the near-black purples are the same family — the global aurora provides the depth, no per-page background layer |
| Aurora | #340266 / #492282 / #8B60C7 | #7b2cff / #a855f7 / #1677ff / #00cfff / #ec2cff | #8b35ff / #b42cff / #237cff / #00d9ff / #f12cff | #8b35ff / #b42cff / #237cff / #00d9ff / #f12cff | Both families kept: `--itg-violet-deep/violet/light` + `--itg-aurora-*`, plus bright hexes `--itg-purple-bright #8b35ff`, `--itg-violet-bright #b42cff`, `--itg-blue-neon #237cff`, `--itg-cyan-bright #00d9ff`, `--itg-pink-bright #f12cff` |
| Glass | 0.075 / 0.105 / 0.135 | 0.075 / 0.12 / 0.16 | 0.075 / 0.12 | 0.075 / 0.115 | **0.075 / 0.12 / 0.16** (Dashboard values; Analytics 0.115 → 0.12) |
| Glass border | 0.18 | 0.18 / 0.32 | 0.20 | 0.19 | 0.18 standard, 0.28 bright; form card 0.25, performance hero 0.22 (hero exceptions) |
| Blur | 22px glass / 80px aurora | 24px / 60px | 24px | 25px / 30px | **24px** (+ saturate(145%)); hero surfaces keep the supplied 30px blur + saturate(160% Add Trade form / 165% Analytics hero) as hero exceptions, not a second system |
| Text | #f8f7ff / #c8c5d8 / #858197 | #ffffff / #d4d5e8 / #8589a6 | #ffffff / #d8d8ec / #9293ae | #ffffff / #d9d7e9 / #9795ad | **#f8f7ff / #d4d5e8 / #8589a6** |
| Profit | #35e6a1 | #21f3a5 | #22f3a5 | #20e6a0 | **#21f3a5** |
| Loss | #ff5f72 | #ff4d72 | #ff4d72 | #ff4d70 | **#ff4d72** |
| Gold | #bd935f | #bd935f | — | #f4c95d | **#bd935f** (premium-only; the brighter Analytics gold was not adopted) |
| Warning | #f5c451 | — | — | — | #f5c451 |
| Bitcoin | — | #f6b73c | — | — | #f6b73c |
| Radii | 14 / 20 / 28 / 34px | 28 / 34 / 999px | 28px | 28px | 14 / 20 / 28 / 34 / 999px; form card 32px (27px mobile), performance hero 34px (27px mobile) |
| Naming | `--text` etc. | `--text-primary` etc. | `--text` etc. | `--analytics-*` | **`--itg-*` everywhere**; no `--analytics-*` tokens exist |

## 7. Defects fixed in the supplied CSS

Each fix is in the implementation and noted here (the reference files are
untouched):

**Profile**
1. `--font-tabular: "tnum" 1;` is not a valid font declaration — not
   carried over; tabular figures come from `font-variant-numeric:
   tabular-nums` (`.itg-xp` / `.itg-stat-value` / `.tnum`).
2. `.itg-level-ring::after` used `position: absolute` with no positioned
   parent — `.itg-level-ring` is now `position: relative`, and the
   conic-gradient fill is driven by the real XP-progress percentage via
   the `--itg-ring-pct` custom property, not the hardcoded 72%.
3. `.itg-glass::before` keeps `pointer-events: none` and the wash is
   capped so it does not reduce text contrast.
4. The fixed `.itg-aurora` layer is wired onto `AmbientBackground` as
   the single global layer, `z-index: -1` — it sits behind content
   everywhere, including the drawer and modals.

**Dashboard**
1. `.itg-completion-ring::after` — same bug class as the level ring:
   `.itg-completion-ring` is `position: relative`.
2. `.itg-dashboard::before/::after` were `position: fixed` with
   `z-index: 0` — **not implemented**; the single global `.app-ambient`
   layer (z-index -1) already provides the aurora, so no second layer
   can cover content.
3. `--xp-progress` and `--completion` are set inline from the real
   computed values (level-band progress %, profile completion %) —
   never hardcoded.
4. `.itg-glass::before` keeps `pointer-events: none` and does not reduce
   text contrast.

**Add Trade**
1. Icon tiles: the supplied CSS positioned `.trade-field-icon`
   absolutely inside the input; the reference image shows the icon
   beside the label, so the tile sits in the label row instead — an
   absolute icon inside the 58px input would crowd the field at 320px.
2. `.trade-form-card::before` reflection reduced from 0.16 white to
   0.08: the wash sits over text and the card is already translucent;
   the supplied value would have pushed the worst-case corner contrast
   below AA for normal text. The wash fades to transparent by 25% of
   the diagonal, so body text is unaffected.
3. `.add-trade-header` not implemented (the shell header already is the
   glass header); `.trade-bottom-nav` / `.trade-add-button` are the
   unified dock (§5).
4. The Save Trade light sweep (`itg-button-shine`) is killed by the
   global reduced-motion block and stopped outright on `:disabled`.

**Analytics**
1. `.analytics-page::marker { display: none; }` is meaningless on a
   `div` — dropped.
2. `.analytics-win-ring::after` — the supplied `::after` was a grid
   item, which would have stacked unpredictably with the centre label;
   implemented as an absolute disc over a `position: relative` ring
   (same pattern as `.itg-level-ring`), with the centre label above it
   (z-index 1).
3. `.analytics-chart::after` (the decorative glow line) has explicit
   `pointer-events: none` and z-index 0, and the `.chart-panel` inside
   is positioned with z-index 1, so the glow can never cover the chart
   or its glass tooltip (the tooltip renders inside the panel).
4. The fixed `.analytics-page::before/::after` aurora blobs at z-index 0
   are **not implemented** — the global aurora layer already provides
   them, so there is no z-index 0 layer to fight with; content sits in
   its own stacking context above the grid band.

## 8. Candlesticks — hard rule, applied twice

Both the Dashboard and Add Trade supplied systems say candlesticks must
be rendered from real chart data and never hardcoded. ITG TraderOS has
no market-data feed.

- **Dashboard:** candlestick atmosphere omitted. The equity curve (the
  trader's own real closed trades, Recharts) is the chart of record.
- **Add Trade:** candlestick atmosphere omitted. The page loads no trade
  history, so there is no real data to render candles from.

In both cases depth comes from the aurora/glass/chart treatment instead.
No fake market candles and no fabricated trading performance data exist
anywhere in Phase 19.

## 9. What was deliberately omitted

- Fields with no data: trading style, risk profile, account status
  (Profile); any market data (Dashboard / Add Trade / Analytics).
- The supplied standalone headers (`.add-trade-header`) and per-page
  bottom navs — the shell already provides both, once.
- The supplied per-page aurora wrappers (`.itg-dashboard`,
  `.analytics-page`, `.add-trade-page`) — the single global ambient
  layer already provides the aurora.
- A time-range control on the Analytics performance hero — the existing
  day/week/month control belongs to P&L by period, and the equity curve
  is the full history.
- The brighter Analytics gold (#f4c95d) — gold stays premium-only
  #bd935f.
- The supplied purple/blue Long gradient — overridden by the written
  green/cyan Long requirement (§3).

## 10. Migrations

None. Phase 19 needed no schema change: the persistent level/XP model
(Phase 7), achievements, profiles, trading plans and trade history
already existed. No migration file was written, and nothing needs to be
applied live.

## 11. Verification (local, 2026-10-28)

- **Vitest: 349/349 pass** (336 baseline + 13 new Profile tests). No new
  tests were needed for Add Trade / Analytics: the direction control
  submits the same `direction` field, the save logic is untouched, and
  the Analytics changes are presentation over the existing tested
  calculations (`summarizeTrades`, `buildEquityCurve`, `periodPnl`,
  `rDistribution`, `psychologySummary`, breakdowns).
- **Typecheck: pass. Lint: pass. Build: pass** (30 routes; first-load JS
  unchanged at 103 kB — no new JS animation library, no new deps).
- **Playwright: 36/36 pass** with a fresh server (`CI=true`, repo root —
  the config's webServer builds and starts the production build).
- **Screenshots + overflow:** landing and login at 320/360/390/430/768/
  1024/1280px — `scrollWidth == clientWidth` at every width, no
  horizontal overflow; login glass card checked visually at 390px.
  `/trades/new`, `/analytics`, `/profile`, `/dashboard` all correctly
  307 → `/login` when signed out. Screenshots:
  `~/workspace/phase19-shots/` (14 PNGs).
- **Reduced motion:** 0 animated elements on login at 390px with
  `prefers-reduced-motion` emulated; the global reduced-motion block
  also kills the Save Trade sweep and the aurora drift.
- **Security check:** `scripts/security-check.mjs` passes (226 files).
  RLS re-checked: a trader only sees/edits their own profile; no
  service-role credentials in the browser; no storage credential
  exposure; photo upload unchanged (private bucket, signed URLs,
  image-only, ≤2 MB, rate-limited).
- **Built CSS verified** to contain all new classes: `.itg-add-trade-title`,
  `.itg-discipline-chip`, `.itg-trade-form`, `.trade-direction`,
  `.itg-save-trade`, `itg-button-shine`, `.itg-analytics-title`,
  `.itg-analytics-grid`, `.itg-analytics-performance`, `.itg-range`,
  `.itg-analytics-chart`, `.itg-analytics-secondary`, `.itg-win-ring`,
  `.itg-stat-row`, `.itg-analytics-empty`.
- **Contrast:** the unified foreground/muted tokens were verified in
  Phase 18 (17.27:1 / 8.81:1). The two new glass reflections
  (`.itg-trade-form::before`, `.itg-analytics-performance::before`)
  were capped at 0.08 white (from the supplied 0.14–0.16) for the same
  reason (§7).

## 12. Limitations — what was NOT verified

- **Signed-in visual pass: not done locally.** `/profile`,
  `/dashboard`, `/trades/new` and `/analytics` cannot be rendered
  without a live Supabase session, so the signed-in Profile hero
  (level ring, XP bar, photo upload states), the Dashboard hero, the
  Add Trade form (segmented Long/Short, Save Trade sweep, icon-led
  fields at 320px), and the Analytics hero / win ring / secondary cards
  with real data have **not** been seen rendered. Same open Phase 14
  gap as Phases 15–18: the signed-in visual pass must happen live after
  deploy, on a real browser/phone, with the test account.
- **Add Trade creation / Long-Short / TP-SL / validation / save** were
  verified only by code inspection + the untouched save path + the
  existing test suite — the end-to-end save flow needs the signed-in
  live pass.
- **Analytics with real trades** (win ring fill, best/worst trade rows,
  chart rendering with data) was verified only by code inspection +
  unit-tested calculations — the populated view needs the signed-in
  live pass.
- The transient environment faults seen during verification (a Chromium
  headless-shell crash on an ad-hoc launch, two Playwright webServer
  EPERM failures that cleared on retry with a manually started server,
  and a `/tmp` wipe at 18:02 that deleted the first screenshot set)
  are environment issues, not app faults: the full suite passes
  cleanly through the project's own runner (36/36) and the screenshots
  were regenerated into the persistent workspace.

## 13. Deployment (2026-10-28, deployer phase)

- Status: **deployed to production.** Live URL: https://itg-traderos.vercel.app
- Deployment: `dpl_DaKTQfrwjWN9XE7TwfA6B5PqoZuu`, target `production`, state **READY**
  (created 2026-10-28 18:19 UTC; deployment URL
  `itg-traderos-qgh4rsdbk-ezattr12s-projects.vercel.app` also assigned).
- Previous production deployment `dpl_CzgPoJy2MKha3tonH3tQRuQuCahD` (Phase 18) is superseded.
- Live checks (curl, 2026-10-28 18:21 UTC): `/` → 200 (real landing
  page, "ITG TraderOS"); `/login` → 200 (real login form, "Log in to
  your trading journal"); `/dashboard` signed out → 307 to
  `/login?next=%2Fdashboard`; all six Phase 11 security headers present
  (CSP, HSTS, X-Content-Type-Options nosniff, X-Frame-Options DENY,
  Referrer-Policy, Permissions-Policy).
- Staging tree rebuilt from the current repo at
  `~/workspace/.itg-deploy-staging/` following the Phase 13 recipe
  exactly via the saved `rebuild.sh` (rsync + vendor + patch +
  lockfile regenerate/split): `apps/web` rsynced (no node_modules,
  `.next`, `*.test.ts`, `.env`), `packages/calc/src/index.ts` vendored to
  `apps/web/lib/calc/index.ts`, tsconfig `@itg/calc` remapped,
  `@itg/calc` removed from `package.json` with all direct deps pinned
  to the exact versions in the repo root `package-lock.json`,
  `transpilePackages` removed from `next.config.ts`,
  `package-lock.json` regenerated by `npm install --package-lock-only`
  (220,902 bytes, 4 chunks, roundtrip verified) and validated locally
  (`npm install` + `npm run build` — "Compiled successfully", 30 routes;
  Inter `.woff2` files emitted under `.next/static/media/`).
  169 files uploaded via the SHA-addressed `upload.py`. No recipe
  differences: Phase 19 added no new dependencies and no migrations.
  One cosmetic note: the upload included `test-results/.last-run.json`
  (45 B, a Playwright artifact that rsync did not exclude); harmless,
  it is not referenced by the app.
- `create_deployment` used the `apps/web/` path prefix per the Phase 15
  lesson and no `teamId` per the Phase 17 lesson; the deployment went
  READY on the first attempt (INITIALIZING → BUILDING → READY in ~75s).
  The Vercel build succeeded with no Google Fonts error, so no font
  fallback change was needed.
- Env vars unchanged (Supabase URL, anon key, service-role key, app
  URL from Phase 13). No Supabase data or migrations touched.
- Open gap (unchanged): the signed-in live visual pass of the
  Profile/Dashboard/Add Trade/Analytics redesign cannot run from the VM
  (known limitation, Phase 14 gap); it needs a real browser session or
  Ezat's own inspection on a phone. The live checks above prove the new
  build serves, not that every signed-in screen renders correctly on
  mobile.
