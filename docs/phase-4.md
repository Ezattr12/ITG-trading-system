# Phase 4 — Dashboard & Analytics

Status: implemented locally, tested. **Supabase is not connected yet**
— the pages are real and complete, but they show honest empty states
until a Supabase project exists and its URL/keys are set. No demo
trades, no fake P&L, no mock charts. (Note for the parent agent:
`~/MEMORY.md` was updated during this phase to record Supabase as
connected via a Management API PAT — this phase did **not** use it,
did not verify it, and did not deploy anything. Re-verify before
Phase 13.)

## Spec covered
- §17 Dashboard: current P&L, win rate, profit factor, average R,
  current streak, risk discipline, goal progress, journal completion,
  trader level, XP, recent trades, performance chart, psychology
  summary, AI insights section. The AI section states honestly that
  insights are not available until Phase 9 — nothing is fabricated.
- §18 Analytics: equity curve, daily/weekly/monthly P&L, win/loss
  rate, average win/loss, profit factor, expectancy, R distribution,
  drawdown. Breakdowns by strategy, session (Asia/London/New York/
  Other), direction (Long/Short), and psychology vs performance.
- §28 Progress page: trading development, discipline, psychology,
  risk, strategy, journal consistency, goals, level, XP — with
  historical progress (XP history from `xp_transactions`, weekly
  journal consistency, monthly discipline/confidence trend).
- §31 Trading calendar: trading days, number of trades, P&L,
  journal completion, goals/discipline per day, month navigation,
  day → filtered trades list. Days with no trades are blank, never
  zero-P&L days.

## Routes
| Route | Purpose |
|---|---|
| `/dashboard` | Rewritten: computed stats, equity chart, risk discipline, goals, level/XP, recent trades, AI placeholder |
| `/analytics` | Summary, equity curve + table, drawdown, day/week/month P&L (URL param `?period=`), R distribution, strategy/session/direction breakdowns, psychology table |
| `/calendar` | Month grid (`?month=YYYY-MM`), month totals, day detail → `/trades?from=&to=` |
| `/progress` | Level/XP, XP history chart, goals, weekly journal consistency, monthly discipline/confidence |

## Implementation
- `packages/calc`: new `calcEquityCurve`, `calcDrawdownSeries`,
  `calcRBucket` / `calcRDistribution` (decimal.js, pure, tested).
- `apps/web/lib/analytics/`: `analytics.ts` (pure aggregation:
  summary, equity curve, period P&L, breakdowns, R distribution,
  psychology), `calendar.ts` (day aggregation, Monday-first month
  grid, month parsing), `queries.ts` (RLS-enforced reads of closed
  trades + psychology + strategies + lessons + screenshots, goals +
  latest `goal_progress`, XP history, `user_levels`,
  `daily_activity`). All reads use the signed-in user's client.
- `apps/web/components/analytics/charts.tsx`: Recharts **2.15.4**
  (added as a dependency — the chart library chosen in Plan v2 §1,
  React 19 compatible at 2.15.x). Every chart is paired with a
  plain data table in the server page.
- `apps/web/components/analytics/stat-card.tsx`: stat cards, signed
  money, percentages, progress bars. Null values render "—", never 0.
- Header navigation now includes Analytics, Calendar, Progress.

## Data honesty
- Only **closed** trades have P&L and enter analytics; open trades
  are excluded (their P&L is null until close).
- Equity curve starts at 0: starting capital is not stored, so the
  curve shows cumulative trading P&L, never a fabricated balance.
- Profit factor is null (shown "—") when there are no losing trades
  — unbounded, not infinity.
- Goal progress uses the latest `goal_progress` row per goal; goals
  themselves are created in Phase 6, so the dashboard says so when
  there are none.
- Risk discipline on the dashboard is SL-set %, good-discipline %
  and journal completion % — the full risk engine with rule checks
  is Phase 5, and the pages say so where relevant.

## Known limits (to fix in later phases)
- Analytics run over at most the 500 most recent closed trades
  (same limit as the Phase 3 trade list). Phase 12 pushes
  aggregation into the database if a journal grows past it.
- No live Supabase project, no Vercel deployment (Phase 13).
- No AI Coach (Phase 9), no risk engine (Phase 5), no goal
  creation UI (Phase 6).

## Tests
Vitest, 26 new tests (109 total, was 83):
`packages/calc/src/index.test.ts` (4: equity curve, drawdown series,
R buckets/distribution), `apps/web/lib/analytics/analytics.test.ts`
(15: summary, equity curve, day/week/month buckets, breakdowns,
R distribution, psychology), `apps/web/lib/analytics/calendar.test.ts`
(7: day aggregation, month grid, month parsing/shift).
Two test failures during development were wrong expectations in the
new tests (R-bucket boundary at −1 and 1 October 2026 being a
Thursday); the implementation was correct in both cases.

## Verification
- `npm run typecheck` — pass (web + calc)
- `npm test` — 109/109 pass
- `npm run lint` — pass
- `npm run build` (apps/web) — pass, 17 routes; `/analytics`,
  `/dashboard`, `/progress` 228 kB first load (Recharts);
  `/calendar` 107 kB

## Phase 5 needs next
- Risk engine (spec §19): configurable `risk_rules`, warnings
  (daily loss/trade limits, consecutive losses, leverage), plan-vs-
  actual from `trading_plans`; risk discipline on the dashboard can
  then use real rule checks instead of the SL/discipline proxies.
- Psychology tracking UI is already in the trade review (Phase 3);
  Phase 5 adds the plan and the discipline engine hooks.
