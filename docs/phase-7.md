# Phase 7 — Gamification

Status: implemented locally, tested. **Supabase project
ITG-trading-system now exists** (per the parent agent's brief)
but migrations have NOT been applied to it and its keys are NOT
in the app env yet — the pages are real and complete, but they
show honest empty states until migrations are applied and env
vars are set. No demo trades, goals, XP or levels. Not deployed,
not committed to GitHub (GitHub App push still fails 403 —
parent agent's blocker, unchanged).

## No new migration

All gamification tables already existed from Phase 1
(migration 0008: `levels`, `achievements`, `user_levels`,
`user_achievements`, `xp_transactions`; 31 tables total,
unchanged). The seed already contained the 4 levels
(Bronze/Silver/Gold/Platinum with scoring weights) and the 11
achievements. No migration was needed, and no old migration
was edited.

## Spec covered

- §24 XP: trade journal +10, daily goal +20, backtesting
  session +15, weekly review +30, risk discipline +25,
  achievements carry their own `xp_reward`. Amounts come from
  the `@itg/calc` `XP_TABLE` — one source of truth.
- §8 Levels: Bronze/Silver/Gold/Platinum, multi-dimensional,
  NOT profit-only. Eight dimensions — discipline, risk,
  journal consistency, goal completion, psychology, strategy
  execution, consistency, performance — scored 0–100 from the
  trader's real stored data and combined with weights from the
  level's `scoring_config` (admin-configurable; seed defaults:
  discipline .20, risk .20, journal .15, goals .15, psychology
  .10, strategy .10, consistency .05, performance .05).
  Performance is only 5%: a trader with a 100% win rate and
  0 everywhere else scores 7 and stays Bronze (tested).
- §25 Achievements: all 11 seeded achievements, earned/locked
  from real data, awarded automatically when their condition is
  met. Criteria are config (`criteria` jsonb on the row), so a
  new achievement is a seed/config row, not a code change.
  Unknown criteria keys never count as met.

## What is honest about the scoring

- A dimension with no data is **excluded**, not scored as 0:
  remaining weights are renormalised. A new trader is scored
  only on what they have actually done.
- No measurable dimension at all → no score (null), never a
  fake 0. The Levels page says "No level yet".
- Weekly consistency counts only weeks on or after the week of
  the trader's first closed trade, most recent 12 weeks.
- Weekly/monthly journal achievements need at least one closed
  trade in the window — 0 trades is not 100%.
- Discipline streak: consecutive days with a journaled trade,
  ending today (or yesterday, since today may not be over yet).
  A broken run is 0.

## Bug fixed from Phase 3

Phase 3's `awardJournalXp` inserted into `xp_transactions`
with the signed-in client. That table has no client INSERT
policy (migration 0008, append-only), so RLS silently rejected
every insert and no trade ever earned XP. Phase 7 replaces it
with `awardXp` in `lib/gamification/actions.ts`, which writes
through the service-role client like `logRiskEvent` /
`logDisciplineEvent`. Awards are idempotent per
(user, reason, source), so a retry or double submit cannot
double the XP, and a failed XP insert never loses a trade.

## XP wiring (real sources only)

| Source | XP | Trigger |
|---|---|---|
| Trade journal completed | +10 | `createTradeAction`, per trade (idempotent) |
| Goal completed | +20 | `updateGoalStatusAction` → `completed`, per goal |
| Risk discipline streak | +25 | trade save, when the disciplined streak hits 3, then every 5 (same milestone as the Phase 5 positive event) |
| Achievement unlocked | its `xp_reward` | `checkAndAwardAchievements`, per achievement |
| Weekly review | +30 | **Not wired — no weekly-review UI exists yet** (no `weekly_reviews` writer anywhere). The amount exists in the XP table; nothing awards it until a review flow exists. |
| Backtesting session | +15 | **Not wired — `daily_activity` is never written by any action yet**, so no backtesting count can be recorded. Same note applies to the "Backtesting Streak" achievement. |

Penalties: `logXpPenalty` — negative whole XP with a written
reason, required. XP is never removed silently.

## Routes

| Route | Purpose |
|---|---|
| `/levels` | Current level, score, progress to next level, per-dimension breakdown (with "No data yet"), XP history, all level thresholds |
| `/achievements` | Every achievement with earned/locked state, XP reward, criteria in plain language, unlock date |
| `/dashboard` (level card) | Real level/score/XP instead of the Phase 4 placeholder ("Full scoring arrives in Phase 7" removed) |
| `/progress` | Real level hint instead of the Phase 4 placeholder; stale "arrives in Phase 5/6" hints fixed |

## Implementation

- `apps/web/lib/gamification/`: `types.ts` (dimension/score/
  achievement/XP types), `xp.ts` (pure: XP table re-export,
  `totalXp`, `aggregateXpHistory`, `validatePenalty`),
  `scoring.ts` (pure: `parseScoringConfig`,
  `calcDimensionScores`, `calcLevelScore`, `levelForScore`,
  `scoreTrader`, `progressToNextLevel`,
  `weeklyConsistencyPct`, `dimensionInputsFromBundle`),
  `achievements.ts` (pure: `achievementCriteriaMet`,
  `newlyUnlockedAchievements`, `describeCriteria`,
  `countJournaledDayStreak`, `buildGamificationStats`),
  `queries.ts` (RLS-enforced reads, `getGamificationBundle`),
  `actions.ts` ("use server": `awardXp`, `logXpPenalty`,
  `checkAndAwardAchievements`, `ensureLevelStored`,
  `refreshGamification`).
- `apps/web/lib/analytics/queries.ts`: `getAnalyticsBundle`
  now computes the level from real trades/goals via the scoring
  engine instead of reading the stored `user_levels` row (which
  is only the last calculation and goes stale). XP history now
  uses `aggregateXpHistory`. `AnalyticsBundle` gains `levels`.
- `apps/web/lib/trades/actions.ts`: journal XP via `awardXp`,
  risk-discipline XP at streak milestones, `refreshGamification`
  + achievement/level-up notifications after a trade is saved.
- `apps/web/lib/discipline/actions.ts`: goal-completion XP +
  refresh + notifications on status → `completed`.
- `apps/web/components/app-header.tsx`: Levels and Achievements links.
- `apps/web/app/levels/page.tsx`, `apps/web/app/achievements/page.tsx`.
- No import cycle: `gamification/actions.ts` does not import
  the discipline actions — it returns what changed and the
  caller (trade/goal actions, pages) creates the notification.

## Tests

32 new tests, all in `apps/web/lib/gamification/`:
`scoring.test.ts` (14) — config parsing/normalisation,
missing-dimension renormalisation, not-profit-only (100%
win rate + 0 elsewhere = 7, Bronze), thresholds, next-level
progress, weekly consistency, inputs from a bundle;
`xp.test.ts` (6) — spec §24 amounts, totals with penalties,
cumulative history, penalty validation; `achievements.test.ts`
(12) — every seeded criterion at/above/below threshold,
percentage criteria with no trades, unknown/empty criteria
never awarded, unlock filtering, streak counting, stats
building.

Full suite: **211/211 pass** (179 before + 32 new).
Typecheck, lint and Next.js build pass. 24 routes (was 22);
`/levels` and `/achievements` added.

## Known limits

- XP/achievements/level only exist once migrations are applied
  and env vars are set; until then the pages show honest empty
  states and no XP is recorded.
- Scoring runs over the 500 most recent closed trades (Phase 3
  limit, carried forward).
- The stored `user_levels` row is refreshed when a trade is
  saved, a goal is completed, or the Levels/Achievements page
  is visited — there is no background cron yet (Phase 13).
- Weekly-review and backtesting XP have no trigger yet (see
  table above) — Phase 8's reports/reviews are the natural place
  to add the weekly-review flow.
