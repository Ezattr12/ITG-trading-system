# Phase 9 — AI Coach

Status: implemented locally, tested. **Supabase project
ITG-trading-system now exists** (per the parent agent's brief)
but migrations have NOT been applied to it and its keys are NOT
in the app env yet — the pages are real and complete, but they
show honest empty states until migrations are applied and env
vars are set. No demo trades, goals, XP, P&L or insights. No
external AI/LLM service is connected. Not deployed, not
committed to GitHub (GitHub App push still fails 403 —
parent agent's blocker, unchanged).

## Spec covered

- §28, §39 AI Coach: weekly analysis from **real stored data
  only**. Every insight is a deterministic rule applied to the
  trader's own trades, psychology, lessons, risk events, goals
  and streaks, and every insight cites its metrics snapshot —
  the real numbers it was computed from. A rule with no
  supporting data produces no insight. With fewer than 3 closed
  trades in a week the coach says so honestly ("Not enough
  trades yet to analyse this week") and generates nothing.
- Rules: weekly performance overview, best strategy (≥2 trades,
  positive P&L), worst strategy (≥2 trades, negative P&L),
  worst session (≥2 trades), most frequent losing setup (≥2
  losses), most repeated mistake (≥2 occurrences), worst emotion
  (≥2 trades, negative P&L), journal completion <80%,
  stop-loss rate <100%, critical risk breach / warnings / clean
  risk week, goals incomplete / complete, and one focus for next
  week picked from the highest-priority problem (losing setup /
  repeated mistake first, then worst strategy, emotion, risk).
  A strategy traded only once is never named best or worst.

## No external LLM

This phase is the deterministic, data-grounded coach. No API
key was added, no external AI service is called, and nothing
claims an LLM is connected. `buildLlmCoachPrompt` in
`lib/coach/insights.ts` is a clearly-marked extension point
only: it formats an already-generated, data-grounded analysis
into the text an LLM would receive, makes no network call, and
is called by no page or action. If a future phase connects an
LLM, it must take that prompt (real numbers only) and must
never be allowed to invent statistics.

## Backtesting XP — now wired

The +15 backtesting trigger from Phase 7 is now wired. The
`/coach` page has a backtesting log: the trader records the
TOTAL sessions done on a day (1–10), stored in
`daily_activity.backtesting_sessions` (upsert per user+day,
owner RLS policies from migration 0006). XP is awarded once
per session index (`backtest:<date>:<n>`) through the existing
`awardXp` path — re-submitting the same total awards nothing
new, raising the total awards only the new sessions, and a
failed XP insert never loses the logged day. All XP triggers
from spec §24 are now wired: journal +10, daily goal +20,
backtesting +15, weekly review +30, risk discipline +25.

## Refresh idempotency

Refreshing an analysis stores an insight only when no stored
row for the same week, type and exact metrics snapshot exists
(checked in the action, and enforced by the unique index in
migration 0013). Re-running a refresh with unchanged data
inserts nothing and says so; when the data changes, the
snapshot changes and a new row is stored.

## Migration

- `0013_ai_insights_idempotency.sql`: one unique index on
  `ai_insights (user_id, insight_type, period_start,
  period_end, metrics_snapshot)`. No new table — `ai_insights`
  already existed from migration 0009. 31 tables total,
  unchanged. No old migration was edited.

## Routes

| Route | Purpose |
|---|---|
| `/coach` | This week's live analysis (preview until refreshed), refresh action, backtesting log, stored insight history |
| `/dashboard` | AI insights section now shows the real latest coach insights (up to 3, one per type) instead of the Phase 4 "not available until Phase 9" text; honest empty state when none exist yet |

Header navigation now includes AI Coach.

## Implementation

- `apps/web/lib/coach/`: `types.ts` (insight types, metrics
  snapshot shape, `COACH_MIN_TRADES` = 3), `insights.ts`
  (pure: `generateCoachInsights`, `buildLlmCoachPrompt`
  extension point), `queries.ts` (RLS-enforced reads:
  `getCoachWeekData` reuses `getReportSummary` plus the week's
  risk events and current streak, `getAiInsights`,
  `getAiInsightsForWeek`, `getLatestCoachInsights`),
  `actions.ts` (`refreshCoachAnalysisAction`,
  `logBacktestingSessionAction`, service-role writes for
  `ai_insights`, signed-in client upsert for `daily_activity`),
  `validation.ts` (Zod).
- `apps/web/components/coach/`: `refresh-coach-form.tsx`,
  `backtesting-form.tsx`.
- `apps/web/app/coach/page.tsx`: live weekly analysis,
  backtesting section, insight history with evidence and
  recommendation per insight.
- `apps/web/app/dashboard/page.tsx`: real latest insights.

## Tests

- 252/252 Vitest tests pass (238 before + 14 new: insufficient
  data with 0 and 1 trades, losing setup, repeated mistake,
  best/worst strategy including the ≥2-trade guard, worst
  session, worst emotion, discipline, critical breach, clean
  risk week, goals, focus for next week, every-insight-cites-
  evidence, deterministic generation (same evidence → identical
  snapshots, so a refresh with unchanged data stores nothing),
  LLM prompt contains only real numbers).
- `npm run typecheck` pass, `npm run lint` pass,
  `npm run build` pass — 23 routes now; `/coach` 116 kB first
  load, `/dashboard` 228 kB (unchanged).

## Known limits

- Analysis runs over the 500 most recent closed trades in the
  week (Phase 3 limit, carried forward).
- The coach is rule-based, not a language model — insights are
  the rules above, nothing more. A future LLM phase can build
  on `buildLlmCoachPrompt`.
